'use server'

import { randomBytes } from 'node:crypto'
import { revalidatePath } from 'next/cache'
import { z } from 'zod'
import { REASON_COPY, verifyPayment, type Reason } from './chain'
import { db } from './db'
import { sweepSoon } from './expire'
import { searchByImage, type ImageSearchResult } from './image-search'
import { sniffImage } from './images'
import { MAX_IMAGE_BYTES } from './vision'
import { amountFor, asset, isAssetKey } from './crypto'
import { PAYMENT_METHOD_KEYS, rateCentsFor, whatsappNumber } from './payments'
import { allow } from './rate-limit'
import { payableAsset } from './wallets'
import {
  MAX_QUANTITY,
  SHIPPING_METHOD_KEYS,
  isShippingMethod,
  totalsFor,
  type ShippingMethod,
  type Totals,
} from './totals'

const linesSchema = z
  .array(
    z.object({
      variantId: z.string().min(1).max(64),
      // 上限故意不在这里卡死：单行超标会让整个数组解析失败、购物车变空，
      // 而下面的循环本来就会 clamp 到 MAX_QUANTITY 并记进 clamped 告诉前端。
      quantity: z.number().int().min(1),
    }),
  )
  .max(50)

export type ResolvedLine = {
  variantId: string
  slug: string
  title: string
  brandName: string
  label: string
  imageUrl: string
  blurDataUrl: string
  unitPriceCents: number
  compareAtCents: number | null
  quantity: number
  stock: number
}

export type ResolvedCart = Totals & {
  lines: ResolvedLine[]
  shippingMethod: ShippingMethod
  /** 商品已下架或 SKU 不存在，前端要把这些从 localStorage 里清掉 */
  removed: string[]
  /** 库存不够，数量被下调，前端要跟着改并给个提示 */
  clamped: string[]
}

function label(size: string | null, color: string | null) {
  return [color, size].filter(Boolean).join(' / ') || 'One size'
}

function emptyCart(method: ShippingMethod): ResolvedCart {
  return { ...totalsFor(0, method), lines: [], shippingMethod: method, removed: [], clamped: [] }
}

/**
 * 把浏览器里存的 SKU + 数量换成带价格的行。
 * 价格、库存一律以数据库为准，客户端传什么价都不看。
 */
export async function resolveCart(input: unknown, shipping?: string): Promise<ResolvedCart> {
  // 挂在这里而不是下单：整个目录被弃单锁成售罄时，恰恰不会再有人下单，
  // 而看购物车的人照样有。自带节流，不 await。
  sweepSoon()

  const method: ShippingMethod =
    typeof shipping === 'string' && isShippingMethod(shipping) ? shipping : 'boxed'

  const parsed = linesSchema.safeParse(input)
  if (!parsed.success || parsed.data.length === 0) return emptyCart(method)

  // 先按 SKU 合并。同一个 SKU 拆成五十行、每行 10 件就是 500 件，
  // 上限得按 SKU 算才作数。正常客户端不会产生重复行（加购是累加到同一行），
  // 这是挡手工构造的请求拿弃单去锁库存。
  const wanted = new Map<string, number>()
  for (const line of parsed.data) {
    wanted.set(line.variantId, (wanted.get(line.variantId) ?? 0) + line.quantity)
  }

  const variants = await db.productVariant.findMany({
    where: { id: { in: [...wanted.keys()] }, product: { status: 'ACTIVE' } },
    select: {
      id: true,
      size: true,
      color: true,
      stock: true,
      product: {
        select: {
          slug: true,
          title: true,
          priceCents: true,
          compareAtCents: true,
          brand: { select: { name: true } },
          images: { orderBy: { position: 'asc' }, take: 1, select: { url: true, blurDataUrl: true } },
        },
      },
    },
  })

  const byId = new Map(variants.map((variant) => [variant.id, variant]))
  const lines: ResolvedLine[] = []
  const removed: string[] = []
  const clamped: string[] = []

  for (const [variantId, asked] of wanted) {
    const variant = byId.get(variantId)
    // 售罄的也归到 removed：留在购物车里点不了结算，不如直接清掉并告知
    if (!variant || variant.stock <= 0) {
      removed.push(variantId)
      continue
    }

    const quantity = Math.min(asked, variant.stock, MAX_QUANTITY)
    if (quantity !== asked) clamped.push(variantId)

    const image = variant.product.images[0]
    lines.push({
      variantId: variant.id,
      slug: variant.product.slug,
      title: variant.product.title,
      brandName: variant.product.brand.name,
      label: label(variant.size, variant.color),
      imageUrl: image?.url ?? '',
      blurDataUrl: image?.blurDataUrl ?? '',
      unitPriceCents: variant.product.priceCents,
      compareAtCents: variant.product.compareAtCents,
      quantity,
      stock: variant.stock,
    })
  }

  const subtotal = lines.reduce((sum, line) => sum + line.unitPriceCents * line.quantity, 0)
  return { ...totalsFor(subtotal, method), lines, shippingMethod: method, removed, clamped }
}

const checkoutSchema = z.object({
  email: z.email('Enter a valid email'),
  name: z.string().trim().min(1, 'Required').max(120),
  line1: z.string().trim().min(1, 'Required').max(200),
  line2: z.string().trim().max(200).optional(),
  city: z.string().trim().min(1, 'Required').max(120),
  state: z.string().trim().min(1, 'Required').max(120),
  postalCode: z.string().trim().min(1, 'Required').max(32),
  country: z.string().trim().min(2, 'Required').max(56),
  phone: z.string().trim().max(40).optional(),
  shippingMethod: z.enum(SHIPPING_METHOD_KEYS),
  paymentMethod: z.enum(PAYMENT_METHOD_KEYS),
  // 选了 crypto 才有意义；具体哪个币+链，服务端还要再核一次开关和地址
  cryptoAsset: z.string().trim().optional(),
})

export type PlaceOrderResult =
  | { ok: true; number: string }
  | { ok: false; fieldErrors: Record<string, string>; message?: string }

function orderNumber() {
  return `NS-${randomBytes(5).toString('hex').toUpperCase()}`
}

/**
 * 下单。金额在这里根据数据库重算一遍，库存用带条件的 updateMany 做原子扣减，
 * 两个人同时抢最后一件时后一个会拿到 0 行受影响，整笔回滚。
 * 订单一律先落 PENDING，收到币或客服确认后才转 PAID。
 */
export async function placeOrder(input: unknown, formData: unknown): Promise<PlaceOrderResult> {
  // 扣库存的口子，刷它等于把货锁死在一堆永不付款的单子里
  if (!(await allow('order'))) {
    return { ok: false, fieldErrors: {}, message: 'Too many attempts. Please wait a few minutes.' }
  }

  const form = checkoutSchema.safeParse(formData)
  if (!form.success) {
    const fieldErrors: Record<string, string> = {}
    for (const issue of form.error.issues) {
      const key = String(issue.path[0])
      fieldErrors[key] ??= issue.message
    }
    return { ok: false, fieldErrors }
  }

  const data = form.data

  // 前台传什么都不算数，币种可用与否一律以数据库当下的配置为准
  const chosen = data.paymentMethod === 'crypto' ? await payableAsset(data.cryptoAsset) : null
  if (data.paymentMethod === 'crypto' && !chosen) {
    return { ok: false, fieldErrors: {}, message: 'That payment coin is unavailable right now.' }
  }
  if (data.paymentMethod === 'whatsapp' && !whatsappNumber()) {
    return { ok: false, fieldErrors: {}, message: 'Local payment is unavailable right now.' }
  }

  const cart = await resolveCart(input, data.shippingMethod)
  if (cart.lines.length === 0) {
    return { ok: false, fieldErrors: {}, message: 'Your bag is empty, or the items are no longer available.' }
  }
  if (cart.removed.length || cart.clamped.length) {
    return { ok: false, fieldErrors: {}, message: 'Stock changed — please review your bag and try again.' }
  }
  // 减免被夹到小计时总价正好归零。放过去的话虚拟币单永远付不掉、WhatsApp 单等于白送。
  // 上架时的最低价校验已经堵住了源头，这里是钱这条路上的兜底。
  if (cart.totalCents <= 0) {
    return {
      ok: false,
      fieldErrors: {},
      message: 'This order comes to $0 — please contact us before checking out.',
    }
  }

  // 汇率拿不到就明确失败。宁可让用户换个币种，也不能拿一个过期汇率去收款。
  // 稳定币恒为 100，走不到失败分支。
  let rateCents: number | null = null
  if (chosen) {
    rateCents = await rateCentsFor(chosen)
    if (!rateCents) {
      return {
        ok: false,
        fieldErrors: {},
        message: `Couldn't fetch the current ${chosen.coin} rate. Try a stablecoin, or try again in a moment.`,
      }
    }
  }

  try {
    const number = await db.$transaction(async (tx) => {
      for (const line of cart.lines) {
        const updated = await tx.productVariant.updateMany({
          where: { id: line.variantId, stock: { gte: line.quantity } },
          data: { stock: { decrement: line.quantity } },
        })
        if (updated.count === 0) throw new Error('OUT_OF_STOCK')
      }

      const created = await tx.order.create({
        data: {
          number: orderNumber(),
          email: data.email,
          status: 'PENDING',
          subtotalCents: cart.subtotalCents,
          discountCents: cart.discountCents,
          shippingCents: cart.shippingCents,
          taxCents: cart.taxCents,
          totalCents: cart.totalCents,
          shippingMethod: data.shippingMethod,
          paymentMethod: data.paymentMethod,
          cryptoAsset: chosen?.key ?? null,
          cryptoRateCents: rateCents,
          cryptoAmount:
            chosen && rateCents ? amountFor(cart.totalCents, rateCents, chosen.decimals) : null,
          cryptoAddress: chosen?.address ?? null,
          name: data.name,
          line1: data.line1,
          line2: data.line2 || null,
          city: data.city,
          state: data.state,
          postalCode: data.postalCode,
          country: data.country,
          phone: data.phone || null,
          items: {
            create: cart.lines.map((line) => ({
              variantId: line.variantId,
              productSlug: line.slug,
              productTitle: line.title,
              brandName: line.brandName,
              variantLabel: line.label,
              imageUrl: line.imageUrl,
              unitPriceCents: line.unitPriceCents,
              quantity: line.quantity,
            })),
          },
        },
        select: { number: true },
      })

      return created.number
    })

    return { ok: true, number }
  } catch (error) {
    if (error instanceof Error && error.message === 'OUT_OF_STOCK') {
      return { ok: false, fieldErrors: {}, message: 'Something just sold out — please review your bag.' }
    }
    throw error
  }
}

/**
 * message 一律英文，付款页是给客户看的。链上判定另外带 reason，
 * 后台拿它换中文——同一个 recheckPayment 两边都在调，光靠一句话伺候不了。
 */
export type PaymentState =
  /** 链上已核实，订单已自动放行 */
  | { state: 'paid' }
  /** 已记下，链上还没确认到位，前台会继续轮询 */
  | { state: 'pending'; message: string; reason?: Reason }
  /** 对不上或格式不对，不放行 */
  | { state: 'rejected'; message: string; reason?: Reason }

/**
 * 用户回填转账哈希，随即去链上核。
 *
 * 四项全过才自动转已付款，任何一项不过都只记录不放行。查不动接口也只是
 * 转成 pending 等下次轮询——绝不会因为「查不到」就当成付过了。
 */
export async function submitTxid(orderNumber: string, txid: unknown): Promise<PaymentState> {
  if (!(await allow('order'))) {
    return { state: 'rejected', message: 'Too many attempts. Please wait a few minutes.' }
  }

  const found = await loadPayable(orderNumber)
  if (found.error) return found.error
  const { order, item } = found

  const value = typeof txid === 'string' ? txid.trim() : ''
  if (!item.isTxid(value)) {
    return { state: 'rejected', message: `A ${item.networkLabel} transaction ID is ${item.txidHint}.` }
  }

  // 钱已经到账的直接停，别拿新哈希覆盖掉那条已核实的。
  // 已取消的要继续往下走：那种订单同样可能刚收到钱。
  if (order.status !== 'PENDING' && order.status !== 'CANCELLED') return { state: 'paid' }

  // 唯一约束挡的是「一笔转账认领多个订单」。先查一次只为给出人话提示，
  // 真正的拦截在数据库那层，并发下也不会漏。
  try {
    await db.order.update({ where: { id: order.id }, data: { cryptoTxid: value } })
  } catch (error) {
    if (isDuplicate(error)) {
      return {
        state: 'rejected',
        message: 'That transaction ID is already attached to another order.',
      }
    }
    // 写库挂了却说「这笔转账是别人的」，会把客户和客服一起带沟里
    return { state: 'rejected', message: 'Could not save that transaction ID. Please try again.' }
  }

  // 后台整个 (protected) 是 force-dynamic，哈希落了库下次打开就看得到，不用 revalidate
  if (order.status === 'CANCELLED') return notPending(order)

  return settle(order, item, value)
}

/** P2002 才是唯一约束冲突，其余写库失败是另一回事 */
function isDuplicate(error: unknown) {
  return (
    typeof error === 'object' && error !== null && (error as { code?: string }).code === 'P2002'
  )
}

/**
 * 不在待付款状态时回什么。
 *
 * 已取消必须单独说：这种订单也可能刚收到钱，回一句「已付款」会让客户以为货在路上，
 * 沉默则连申诉的入口都没有。哈希这时已经落库，客服凭单号能查到。
 */
function notPending(order: NonNullable<Payable>): PaymentState {
  return order.status === 'CANCELLED'
    ? {
        state: 'rejected',
        message: `Order ${order.number} was cancelled. If you have already sent payment, message us on WhatsApp with this order number and we will sort it out.`,
      }
    : { state: 'paid' }
}

/** 前台轮询和后台重核都走这里 */
export async function recheckPayment(orderNumber: string): Promise<PaymentState> {
  // 超额时回 pending 而不是 rejected：轮询的是真买家，
  // 这一轮不去打链上接口就好，别在人家付款页上弹一个红字
  if (!(await allow('recheck'))) {
    return { state: 'pending', message: 'Still verifying — hang tight.' }
  }

  const found = await loadPayable(orderNumber)
  if (found.error) return found.error

  const { order, item } = found
  // 已经放行过的回 paid，轮询的前台看到就会停下来
  if (order.status !== 'PENDING') return notPending(order)
  if (!order.cryptoTxid) return { state: 'pending', message: 'Submit your transaction ID first.' }
  return settle(order, item, order.cryptoTxid)
}

type Payable = Awaited<ReturnType<typeof findPayable>>

async function findPayable(orderNumber: string) {
  return db.order.findUnique({
    where: { number: orderNumber },
    select: {
      id: true,
      number: true,
      status: true,
      paymentMethod: true,
      cryptoAsset: true,
      cryptoAmount: true,
      cryptoAddress: true,
      cryptoTxid: true,
      createdAt: true,
    },
  })
}

async function loadPayable(orderNumber: string): Promise<
  | { error: PaymentState; order?: undefined; item?: undefined }
  | { error: null; order: NonNullable<Payable>; item: ReturnType<typeof asset> }
> {
  const order = await findPayable(orderNumber)

  // 状态不在这里判：调用方要先把哈希落库再看状态，
  // 否则已取消订单收到的那笔钱就彻底没了记录。
  if (!order || order.paymentMethod !== 'crypto' || !order.cryptoAmount) {
    return { error: { state: 'rejected', message: 'Order not found.' } }
  }
  if (!isAssetKey(order.cryptoAsset)) {
    return { error: { state: 'rejected', message: 'Order not found.' } }
  }

  return { error: null, order, item: asset(order.cryptoAsset) }
}

/**
 * 核验并在通过时放行。
 *
 * 地址一律用下单时快照的那一个 —— 客户就是照着它转的账，后台之后换没换
 * 都改变不了这笔已经发生的转账。现取会把换地址那一刻所有在途付款判成
 * 「没转到我们地址」，而且是 rejected 不是 pending，重核多少次都翻不了案。
 * 快照为空只可能是加这一列之前的老订单，那才退回现取。
 */
async function settle(
  order: NonNullable<Payable>,
  item: ReturnType<typeof asset>,
  txid: string,
): Promise<PaymentState> {
  const address = order.cryptoAddress?.trim() || (await payableAsset(item.key))?.address
  if (!address) return { state: 'pending', message: 'Verifying — our team will confirm shortly.' }

  const verdict = await verifyPayment(
    item,
    address,
    order.cryptoAmount!,
    txid,
    order.createdAt.getTime(),
  )

  if (verdict.state === 'paid') {
    // 带上 status 条件，两个并发的核验只会有一个真正改到状态
    const released = await db.order.updateMany({
      where: { id: order.id, status: 'PENDING' },
      data: { status: 'PAID', cryptoVerifiedAt: new Date() },
    })
    if (released.count) {
      revalidatePath('/admin/orders')
      revalidatePath(`/admin/orders/${order.number}`)
    }
    return { state: 'paid' }
  }

  const state = verdict.state === 'rejected' ? 'rejected' : 'pending'
  return { state, message: REASON_COPY[verdict.reason].en, reason: verdict.reason }
}

/** 访客订单查询：单号和邮箱都对上才给看 */
export async function findOrder(
  input: unknown,
): Promise<{ ok: true; number: string } | { ok: false; message: string }> {
  if (!(await allow('lookup'))) {
    return { ok: false, message: 'Too many attempts. Please wait a few minutes.' }
  }

  const parsed = z
    .object({ number: z.string().trim().min(1).max(32), email: z.email() })
    .safeParse(input)
  if (!parsed.success) return { ok: false, message: 'Enter your order number and email.' }

  const order = await db.order.findUnique({
    where: { number: parsed.data.number.toUpperCase() },
    select: { number: true, email: true },
  })
  if (!order || order.email.toLowerCase() !== parsed.data.email.toLowerCase()) {
    return { ok: false, message: "We couldn't find an order with those details." }
  }

  return { ok: true, number: order.number }
}

export type ImageSearchState = ImageSearchResult | { kind: 'error'; message: string }

/**
 * 拍照/截图找货。全站唯一不登录就能传文件的口子，信任边界在这儿。
 *
 * 顺序是有讲究的，每一步都比下一步便宜：
 * 限流 → 卡字节 → 读文件头认格式和像素 → 才真的解码跑推理。
 * 一次推理是几百毫秒 CPU 而且全站串行，把它放到最后才不会被人拿来当 DoS 开关。
 */
export async function lookupByImage(formData: FormData): Promise<ImageSearchState> {
  if (!(await allow('imageSearch'))) {
    return { kind: 'error', message: 'Too many searches. Please wait a moment.' }
  }

  const file = formData.get('image')
  if (!(file instanceof File) || file.size === 0) {
    return { kind: 'error', message: 'Choose a photo first.' }
  }
  if (file.size > MAX_IMAGE_BYTES) {
    return { kind: 'error', message: `Image must be under ${MAX_IMAGE_BYTES / 1024 / 1024}MB.` }
  }

  const buffer = Buffer.from(await file.arrayBuffer())
  // file.type 是客户端说了算的，改个名就能绕过，所以只认真实字节
  if (!(await sniffImage(buffer)).ok) {
    return { kind: 'error', message: 'That file is not a readable image.' }
  }

  try {
    return await searchByImage(buffer)
  } catch {
    return { kind: 'error', message: "We couldn't read that image. Try another one." }
  }
}
