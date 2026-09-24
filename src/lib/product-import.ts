import { lookup } from 'node:dns/promises'
import { z } from 'zod'
import { db } from './db'
import { sniffImage } from './images'
import { partitionMedia } from './media'
import { MIN_PRICE_CENTS } from './totals'
import { syncVariants } from './variants'

/**
 * 商品批量导入。
 *
 * 分两步走是被 Cloudflare 逼的：免费版单次请求 100 秒就断，而抓图加编码
 * 每个商品要好几秒，一次请求做不完两百个商品。所以这里只负责把表格变成
 * 「商品 + 规格 + 库存」落库（纯数据库写入，几百行一秒内完事），
 * 图片交给 fetchProductImages 一个商品一次地抓，由浏览器驱动。
 */

// ---------- CSV ----------

/**
 * 够用的 CSV 解析。不引依赖是因为真正要处理的只有引号里的逗号和换行，
 * 而商品描述里这两样一定会出现，naive 的 split(',') 一定会错。
 *
 * 认双引号转义（""）、CRLF、以及 Excel 另存为 UTF-8 时带的 BOM。
 */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = []
  let row: string[] = []
  let field = ''
  let quoted = false

  // Excel 存 UTF-8 CSV 会在开头塞 BOM，不剥掉的话第一个表头永远匹配不上
  let i = text.charCodeAt(0) === 0xfeff ? 1 : 0

  for (; i < text.length; i++) {
    const c = text[i]
    if (quoted) {
      if (c !== '"') field += c
      else if (text[i + 1] === '"') (field += '"'), i++
      else quoted = false
      continue
    }
    if (c === '"') quoted = true
    else if (c === ',') (row.push(field), (field = ''))
    else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++
      row.push(field)
      rows.push(row)
      row = []
      field = ''
    } else field += c
  }
  if (field !== '' || row.length) {
    row.push(field)
    rows.push(row)
  }

  // 整行皆空的丢掉：表格尾部拖出来的空行是常态，不该当成一条错误商品
  return rows.filter((cells) => cells.some((cell) => cell.trim() !== ''))
}

// ---------- 表头 ----------

export const IMPORT_COLUMNS = [
  { key: 'slug', label: '网址后缀', hint: '留空则按标题生成；重复导入靠它认出是同一件商品' },
  { key: 'title', label: '商品名', hint: '必填' },
  { key: 'description', label: '描述', hint: '必填' },
  { key: 'details', label: '细节', hint: '面料、尺码建议等，用 | 分行' },
  { key: 'brand', label: '品牌', hint: '填 slug 或品牌名；库里没有会自动新建' },
  { key: 'category', label: '类目', hint: '填 slug 或类目名，如 sneakers / 运动鞋' },
  { key: 'gender', label: '性别', hint: 'men / women / unisex，留空为 unisex' },
  { key: 'status', label: '状态', hint: 'active / draft / archived，留空为 active' },
  { key: 'price', label: '售价', hint: 'Premium 价，按美元填。Exclusive 自动加 $90–$150' },
  { key: 'compare_at', label: '划线价', hint: '选填，按美元填' },
  { key: 'featured', label: '首页精选', hint: 'yes / no' },
  { key: 'colors', label: '颜色', hint: '如 Black:#141414, Sand' },
  { key: 'sizes', label: '尺码', hint: '如 S,M,L,XL' },
  { key: 'stock', label: '库存', hint: '每个规格各这么多件，留空则新规格 1000、已有规格不改' },
  {
    key: 'images',
    label: '图片',
    hint: '文件名或直链，多张用 | 隔开。夹一条 mp4/webm 会当成详情页视频，不当图片',
  },
] as const

export type ColumnKey = (typeof IMPORT_COLUMNS)[number]['key']

/** 一次提交的行数上限。纯数据库写入很快，这个数只是防手滑传错文件 */
export const MAX_IMPORT_ROWS = 500

/** 单个商品最多抓这么多张图，和后台手动上传的上限一致 */
export const MAX_IMPORT_IMAGES = 12

// ---------- 单元格解析 ----------

const GENDERS: Record<string, 'MEN' | 'WOMEN' | 'UNISEX'> = {
  men: 'MEN',
  man: 'MEN',
  male: 'MEN',
  男: 'MEN',
  男士: 'MEN',
  women: 'WOMEN',
  woman: 'WOMEN',
  female: 'WOMEN',
  女: 'WOMEN',
  女士: 'WOMEN',
  unisex: 'UNISEX',
  通用: 'UNISEX',
  中性: 'UNISEX',
}

const STATUSES: Record<string, 'DRAFT' | 'ACTIVE' | 'ARCHIVED'> = {
  active: 'ACTIVE',
  上架: 'ACTIVE',
  draft: 'DRAFT',
  草稿: 'DRAFT',
  archived: 'ARCHIVED',
  下架: 'ARCHIVED',
  归档: 'ARCHIVED',
}

const TRUTHY = new Set(['yes', 'y', 'true', '1', '是', '对'])

/** 表格里的价格是给人看的：可能带货币符号和千分位，也可能就是个整数 */
function toCents(raw: string): number | null {
  const cleaned = raw.replace(/[$¥,，\s]/g, '')
  if (!cleaned) return null
  const value = Number(cleaned)
  if (!Number.isFinite(value) || value < 0) return null
  return Math.round(value * 100)
}

export function slugify(raw: string): string {
  return raw
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 120)
}

/** 微购标题里的「💰420」是进货报价，不要出现在前台描述里。 */
export function stripQuotedPrice(text: string) {
  return text
    .replace(/💰\s*\d+(?:\.\d+)?\s*[,，]?/g, ' ')
    .replace(/💰/g, ' ')
    .replace(/[ \t]{2,}/g, ' ')
    .replace(/^\s*[,，]\s*/, '')
    .trim()
}

/** 图片列可能用 | 分隔，也可能是直接粘的一串空白分隔的网址 */
function splitUrls(raw: string): string[] {
  return raw
    .split(/[|\n\r\s]+/)
    .map((entry) => entry.trim())
    .filter(Boolean)
}

// ---------- 计划 ----------

export type RowIssue = { line: number; message: string }

export type PlannedRow = {
  line: number
  action: 'create' | 'update'
  values: {
    slug: string
    title: string
    description: string
    details: string | null
    brandId: string
    categoryId: string
    gender: 'MEN' | 'WOMEN' | 'UNISEX'
    status: 'DRAFT' | 'ACTIVE' | 'ARCHIVED'
    priceCents: number
    compareAtCents: number | null
    featured: boolean
  }
  /** 品牌可能还没建，落库前用它换真实 id */
  brandSlug: string
  brandLabel: string
  categoryLabel: string
  colors: string
  sizes: string
  /** null 表示这一格是空的。重新导入时不动已有库存，只有真填了数才覆盖 */
  stock: number | null
  images: string[]
  /** undefined：图片格是空的，重导不改已有视频。null：这行有图但没有视频，清掉 */
  videoUrl?: string | null
}

export type ImportResult = {
  created: number
  updated: number
  brands: string[]
  issues: RowIssue[]
  /** 还需要抓图的商品。交给浏览器一个一个来，避免单次请求超时 */
  pending: { slug: string; title: string; images: string[] }[]
}

export type ImportPlan = {
  rows: PlannedRow[]
  issues: RowIssue[]
  /** 库里还没有、导入时会顺手建出来的品牌。列出来是为了让人一眼看见拼错的名字 */
  newBrands: { slug: string; name: string }[]
  categories: string[]
}

const rowSchema = z.object({
  title: z.string().trim().min(1, '商品名必填').max(200),
  description: z.string().trim().min(1, '描述必填').max(4000),
  details: z.string().trim().max(4000),
  colors: z.string().trim().max(500),
  sizes: z.string().trim().max(500),
})

/**
 * 把表格变成一份「将要发生什么」的清单，不碰数据库写入。
 * 预览和真正导入跑的是同一个函数，所见即所得。
 */
export async function buildPlan(text: string): Promise<ImportPlan> {
  const table = parseCsv(text)
  const issues: RowIssue[] = []
  if (!table.length) return { rows: [], issues: [{ line: 0, message: '文件是空的' }], newBrands: [], categories: [] }

  const header = table[0].map((cell) => cell.trim().toLowerCase().replace(/\s+/g, '_'))
  const known = new Set<string>(IMPORT_COLUMNS.map((c) => c.key))
  const index = new Map<string, number>()
  header.forEach((name, at) => {
    if (known.has(name) && !index.has(name)) index.set(name, at)
  })

  for (const required of ['title', 'description', 'brand', 'category', 'price'] as const) {
    if (!index.has(required)) {
      issues.push({ line: 1, message: `表头缺少必需的列：${required}` })
    }
  }
  if (issues.length) return { rows: [], issues, newBrands: [], categories: [] }

  const body = table.slice(1)
  if (body.length > MAX_IMPORT_ROWS) {
    return {
      rows: [],
      issues: [{ line: 1, message: `一次最多 ${MAX_IMPORT_ROWS} 行，这份有 ${body.length} 行` }],
      newBrands: [],
      categories: [],
    }
  }

  // 类目是种子里固定的叶子节点，后台建不了，所以只能匹配已有的
  const categories = await db.category.findMany({
    where: { parentId: { not: null } },
    select: { id: true, slug: true, name: true, nameZh: true },
  })
  const categoryBy = new Map<string, (typeof categories)[number]>()
  for (const row of categories) {
    for (const key of [row.slug, row.name, row.nameZh]) categoryBy.set(key.toLowerCase(), row)
  }

  const brands = await db.brand.findMany({ select: { id: true, slug: true, name: true } })
  const brandBy = new Map<string, (typeof brands)[number]>()
  for (const row of brands) {
    brandBy.set(row.slug.toLowerCase(), row)
    brandBy.set(row.name.toLowerCase(), row)
  }

  const existing = new Map(
    (await db.product.findMany({ select: { id: true, slug: true } })).map((p) => [p.slug, p.id]),
  )

  const newBrands = new Map<string, { slug: string; name: string }>()
  const rows: PlannedRow[] = []
  const seen = new Map<string, number>()

  for (const [offset, cells] of body.entries()) {
    // 表头占第 1 行，所以正文从第 2 行起，报错时对得上人看到的行号
    const line = offset + 2
    const cell = (key: ColumnKey) => {
      const at = index.get(key)
      return at === undefined ? '' : (cells[at] ?? '').trim()
    }
    const fail = (message: string) => issues.push({ line, message })

    const parsed = rowSchema.safeParse({
      title: cell('title'),
      description: stripQuotedPrice(cell('description')),
      details: cell('details'),
      colors: cell('colors'),
      sizes: cell('sizes'),
    })
    if (!parsed.success) {
      fail(parsed.error.issues[0].message)
      continue
    }
    const data = parsed.data

    const slug = slugify(cell('slug') || data.title)
    if (!slug) {
      fail('生成不出网址后缀，请手动填一个 slug 列')
      continue
    }
    const clash = seen.get(slug)
    if (clash) {
      fail(`网址后缀 ${slug} 和第 ${clash} 行重复了`)
      continue
    }
    seen.set(slug, line)

    const priceCents = toCents(cell('price'))
    if (priceCents === null) {
      fail(`售价「${cell('price')}」读不出来，按美元填，如 129.00`)
      continue
    }
    if (priceCents < MIN_PRICE_CENTS) {
      fail(`售价不能低于 ${MIN_PRICE_CENTS / 100} 美元，否则客户选不带盒会算出 0 元订单`)
      continue
    }

    const compareRaw = cell('compare_at')
    const compareAtCents = compareRaw ? toCents(compareRaw) : null
    if (compareRaw && compareAtCents === null) {
      fail(`划线价「${compareRaw}」读不出来`)
      continue
    }

    const categoryKey = cell('category').toLowerCase()
    const category = categoryBy.get(categoryKey)
    if (!category) {
      fail(`没有「${cell('category')}」这个类目。可选：${categories.map((c) => c.slug).join('、')}`)
      continue
    }

    const brandRaw = cell('brand')
    const brandSlug = slugify(brandRaw)
    if (!brandSlug) {
      // 品牌 slug 要进网址（/brands/northwell），纯中文名剥完就空了。
      // 分开报：没填和填了但没法当网址，是两回事
      fail(brandRaw ? `品牌「${brandRaw}」里没有能用作网址的字符，先去品牌页建好再导` : '品牌必填')
      continue
    }
    const brand = brandBy.get(brandRaw.toLowerCase()) ?? brandBy.get(brandSlug)
    if (!brand) newBrands.set(brandSlug, { slug: brandSlug, name: brandRaw })

    const genderRaw = cell('gender').toLowerCase()
    const gender = genderRaw ? GENDERS[genderRaw] : 'UNISEX'
    if (!gender) {
      fail(`性别「${cell('gender')}」认不出来，填 men / women / unisex`)
      continue
    }

    const statusRaw = cell('status').toLowerCase()
    const status = statusRaw ? STATUSES[statusRaw] : 'ACTIVE'
    if (!status) {
      fail(`状态「${cell('status')}」认不出来，填 active / draft / archived`)
      continue
    }

    const stockRaw = cell('stock')
    const stock = stockRaw ? Number(stockRaw) : null
    if (stock !== null && (!Number.isInteger(stock) || stock < 0 || stock > 100_000)) {
      fail(`库存「${stockRaw}」要填 0 到 100000 之间的整数`)
      continue
    }

    const listed = splitUrls(cell('images'))
    const media = listed.length ? partitionMedia(listed) : null

    rows.push({
      line,
      action: existing.has(slug) ? 'update' : 'create',
      values: {
        slug,
        title: data.title,
        description: data.description,
        details: data.details ? data.details.split('|').join('\n') : null,
        // 品牌可能还不存在，落库前再补上真实 id
        brandId: brand?.id ?? '',
        categoryId: category.id,
        gender,
        status,
        priceCents,
        compareAtCents,
        featured: TRUTHY.has(cell('featured').toLowerCase()),
      },
      brandSlug,
      brandLabel: brand?.name ?? brandRaw,
      categoryLabel: category.name,
      colors: data.colors,
      sizes: data.sizes,
      stock,
      images: media?.images ?? [],
      ...(media ? { videoUrl: media.video } : {}),
    })
  }

  return {
    rows,
    issues,
    newBrands: [...newBrands.values()],
    categories: categories.map((c) => c.slug),
  }
}

// ---------- 落库 ----------

/**
 * 按计划写库。只写商品、规格和库存，图片另外抓——抓图慢，
 * 几百个商品挤在一次请求里会撞上 Cloudflare 那 100 秒的上限。
 *
 * 鉴权和缓存刷新留在调用它的 server action 里，这样冲烟能直接测这段。
 */
export async function applyPlan(plan: ImportPlan): Promise<ImportResult> {
  const issues = [...plan.issues]
  if (!plan.rows.length) return { created: 0, updated: 0, brands: [], issues, pending: [] }

  // 缺的品牌先建出来，否则商品挂不上外键
  const brandIds = new Map<string, string>()
  for (const brand of plan.newBrands) {
    const row = await db.brand.upsert({
      where: { slug: brand.slug },
      update: {},
      create: { slug: brand.slug, name: brand.name || brand.slug },
      select: { id: true },
    })
    brandIds.set(brand.slug, row.id)
  }

  let created = 0
  let updated = 0
  const pending: ImportResult['pending'] = []

  for (const row of plan.rows) {
    const brandId = row.values.brandId || brandIds.get(row.brandSlug)
    if (!brandId) {
      issues.push({ line: row.line, message: `品牌 ${row.brandSlug} 建不出来` })
      continue
    }

    const values = {
      ...row.values,
      brandId,
      ...(row.videoUrl !== undefined ? { videoUrl: row.videoUrl } : {}),
    }
    const product = await db.product.upsert({
      where: { slug: values.slug },
      update: values,
      create: values,
      select: { id: true },
    })
    row.action === 'create' ? created++ : updated++

    await syncVariants(product.id, values.slug, row.colors, row.sizes)

    // 空着的库存格不动已有库存：改个描述重传一次，不该把仓库数字清零
    if (row.stock !== null) {
      await db.productVariant.updateMany({
        where: { productId: product.id },
        data: { stock: row.stock },
      })
    }

    // 已经有图的不再抓，所以中断后重传同一份表能接着走，不会堆出重复图
    if (row.images.length) {
      const has = await db.productImage.count({ where: { productId: product.id } })
      if (!has) pending.push({ slug: values.slug, title: values.title, images: row.images })
    }
  }

  return { created, updated, brands: plan.newBrands.map((brand) => brand.slug), issues, pending }
}

// ---------- 远程图片 ----------

const MAX_IMAGE_BYTES = 12 * 1024 * 1024
const FETCH_TIMEOUT_MS = 20_000
const MAX_REDIRECTS = 3

/**
 * 内网地址一律不许碰。云服务器上 169.254.169.254 是元数据接口，
 * 能读出实例凭据；127.0.0.1 和 10./172./192.168. 是内网的其它服务。
 * 只要允许后台粘网址，这道门就必须在。
 */
function isPrivateAddress(ip: string): boolean {
  const v4 = /^(\d+)\.(\d+)\.\d+\.\d+$/.exec(ip)
  if (v4) {
    const a = Number(v4[1])
    const b = Number(v4[2])
    if (a === 0 || a === 10 || a === 127 || a >= 224) return true
    if (a === 169 && b === 254) return true
    if (a === 172 && b >= 16 && b <= 31) return true
    if (a === 192 && b === 168) return true
    if (a === 100 && b >= 64 && b <= 127) return true
    return false
  }

  const v6 = ip.toLowerCase()
  if (v6 === '::' || v6 === '::1') return true
  if (/^f[cd]/.test(v6) || v6.startsWith('fe80')) return true
  // ::ffff:10.0.0.1 这种映射写法要按 v4 再判一次，否则等于开了后门
  const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/.exec(v6)
  return mapped ? isPrivateAddress(mapped[1]) : false
}

/**
 * ponytail: 查 DNS 拿到的地址和 fetch 真正连的地址之间有一小段空档，
 * 理论上能被 DNS 重绑定钻过去。堵死要自己按 IP 连再改 Host 头，
 * 而这个接口本来就要后台登录才能调，不值得为它把 HTTP 客户端重写一遍。
 */
async function hostAllowed(hostname: string): Promise<{ ok: true } | { ok: false; message: string }> {
  // 网址里直接写 IP 的情况，DNS 查不查都一样，先自己判一遍
  if (isPrivateAddress(hostname.replace(/^\[|\]$/g, ''))) {
    return { ok: false, message: '不允许内网地址' }
  }
  try {
    const found = await lookup(hostname, { all: true })
    if (found.some((entry) => isPrivateAddress(entry.address))) {
      return { ok: false, message: '这个域名解析到内网地址' }
    }
  } catch {
    return { ok: false, message: '域名解析不了' }
  }
  return { ok: true }
}

export type FetchedImage = { ok: true; buffer: Buffer } | { ok: false; message: string }

/** 把一个外部网址上的图抓回内存。抓回来仍要过 sniffImage，和后台手动上传同一道门 */
export async function fetchRemoteImage(raw: string): Promise<FetchedImage> {
  let url: URL
  try {
    url = new URL(raw)
  } catch {
    return { ok: false, message: `不是合法的网址：${raw}` }
  }

  for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
    if (url.protocol !== 'https:' && url.protocol !== 'http:') {
      return { ok: false, message: `不支持的协议：${url.protocol}` }
    }
    // 每一跳都重新检查：只查第一跳的话，一个 302 就能把我们引到内网
    const guard = await hostAllowed(url.hostname)
    if (!guard.ok) return guard

    let res: Response
    try {
      res = await fetch(url, {
        redirect: 'manual',
        signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
        headers: { accept: 'image/*' },
      })
    } catch (error) {
      return { ok: false, message: `抓不下来：${(error as Error).message}` }
    }

    if (res.status >= 300 && res.status < 400) {
      const next = res.headers.get('location')
      if (!next) return { ok: false, message: '对方要求跳转却没给新地址' }
      url = new URL(next, url)
      continue
    }
    if (!res.ok) return { ok: false, message: `抓不下来：HTTP ${res.status}` }
    if (!res.body) return { ok: false, message: '对方没返回内容' }

    const declared = Number(res.headers.get('content-length') ?? 0)
    if (declared > MAX_IMAGE_BYTES) {
      return { ok: false, message: `图片超过 ${MAX_IMAGE_BYTES / 1024 / 1024}MB` }
    }

    // Content-Length 只是对方的说法，边读边数才拦得住谎报长度的
    const chunks: Buffer[] = []
    let size = 0
    for await (const chunk of res.body as unknown as AsyncIterable<Uint8Array>) {
      size += chunk.byteLength
      if (size > MAX_IMAGE_BYTES) {
        return { ok: false, message: `图片超过 ${MAX_IMAGE_BYTES / 1024 / 1024}MB` }
      }
      chunks.push(Buffer.from(chunk))
    }

    const buffer = Buffer.concat(chunks)
    const sniff = await sniffImage(buffer)
    return sniff.ok ? { ok: true, buffer } : { ok: false, message: sniff.message }
  }

  return { ok: false, message: '跳转太多次了' }
}
