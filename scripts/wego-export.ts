/**
 * 把自己微购相册里的商品拉下来，做成后台「批量导入」能吃的 CSV + 图片。
 *
 * 微购没有开放接口，商品列表要登录态。微信扫码走官方网页，脚本不碰登录协议，
 * 只在你扫完之后用同一个浏览器会话去翻 /album/personal/all。
 *
 * 第一次：
 *   npm i -D playwright
 *   npx playwright install chrome
 *   npx tsx scripts/wego-export.ts
 *
 * 扫码一次后 cookie 会写到 data/wego-export/cookies.txt，下次不用再扫。
 * 已经在 Chrome 里登录过的，也可以自己从 DevTools 复制 Cookie：
 *   npx tsx scripts/wego-export.ts --cookie "token=...; sl-session=..."
 *
 * 可选：--brand Northwell --category totes --cny 7 --limit 20 --no-images
 */
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'

import { MIN_PRICE_CENTS } from '../src/lib/totals'

const DEFAULT_SHOP = '_dw2i3yx6p-eT3_Dwvzrwjla82miqND_71SxpXug'
const HOST = 'https://www.szwego.com'
const LIST_PATH = '/album/personal/all'
const LOGIN_URL = `${HOST}/static/index.html`
const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0.0.0 Safari/537.36'
const MAX_IMAGES = 12
const PAGE_GAP_MS = 400
const IMAGE_GAP_MS = 80
const LOGIN_TIMEOUT_MS = 5 * 60 * 1000

type Args = {
  shop: string
  cookie: string
  cookieFile: string
  out: string
  brand: string
  category: string
  cny: number
  limit: number
  images: boolean
  check: boolean
  fromRaw: boolean
}

type WegoItem = Record<string, unknown>

type Listed = {
  id: string
  title: string
  description: string
  priceCny: number | null
  colors: string
  sizes: string
  stock: number | null
  imageUrls: string[]
}

function argValue(argv: string[], name: string, fallback: string): string {
  const at = argv.indexOf(name)
  return at >= 0 && argv[at + 1] ? argv[at + 1] : fallback
}

function parseArgs(argv: string[]): Args {
  const url = argValue(argv, '--url', '')
  const fromUrl = url ? new URL(url).searchParams.get('shopId') ?? '' : ''
  return {
    shop: argValue(argv, '--shop', fromUrl || DEFAULT_SHOP),
    cookie: argValue(argv, '--cookie', ''),
    cookieFile: argValue(argv, '--cookie-file', 'data/wego-export/cookies.txt'),
    out: argValue(argv, '--out', 'data/wego-export'),
    brand: argValue(argv, '--brand', 'Wego'),
    category: argValue(argv, '--category', 'totes'),
    cny: Number(argValue(argv, '--cny', '7')),
    limit: Number(argValue(argv, '--limit', '0')),
    images: !argv.includes('--no-images'),
    check: argv.includes('--check'),
    fromRaw: argv.includes('--from-raw'),
  }
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function slugify(raw: string): string {
  return raw
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 120)
}

function csvCell(value: string): string {
  return /[",\n\r]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value
}

function asRecord(value: unknown): WegoItem | null {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as WegoItem) : null
}

function asList(value: unknown): unknown[] {
  return Array.isArray(value) ? value : []
}

function text(item: WegoItem, keys: string[]): string {
  for (const key of keys) {
    const value = item[key]
    if (typeof value === 'string' && value.trim()) return value.trim()
    if (typeof value === 'number' && Number.isFinite(value)) return String(value)
  }
  return ''
}

function numberish(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value) && value > 0) return value
  if (typeof value === 'string') {
    const n = Number(value.replace(/[$¥￥,，\s]/g, ''))
    if (Number.isFinite(n) && n > 0) return n
  }
  return null
}

/** 文案里常见「¥199 / 199元 / 价格：199」 */
export function priceFromCaption(caption: string): number | null {
  const match = caption.match(/(?:¥|￥|价格[:：]\s*)(\d+(?:\.\d+)?)|(\d+(?:\.\d+)?)\s*元/)
  return match ? Number(match[1] || match[2]) : null
}

function collectPrices(item: WegoItem): number[] {
  const found: number[] = []
  const push = (value: unknown) => {
    const n = numberish(value)
    if (n) found.push(n)
  }
  push(item.price)
  push(item.itemPrice)
  for (const entry of asList(item.priceArr)) {
    const row = asRecord(entry)
    push(row ? (row.price ?? row.value ?? row.salePrice) : entry)
  }
  const map = asRecord(item.skuPriceMap) ?? asRecord(item.skuPriceActivityMap)
  if (map) for (const value of Object.values(map)) push(value)
  for (const sku of asList(item.skus)) {
    const row = asRecord(sku)
    if (row) push(row.price ?? row.salePrice)
  }
  const fromText = priceFromCaption(text(item, ['title', 'subTitle', 'itemName', 'caption', 'goodsDesc']))
  if (fromText) found.push(fromText)
  return found
}

function collectNames(value: unknown): string[] {
  const names: string[] = []
  for (const entry of asList(value)) {
    if (typeof entry === 'string' && entry.trim()) names.push(entry.trim())
    const row = asRecord(entry)
    const name = row ? text(row, ['name', 'value', 'color', 'format', 'size', 'title']) : ''
    if (name) names.push(name)
  }
  return [...new Set(names)]
}

function collectImages(item: WegoItem): string[] {
  const urls: string[] = []
  const push = (value: unknown) => {
    if (typeof value === 'string' && /^https?:\/\//i.test(value)) {
      urls.push(value.replace(/\?imageMogr2.*$/, ''))
    }
    const row = asRecord(value)
    if (!row) return
    for (const key of ['url', 'src', 'imgSrc', 'href', 'qiniuUrl', 'urlQiniu', 'originUrl', 'photoUrl']) {
      const found = row[key]
      if (typeof found === 'string' && /^https?:\/\//i.test(found)) urls.push(found)
    }
  }
  for (const key of ['imgsSrc', 'imgs', 'images', 'itemPhotoList', 'searchImgs', 'photos']) {
    const value = item[key]
    if (typeof value === 'string') value.split(/[|,\s]+/).forEach(push)
    else asList(value).forEach(push)
  }
  const single = text(item, ['cover', 'coverUrl', 'image'])
  if (single) push(single)
  const all = [...new Set(urls.map((url) => url.replace(/^http:\/\//i, 'https://')))]
  const video = all.find((url) => /\.(mp4|webm|mov|m4v|m3u8)(\?|$)/i.test(url.split(/[?#]/)[0] ?? '')) ?? null
  const images = all.filter((url) => url !== video).slice(0, MAX_IMAGES)
  return video ? [...images, video] : images
}

export function normalizeItem(item: WegoItem): Listed | null {
  const id = text(item, ['goods_id', 'goodsId', 'itemId', 'id', 'themeId'])
  const description = text(item, ['title', 'subTitle', 'itemName', 'caption', 'goodsDesc', 'desc'])
  if (!id && !description) return null
  const firstLine = description.split(/\r?\n/).map((line) => line.trim()).find(Boolean) ?? ''
  const prices = collectPrices(item)
  const stockRaw = numberish(item.stock ?? item.totalStock ?? item.itemStorageStock)
  return {
    id: id || slugify(firstLine) || `row-${Math.random().toString(36).slice(2, 8)}`,
    title: (firstLine || `wego ${id}`).slice(0, 200),
    description: (description || firstLine || 'Imported from Wego').slice(0, 4000),
    priceCny: prices.length ? Math.min(...prices) : null,
    colors: collectNames(item.colors).join(', '),
    sizes: collectNames(item.formats).join(', ') || collectNames(item.sizes).join(', '),
    stock: stockRaw !== null ? Math.round(stockRaw) : null,
    imageUrls: collectImages(item),
  }
}

function usdPrice(cny: number | null, rate: number): string {
  const min = MIN_PRICE_CENTS / 100
  if (cny === null) return min.toFixed(2)
  const usd = rate > 0 ? cny / rate : cny
  return Math.max(min, Math.round(usd * 100) / 100).toFixed(2)
}

function shopSlug(id: string): string {
  return `wego-${slugify(id) || id.replace(/[^a-zA-Z0-9]+/g, '').slice(0, 40)}`
}

function listUrl(shop: string, timestamp: string): string {
  const q = new URLSearchParams({
    albumId: shop,
    searchValue: '',
    searchImg: '',
    startDate: '',
    endDate: '',
    requestDataType: '',
    isFilter: 'true',
    tagList: '[]',
    timestamp,
  })
  return `${HOST}${LIST_PATH}?${q}`
}

type Client = {
  getJson: (url: string) => Promise<unknown>
  getBuffer: (url: string) => Promise<{ buffer: Buffer; type: string }>
}

function headers(cookie: string): Record<string, string> {
  return {
    accept: 'application/json, text/plain, */*',
    'user-agent': UA,
    referer: `${HOST}/`,
    cookie,
  }
}

function cookieClient(cookie: string): Client {
  return {
    async getJson(url) {
      const res = await fetch(url, { headers: headers(cookie) })
      if (!res.ok) throw new Error(`${url} → HTTP ${res.status}`)
      return res.json()
    },
    async getBuffer(url) {
      const res = await fetch(url, { headers: { 'user-agent': UA, referer: `${HOST}/`, accept: 'image/*' } })
      if (!res.ok) throw new Error(`图片 HTTP ${res.status}`)
      return { buffer: Buffer.from(await res.arrayBuffer()), type: res.headers.get('content-type') ?? '' }
    },
  }
}

function expired(payload: unknown): boolean {
  const row = asRecord(payload)
  if (!row) return false
  const err = row.errcode
  const msg = String(row.errmsg ?? '')
  return err === 9 || err === '9' || msg.includes('登录') || row.success === false && msg.includes('过期')
}

function readItems(payload: unknown): { items: WegoItem[]; next: string; more: boolean } {
  const root = asRecord(payload)
  const result = asRecord(root?.result) ?? root
  if (!result) return { items: [], next: '', more: false }
  const raw = result.items ?? result.goodsList ?? result.list ?? result.records
  const items = asList(raw).map(asRecord).filter((row): row is WegoItem => !!row)
  const paging = asRecord(result.pagination) ?? asRecord(result.page) ?? {}
  const next = String(paging.pageTimestamp ?? paging.timestamp ?? result.pageTimestamp ?? '')
  const more = paging.isLoadMore === true || paging.hasMore === true || (items.length > 0 && !!next)
  return { items, next, more }
}

async function fetchAll(client: Client, shop: string, limit: number): Promise<WegoItem[]> {
  const all: WegoItem[] = []
  let timestamp = ''
  for (let page = 1; page <= 5000; page++) {
    const payload = await client.getJson(listUrl(shop, timestamp))
    if (expired(payload)) throw new Error('登录已过期，删掉 data/wego-export/cookies.txt 再跑一次扫码')
    const { items, next, more } = readItems(payload)
    if (!items.length) {
      const root = asRecord(payload)
      if (root && root.success === false) throw new Error(String(root.errmsg ?? '相册接口失败'))
      break
    }
    all.push(...items)
    console.log(`  第 ${page} 页 ${items.length} 条，累计 ${all.length}`)
    if (limit && all.length >= limit) return all.slice(0, limit)
    if (!more || !next || next === timestamp) break
    timestamp = next
    await sleep(PAGE_GAP_MS)
  }
  return all
}

async function loadCookie(args: Args): Promise<string> {
  if (args.cookie) return args.cookie.trim()
  try {
    const saved = (await readFile(args.cookieFile, 'utf8')).trim()
    if (saved) return saved
  } catch {
    /* 没有缓存就去扫码 */
  }
  return ''
}

async function saveCookie(file: string, cookie: string) {
  await mkdir(path.dirname(file), { recursive: true })
  await writeFile(file, cookie, 'utf8')
}

type PlaywrightModule = {
  chromium: {
    launch: (opts?: { headless?: boolean; channel?: string }) => Promise<{
      newContext: (opts?: object) => Promise<{
        newPage: () => Promise<{ goto: (url: string, opts?: object) => Promise<unknown> }>
        request: {
          get: (url: string, opts?: object) => Promise<{
            ok: () => boolean
            json: () => Promise<unknown>
            status: () => number
          }>
        }
        cookies: () => Promise<Array<{ name: string; value: string }>>
        close: () => Promise<void>
      }>
      close: () => Promise<void>
    }>
  }
}

async function loadPlaywright(): Promise<PlaywrightModule | null> {
  try {
    return (await import('playwright')) as PlaywrightModule
  } catch {
    return null
  }
}

async function loginWithWechat(shop: string): Promise<string> {
  const pw = await loadPlaywright()
  if (!pw) {
    throw new Error(
      '要弹窗扫码得先装 Playwright：npm i -D playwright && npx playwright install chrome\n或者自己从已登录的 Chrome 复制 Cookie，加 --cookie "..."',
    )
  }

  let browser
  try {
    browser = await pw.chromium.launch({ headless: false, channel: 'chrome' })
  } catch {
    browser = await pw.chromium.launch({ headless: false })
  }

  const context = await browser.newContext({ userAgent: UA, viewport: { width: 1280, height: 800 } })
  const page = await context.newPage()
  await page.goto(LOGIN_URL, { waitUntil: 'domcontentloaded' })
  console.log('已打开微购网页。用微信扫码登录，扫完后回到这个窗口等即可，不要关浏览器。')

  const started = Date.now()
  let cookie = ''
  try {
    while (Date.now() - started < LOGIN_TIMEOUT_MS) {
      const cookies = await context.cookies()
      cookie = cookies.map((row) => `${row.name}=${row.value}`).join('; ')
      if (!cookie) {
        await sleep(2000)
        continue
      }
      try {
        const res = await context.request.get(listUrl(shop, ''), {
          headers: { referer: `${HOST}/`, 'user-agent': UA },
        })
        if (res.ok()) {
          const payload = await res.json()
          if (!expired(payload)) {
            console.log('登录成功')
            return cookie
          }
        }
      } catch {
        /* 还没登上 */
      }
      await sleep(2000)
    }
    throw new Error('等了 5 分钟还没扫码成功，再跑一次')
  } finally {
    await browser.close()
  }
}

function imageExt(url: string, type: string): string {
  if (type.includes('png')) return 'png'
  if (type.includes('webp')) return 'webp'
  if (type.includes('gif')) return 'gif'
  const match = url.match(/\.(jpe?g|png|webp|gif)(?:$|\?)/i)
  return match ? match[1].replace(/jpeg/i, 'jpg').toLowerCase() : 'jpg'
}

async function downloadImages(client: Client, listed: Listed[], dir: string) {
  await mkdir(dir, { recursive: true })
  for (const item of listed) {
    const names: string[] = []
    for (const [index, url] of item.imageUrls.entries()) {
      try {
        const { buffer, type } = await client.getBuffer(url)
        const ext = imageExt(url, type)
        const name = `${shopSlug(item.id)}-${String(index + 1).padStart(2, '0')}.${ext}`
        await writeFile(path.join(dir, name), buffer)
        names.push(name)
      } catch (error) {
        console.log(`  图挂了 ${item.id} #${index + 1}：${(error as Error).message}`)
      }
      await sleep(IMAGE_GAP_MS)
    }
    item.imageUrls = names
    process.stdout.write(`  图 ${listed.indexOf(item) + 1}/${listed.length}\r`)
  }
  console.log('')
}

function toCsv(rows: Listed[], args: Args): string {
  const header = [
    'slug',
    'title',
    'description',
    'details',
    'brand',
    'category',
    'gender',
    'status',
    'price',
    'compare_at',
    'featured',
    'colors',
    'sizes',
    'stock',
    'images',
  ]
  const lines = [header.join(',')]
  for (const row of rows) {
    lines.push(
      [
        shopSlug(row.id),
        csvCell(row.title),
        csvCell(row.description),
        '',
        csvCell(args.brand),
        args.category,
        'unisex',
        'draft',
        usdPrice(row.priceCny, args.cny),
        '',
        'no',
        csvCell(row.colors),
        csvCell(row.sizes),
        row.stock === null ? '' : String(row.stock),
        row.imageUrls.join('|'),
      ].join(','),
    )
  }
  return lines.join('\n') + '\n'
}

async function exportShop(args: Args) {
  let raw: WegoItem[]
  let client: Client | null = null

  if (args.fromRaw) {
    raw = JSON.parse(await readFile(path.join(args.out, 'raw.json'), 'utf8')) as WegoItem[]
    console.log(`用已有 raw.json，${raw.length} 条`)
  } else {
    let cookie = await loadCookie(args)
    if (cookie) {
      try {
        const probe = await cookieClient(cookie).getJson(listUrl(args.shop, ''))
        if (expired(probe)) cookie = ''
      } catch {
        cookie = ''
      }
    }
    if (!cookie) {
      cookie = await loginWithWechat(args.shop)
      await saveCookie(args.cookieFile, cookie)
    }

    client = cookieClient(cookie)
    console.log(`拉相册 ${args.shop}`)
    raw = await fetchAll(client, args.shop, args.limit)
    await mkdir(args.out, { recursive: true })
    await writeFile(path.join(args.out, 'raw.json'), JSON.stringify(raw, null, 2))
  }

  const listed = raw.map(normalizeItem).filter((row): row is Listed => !!row)
  if (!listed.length) throw new Error('相册是空的，或者登录号没权限看这个店')

  await mkdir(args.out, { recursive: true })

  if (args.images) {
    if (!client) {
      const cookie = await loadCookie(args)
      if (!cookie) throw new Error('下图需要登录态，先去掉 --from-raw 扫一次，或加 --cookie')
      client = cookieClient(cookie)
    }
    console.log(`下图到 ${path.join(args.out, 'images')}`)
    await downloadImages(client, listed, path.join(args.out, 'images'))
  } else {
    for (const row of listed) row.imageUrls = row.imageUrls.slice(0, MAX_IMAGES)
  }

  const csv = toCsv(listed, args)
  const csvPath = path.join(args.out, 'products.csv')
  await writeFile(csvPath, `\uFEFF${csv}`, 'utf8')

  const CHUNK = 500
  if (listed.length > CHUNK) {
    for (let i = 0, part = 1; i < listed.length; i += CHUNK, part++) {
      const slice = listed.slice(i, i + CHUNK)
      const name = `products-part-${String(part).padStart(2, '0')}.csv`
      await writeFile(path.join(args.out, name), `\uFEFF${toCsv(slice, args)}`, 'utf8')
    }
    console.log(`超过 ${CHUNK} 行，已拆成 ${Math.ceil(listed.length / CHUNK)} 个 part，后台一次最多导 ${CHUNK} 行`)
  }

  console.log(`写好了 ${listed.length} 件：${csvPath}`)
  console.log('默认都是 draft，类目先填了 totes。导之前用 Excel 改 brand / category / 英文标题。')
}

function selfCheck() {
  let failed = 0
  const ok = (name: string, pass: boolean) => {
    if (!pass) failed++
    console.log(`[${pass ? ' ok ' : 'FAIL'}] ${name}`)
  }

  ok('caption ¥', priceFromCaption('新款托特 ¥199 包邮') === 199)
  ok('caption 元', priceFromCaption('春季款 89.5元') === 89.5)
  ok('csv quote', csvCell('a,b') === '"a,b"')
  ok('csv escape', csvCell('say "hi"') === '"say ""hi"""')
  ok('usd floor', usdPrice(10, 7) === (MIN_PRICE_CENTS / 100).toFixed(2))
  ok('usd convert', usdPrice(140, 7) === '20.00')

  const item = normalizeItem({
    goods_id: 'abc_01',
    title: '帆布托特\n蜡布底',
    price: '199',
    colors: [{ name: 'Sand' }, { name: 'Black' }],
    formats: ['OS'],
    imgs: ['https://xcimg.szwego.com/a.jpg', 'https://xcimg.szwego.com/b.mp4'],
  })
  ok('id', item?.id === 'abc_01')
  ok('title first line', item?.title === '帆布托特')
  ok('keep video', item?.imageUrls.includes('https://xcimg.szwego.com/b.mp4') === true && item.imageUrls.length === 2)
  ok('colors', item?.colors === 'Sand, Black')

  if (failed) process.exit(1)
}

const args = parseArgs(process.argv.slice(2))
if (args.check) selfCheck()
else {
  exportShop(args).catch((error: Error) => {
    console.error(error.message)
    process.exit(1)
  })
}
