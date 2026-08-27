'use server'

import { revalidatePath } from 'next/cache'
import { cookies } from 'next/headers'
import { redirect } from 'next/navigation'
import { z } from 'zod'
import { ADMIN_COOKIE, createSession, credentialsMatch, isAuthenticated } from './admin-auth'
import { db } from './db'
import { processImage, sniffImage } from './images'
import { POLICY_SLUG } from './policy'
import { allow } from './rate-limit'
import { backfillEmbeddings, dropImageIndex } from './image-search'
import { ASSET_KEYS, asset } from './crypto'
import {
  ORDER_STATUSES,
  allowedTransitions,
  normalizeTracking,
  requiresTracking,
} from './order-status'
import { SHOWCASE_KEYS, imageField } from './showcase'
import { syncVariants } from './variants'

const MAX_UPLOAD_BYTES = 12 * 1024 * 1024
// 一次请求最多这么多张。每张都要跑四档编码，不封顶的话一次提交能占住服务器好几分钟
const MAX_UPLOAD_FILES = 12

/** 每个写操作前都过一遍。会话失效直接抛，避免误改数据 */
async function requireAuth() {
  if (!(await isAuthenticated())) throw new Error('UNAUTHORIZED')
}

type Upload = { ok: true; files: Buffer[] } | { ok: false; message: string }

/**
 * 上传字段的信任边界：张数、体积、真实格式，三样都过了才放进管线。
 * 商品、品牌、展示位三处都从这里过，规则只写一遍。
 *
 * 后台有会话保护，但这道门还是照做：会话可能被借走，管理员自己也可能
 * 顺手拖进来一个奇怪的文件，出事的代价是整台机器。
 */
async function takeUploads(formData: FormData, field: string): Promise<Upload> {
  const files = formData
    .getAll(field)
    .filter((file): file is File => file instanceof File && file.size > 0)

  if (files.length > MAX_UPLOAD_FILES) {
    return { ok: false, message: `一次最多上传 ${MAX_UPLOAD_FILES} 张` }
  }
  if (files.some((file) => file.size > MAX_UPLOAD_BYTES)) {
    return { ok: false, message: `图片不能超过 ${MAX_UPLOAD_BYTES / 1024 / 1024}MB` }
  }

  const buffers: Buffer[] = []
  for (const file of files) {
    const buffer = Buffer.from(await file.arrayBuffer())
    // 不看 file.type：那是客户端填的，改个扩展名就能糊弄过去
    const sniffed = await sniffImage(buffer)
    if (!sniffed.ok) return { ok: false, message: `${file.name}：${sniffed.message}` }
    buffers.push(buffer)
  }

  return { ok: true, files: buffers }
}

/** 走和种子数据同一条 sharp 管线：四档宽度 WebP + 模糊占位 + 分享卡片图 */
async function ingest(input: Buffer, withOg: boolean) {
  return processImage(input, { dir: 'uploads', crop: 'full', withOg })
}

export async function login(formData: unknown): Promise<{ error?: string }> {
  // 密码是后台唯一一把钥匙，不限次数就等于允许慢速爆破。
  // 放在解析之前：连格式都不对的请求也得算进额度，否则乱填就能白嫖次数。
  if (!(await allow('login'))) {
    return { error: '尝试次数过多，请稍后再试' }
  }

  const parsed = z
    .object({ username: z.string().max(200), password: z.string().max(200) })
    .safeParse(formData)
  if (!parsed.success) return { error: '请填写账号和密码' }

  if (!credentialsMatch(parsed.data.username, parsed.data.password)) {
    return { error: '账号或密码不正确' }
  }

  const session = createSession()
  const store = await cookies()
  store.set(ADMIN_COOKIE, session.value, {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    path: '/',
    maxAge: session.maxAge,
  })

  redirect('/admin')
}

export async function logout() {
  const store = await cookies()
  store.delete(ADMIN_COOKIE)
  redirect('/admin/login')
}

// ---------- 订单 ----------

/**
 * 改订单状态。只允许状态机里画出来的流转，
 * 并且取消时把库存还回去——不然人工取消一单，货就凭空少了。
 */
export async function setOrderStatus(
  orderId: string,
  target: string,
  tracking?: string,
): Promise<{ ok: true } | { ok: false; message: string }> {
  await requireAuth()

  const next = z.enum(ORDER_STATUSES).safeParse(target)
  if (!next.success) return { ok: false, message: '未知的订单状态' }

  const order = await db.order.findUnique({
    where: { id: orderId },
    select: { id: true, number: true, status: true, items: { select: { variantId: true, quantity: true } } },
  })
  if (!order) return { ok: false, message: '订单不存在' }
  if (!allowedTransitions(order.status).includes(next.data)) {
    return { ok: false, message: `不能从 ${order.status} 改成 ${target}` }
  }

  // 发货必须带单号，否则客户订单页只会显示「运输中」却无处可查
  let trackingNumber: string | undefined
  if (requiresTracking(next.data)) {
    const parsed = normalizeTracking(tracking)
    if (!parsed.ok) return { ok: false, message: parsed.message }
    trackingNumber = parsed.value
  }

  await db.$transaction(async (tx) => {
    if (next.data === 'CANCELLED') {
      for (const item of order.items) {
        if (!item.variantId) continue
        await tx.productVariant.update({
          where: { id: item.variantId },
          data: { stock: { increment: item.quantity } },
        })
      }
    }
    await tx.order.update({
      where: { id: order.id },
      data: {
        status: next.data,
        ...(trackingNumber ? { trackingNumber } : {}),
      },
    })
  })

  revalidatePath('/admin/orders')
  revalidatePath(`/admin/orders/${order.number}`)
  revalidatePath(`/order/${order.number}`)
  return { ok: true }
}

// ---------- 商品 ----------

const productSchema = z.object({
  title: z.string().trim().min(1, '必填').max(200),
  slug: z
    .string()
    .trim()
    .min(1, '必填')
    .max(120)
    .regex(/^[a-z0-9-]+$/, '只能用小写字母、数字和短横线'),
  description: z.string().trim().min(1, '必填').max(4000),
  details: z.string().trim().max(4000).optional(),
  brandId: z.string().min(1, '必选'),
  categoryId: z.string().min(1, '必选'),
  gender: z.enum(['MEN', 'WOMEN', 'UNISEX']),
  status: z.enum(['DRAFT', 'ACTIVE', 'ARCHIVED']),
  priceCents: z.coerce.number().int().min(0).max(100_000_00),
  compareAtCents: z.coerce.number().int().min(0).max(100_000_00).optional(),
  featured: z.coerce.boolean().optional(),
  colors: z.string().trim().max(500).optional(),
  sizes: z.string().trim().max(500).optional(),
})

export type SaveResult =
  | { ok: true; id: string }
  | { ok: false; fieldErrors: Record<string, string>; message?: string }

function collectErrors(error: z.ZodError): Record<string, string> {
  const fieldErrors: Record<string, string> = {}
  for (const issue of error.issues) {
    const key = String(issue.path[0])
    fieldErrors[key] ??= issue.message
  }
  return fieldErrors
}

export async function saveProduct(id: string | null, formData: FormData): Promise<SaveResult> {
  await requireAuth()

  const raw = Object.fromEntries(formData)
  const parsed = productSchema.safeParse({
    ...raw,
    featured: raw.featured === 'on',
    compareAtCents: raw.compareAtCents === '' ? undefined : raw.compareAtCents,
    details: raw.details === '' ? undefined : raw.details,
  })
  if (!parsed.success) return { ok: false, fieldErrors: collectErrors(parsed.error) }

  const data = parsed.data
  const clash = await db.product.findFirst({
    where: { slug: data.slug, ...(id ? { id: { not: id } } : {}) },
    select: { id: true },
  })
  if (clash) return { ok: false, fieldErrors: { slug: '这个 slug 已被占用' } }

  const values = {
    title: data.title,
    slug: data.slug,
    description: data.description,
    details: data.details ?? null,
    brandId: data.brandId,
    categoryId: data.categoryId,
    gender: data.gender,
    status: data.status,
    priceCents: data.priceCents,
    compareAtCents: data.compareAtCents ?? null,
    featured: data.featured ?? false,
  }

  // 先验图再落库：验不过就整个不写，否则商品已经建好了却回一句「图片不合格」，
  // 人再点一次保存就多出一条记录
  const uploads = await takeUploads(formData, 'images')
  if (!uploads.ok) return { ok: false, fieldErrors: {}, message: uploads.message }

  const product = id
    ? await db.product.update({ where: { id }, data: values, select: { id: true } })
    : await db.product.create({ data: values, select: { id: true } })

  await syncVariants(product.id, data.slug, data.colors, data.sizes)

  let position = await db.productImage.count({ where: { productId: product.id } })
  for (const input of uploads.files) {
    // 第一张是主图，其余当特写；只有主图需要分享卡片图
    const processed = await processImage(input, {
      dir: 'uploads',
      crop: position === 0 ? 'full' : 'detail',
      withOg: position === 0,
    })
    await db.productImage.create({
      data: {
        productId: product.id,
        url: processed.url,
        ogUrl: processed.ogUrl,
        blurDataUrl: processed.blurDataUrl,
        width: processed.width,
        height: processed.height,
        alt: data.title,
        position,
      },
    })
    position++
  }

  // 新图立刻能被搜到，不用等回填脚本
  if (uploads.files.length) await backfillEmbeddings()
  // 状态也可能刚改过，而图搜索引只收 ACTIVE 的货，让它重建一次
  dropImageIndex()

  revalidatePath('/admin/products')
  revalidatePath('/', 'layout')
  return { ok: true, id: product.id }
}

export async function deleteProductImage(imageId: string) {
  // 只删数据库记录，磁盘文件留着：文件名是内容哈希，同一张图可能被别的商品引用

  await requireAuth()
  await db.productImage.delete({ where: { id: imageId } })
  // 内存索引里还留着这张图的向量，得让它重建，否则删了还能搜出来
  dropImageIndex()
  revalidatePath('/admin/products')
  revalidatePath('/', 'layout')
}

export async function setVariantStock(variantId: string, stock: unknown) {
  await requireAuth()
  const parsed = z.coerce.number().int().min(0).max(100_000).safeParse(stock)
  if (!parsed.success) return { ok: false as const, message: '库存必须是 0 以上的整数' }

  await db.productVariant.update({ where: { id: variantId }, data: { stock: parsed.data } })
  revalidatePath('/admin/products')
  revalidatePath('/', 'layout')
  return { ok: true as const }
}

// ---------- 品牌 ----------

const brandSchema = z.object({
  name: z.string().trim().min(1, '必填').max(120),
  slug: z
    .string()
    .trim()
    .min(1, '必填')
    .max(120)
    .regex(/^[a-z0-9-]+$/, '只能用小写字母、数字和短横线'),
  description: z.string().trim().max(1000).optional(),
  position: z.coerce.number().int().min(0).max(9999).optional(),
})

export async function saveBrand(id: string | null, formData: FormData): Promise<SaveResult> {
  await requireAuth()

  const raw = Object.fromEntries(formData)
  const parsed = brandSchema.safeParse({
    ...raw,
    description: raw.description === '' ? undefined : raw.description,
    position: raw.position === '' ? undefined : raw.position,
  })
  if (!parsed.success) return { ok: false, fieldErrors: collectErrors(parsed.error) }

  const data = parsed.data
  const clash = await db.brand.findFirst({
    where: { slug: data.slug, ...(id ? { id: { not: id } } : {}) },
    select: { id: true },
  })
  if (clash) return { ok: false, fieldErrors: { slug: '这个 slug 已被占用' } }

  const field = imageField('brand')
  const uploads = await takeUploads(formData, field.file)
  if (!uploads.ok) return { ok: false, fieldErrors: {}, message: uploads.message }

  const cover = uploads.files[0] ? await ingest(uploads.files[0], false) : null

  const values = {
    name: data.name,
    slug: data.slug,
    description: data.description ?? null,
    position: data.position ?? 0,
    // 没传新图就保持原样，别把已有封面清掉
    ...(cover ? { imageUrl: cover.url, imageBlur: cover.blurDataUrl } : {}),
    ...(formData.get(field.clear) === 'on' ? { imageUrl: null, imageBlur: null } : {}),
  }

  const brand = id
    ? await db.brand.update({ where: { id }, data: values, select: { id: true } })
    : await db.brand.create({ data: values, select: { id: true } })

  revalidatePath('/admin/brands')
  revalidatePath('/', 'layout')
  return { ok: true, id: brand.id }
}

// ---------- 收款配置 ----------

/**
 * 每个币的收款地址与开关。
 *
 * 地址格式必须逐个校验：填错一个字符，之后所有走这个币的货款都进黑洞，
 * 而且要等到第一个客户付完款才会发现。宁可在这里拦下。
 * 只勾开关不填地址也拦——那种配置前台会直接不显示，运营却以为开了。
 */
export async function saveWallets(
  formData: FormData,
): Promise<{ ok: true } | { ok: false; errors: Record<string, string> }> {
  await requireAuth()

  const errors: Record<string, string> = {}
  const rows = ASSET_KEYS.map((key) => {
    const item = asset(key)
    const address = String(formData.get(`${key}.address`) ?? '').trim()
    const enabled = formData.get(`${key}.enabled`) === 'on'

    if (address && !item.isAddress(address)) {
      errors[key] = `不像 ${item.networkLabel} 的地址，请核对后再存`
    } else if (enabled && !address) {
      errors[key] = '开启前要先填地址'
    }
    return { key, address, enabled }
  })

  if (Object.keys(errors).length) return { ok: false, errors }

  await db.$transaction(
    rows.map((row) =>
      db.cryptoWallet.upsert({
        where: { assetKey: row.key },
        update: { address: row.address, enabled: row.enabled },
        create: { assetKey: row.key, address: row.address, enabled: row.enabled },
      }),
    ),
  )

  revalidatePath('/admin/payments')
  revalidatePath('/checkout')
  return { ok: true }
}

// ---------- 首页与入口 ----------

const showcaseSchema = z.object({
  headline: z.string().trim().max(300).optional(),
  subhead: z.string().trim().max(600).optional(),
})

/**
 * 站点文案与首页装修。所有位置共用一个表单提交，字段名带 key 前缀区分，
 * 比给每个位置单开一个表单少一半代码。加位置只改 SHOWCASE_KEYS，这里不用动。
 */
export async function saveShowcase(
  formData: FormData,
): Promise<{ ok: true } | { ok: false; message: string }> {
  await requireAuth()

  for (const key of SHOWCASE_KEYS) {
    const parsed = showcaseSchema.safeParse({
      headline: formData.get(`${key}.headline`) || undefined,
      subhead: formData.get(`${key}.subhead`) || undefined,
    })
    if (!parsed.success) return { ok: false, message: `${key} 的文案太长了` }

    const field = imageField(key)
    const uploads = await takeUploads(formData, field.file)
    if (!uploads.ok) return { ok: false, message: uploads.message }

    const cover = uploads.files[0] ? await ingest(uploads.files[0], key === 'home') : null
    const cleared = formData.get(field.clear) === 'on'

    const values = {
      headline: parsed.data.headline ?? null,
      subhead: parsed.data.subhead ?? null,
      ...(cover ? { imageUrl: cover.url, imageBlur: cover.blurDataUrl } : {}),
      ...(cleared ? { imageUrl: null, imageBlur: null } : {}),
    }

    await db.showcase.upsert({ where: { key }, update: values, create: { key, ...values } })
  }

  revalidatePath('/admin/appearance')
  revalidatePath('/', 'layout')
  return { ok: true }
}

export async function deleteBrand(id: string): Promise<{ ok: boolean; message?: string }> {
  await requireAuth()

  const count = await db.product.count({ where: { brandId: id } })
  if (count > 0) return { ok: false, message: `还有 ${count} 个商品挂在这个品牌下，先移走再删` }

  await db.brand.delete({ where: { id } })
  revalidatePath('/admin/brands')
  revalidatePath('/', 'layout')
  return { ok: true }
}

// ---------- 政策页 ----------

const policySchema = z.object({
  title: z.string().trim().min(1, '必填').max(120),
  slug: z.string().trim().min(1, '必填').max(80).regex(POLICY_SLUG, '只能用小写字母、数字和短横线'),
  body: z.string().trim().min(1, '正文不能为空').max(50_000),
  position: z.coerce.number().int().min(0).max(9999).optional(),
  published: z.coerce.boolean().optional(),
})

/**
 * slug 是主键，改 slug 等于换一条记录（旧地址会失效），所以传的是「原来的 slug」，
 * 新建时为 null。正文按纯文本存，渲染那头不会当 HTML 解析。
 */
export async function savePolicy(current: string | null, formData: FormData): Promise<SaveResult> {
  await requireAuth()

  const raw = Object.fromEntries(formData)
  const parsed = policySchema.safeParse({
    ...raw,
    position: raw.position === '' ? undefined : raw.position,
    published: raw.published === 'on',
  })
  if (!parsed.success) return { ok: false, fieldErrors: collectErrors(parsed.error) }

  const data = parsed.data
  if (data.slug !== current) {
    const clash = await db.policy.findUnique({ where: { slug: data.slug }, select: { slug: true } })
    if (clash) return { ok: false, fieldErrors: { slug: '这个 slug 已被占用' } }
  }

  const values = {
    title: data.title,
    body: data.body,
    position: data.position ?? 0,
    published: data.published ?? false,
  }

  if (current && current !== data.slug) {
    // 主键换了：SQLite 更新主键是可以的，但顺手把旧地址收掉更省事
    await db.policy.delete({ where: { slug: current } })
  }
  await db.policy.upsert({
    where: { slug: data.slug },
    update: values,
    create: { slug: data.slug, ...values },
  })

  revalidatePath('/admin/policies')
  revalidatePath('/', 'layout')
  return { ok: true, id: data.slug }
}

export async function deletePolicy(slug: string): Promise<{ ok: boolean; message?: string }> {
  await requireAuth()

  await db.policy.delete({ where: { slug } })
  revalidatePath('/admin/policies')
  revalidatePath('/', 'layout')
  return { ok: true }
}
