/**
 * 微购 LV 相册 → 本店。同一款的视频帖和图片帖合成一件。
 * Premium = (1029 + 原价人民币) / 6.65，四舍五入到整美元。
 *
 *   npx tsx scripts/import-lv-wego.ts
 *   npx tsx scripts/import-lv-wego.ts --from-raw
 */
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { db } from '../src/lib/db'
import { dropImageIndex } from '../src/lib/image-search'
import { processImage } from '../src/lib/images'
import { isVideoUrl, partitionMedia } from '../src/lib/media'
import { applyPlan, buildPlan, fetchRemoteImage, MAX_IMPORT_IMAGES, stripQuotedPrice } from '../src/lib/product-import'
import { DEFAULT_STOCK } from '../src/lib/variants'

const SHOP = '_dp-i33_B3FumWaQUHC0i3DGuMXKuKYllNMoSNFQ'
const HOST = 'https://www.szwego.com'
const COOKIE_FILE = 'data/wego-export/cookies.txt'
const OUT = 'data/lv-wego'
const RAW = path.join(OUT, 'raw.json')
const CNY_PER_USD = 6.65
const SURCHARGE = 1029
const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0.0.0 Safari/537.36'

const TYPES: { re: RegExp; en: string; category: 'totes' | 'crossbody' | 'backpacks' }[] = [
  { re: /双肩|backpack|背包/i, en: 'Backpack', category: 'backpacks' },
  { re: /水桶|noe|nano|斜挎|腋下|腰包|胸包|相机|pochette|woc|hobo|crossbody/i, en: 'Crossbody', category: 'crossbody' },
  { re: /托特|tote|neverfull|onthego|keepall/i, en: 'Tote', category: 'totes' },
  { re: /speedy|alma|capucines|clutch|handbag|手袋|手提包|手包/i, en: 'Handbag', category: 'totes' },
]

type WegoItem = Record<string, unknown>
type Ready = {
  slug: string
  title: string
  description: string
  details: string
  brand: string
  category: string
  images: string[]
  video: string | null
  price: string
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function asRecord(value: unknown) {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as WegoItem) : null
}

function csvCell(value: string) {
  return /[",\n\r]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value
}

export function premiumUsd(cny: number) {
  return Math.round((SURCHARGE + cny) / CNY_PER_USD).toFixed(2)
}

function captionOf(item: WegoItem) {
  for (const key of ['title', 'subTitle', 'itemName', 'caption', 'goodsDesc', 'desc']) {
    const value = item[key]
    if (typeof value === 'string' && value.trim()) return value.trim()
  }
  return ''
}

function idOf(item: WegoItem) {
  for (const key of ['goods_id', 'goodsId', 'itemId', 'id', 'themeId']) {
    const value = item[key]
    if (typeof value === 'string' && value.trim()) return value.trim()
  }
  return ''
}

function numberish(value: unknown) {
  if (typeof value === 'number' && Number.isFinite(value) && value > 0) return value
  if (typeof value === 'string') {
    const n = Number(value.replace(/[$¥￥,，\s]/g, ''))
    if (Number.isFinite(n) && n > 0) return n
  }
  return null
}

function urlsOf(item: WegoItem) {
  const urls: string[] = []
  const push = (value: unknown) => {
    if (typeof value === 'string' && /^https?:\/\//i.test(value)) {
      urls.push(value.replace(/\?imageMogr2.*$/, '').replace(/^http:\/\//i, 'https://'))
    }
    const row = asRecord(value)
    if (!row) return
    for (const key of ['url', 'src', 'imgSrc', 'href', 'qiniuUrl', 'urlQiniu', 'originUrl', 'photoUrl']) {
      const found = row[key]
      if (typeof found === 'string' && /^https?:\/\//i.test(found)) urls.push(found.replace(/^http:\/\//i, 'https://'))
    }
  }
  for (const key of ['imgsSrc', 'imgs', 'images', 'itemPhotoList', 'searchImgs', 'photos']) {
    const value = item[key]
    if (typeof value === 'string') value.split(/[|,\s]+/).forEach(push)
    else if (Array.isArray(value)) value.forEach(push)
  }
  push(item.videoURL)
  push(item.videoUrl)
  return [...new Set(urls)]
}

function priceCny(item: WegoItem, caption: string) {
  const direct = numberish(item.price) ?? numberish(item.itemPrice)
  if (direct) return direct
  const tagged = caption.match(/(?:¥|￥|💰|价格[:：]\s*)(\d+(?:\.\d+)?)|(\d+(?:\.\d+)?)\s*元/)
  if (tagged) return Number(tagged[1] || tagged[2])
  const lead = caption.match(/^\s*(\d{2,5})(?:\s|【)/)
  return lead ? Number(lead[1]) : null
}

function matchKey(caption: string) {
  const code =
    caption.match(/款号[:：]?\s*([A-Z0-9-]{4,})/i)?.[1] ??
    caption.match(/\b(M\d{4,}|N\d{4,})\b/)?.[0]
  return code ? code.toUpperCase() : ''
}

function bagType(caption: string) {
  for (const type of TYPES) if (type.re.test(caption)) return type
  return { en: 'Bag', category: 'totes' as const }
}

function headline(caption: string) {
  const model =
    caption.match(/款号[:：]?\s*([A-Z0-9-]{4,})/i)?.[1] ??
    caption.match(/\b(M\d{4,}|N\d{4,})\b/)?.[0] ??
    ''
  return ['Louis Vuitton', bagType(caption).en, model.toUpperCase()].filter(Boolean).join(' ').slice(0, 200)
}

function detailsOf(caption: string) {
  const size = caption.match(/(?:size|尺寸)[:：]?\s*([0-9]+(?:\s*[xX×]\s*[0-9]+){1,2}\s*(?:厘米|cm)?)/i)
  const bits = [size ? size[1].replace(/厘米/g, 'cm').replace(/\s*[xX]\s*/g, ' × ') : '']
  if (/牛皮|头层皮/.test(caption)) bits.push('Calfskin')
  if (/帆布|canvas|老花/i.test(caption)) bits.push('Canvas')
  return bits.filter(Boolean).join('|')
}

async function translate(raw: string, cache: Map<string, string>) {
  const text = raw.replace(/\s+/g, ' ').trim().slice(0, 1800)
  if (!text || !/[\u4e00-\u9fff]/.test(text)) return text
  const hit = cache.get(text)
  if (hit) return hit
  const url =
    'https://translate.googleapis.com/translate_a/single?client=gtx&sl=zh-CN&tl=en&dt=t&q=' +
    encodeURIComponent(text)
  try {
    const res = await fetch(url)
    if (!res.ok) return text
    const data = (await res.json()) as [string][][]
    const out = data[0].map((part) => part[0]).join('').replace(/\s+/g, ' ').trim()
    cache.set(text, out)
    return out
  } catch {
    return text
  }
}

function mergePosts(raw: WegoItem[]) {
  const groups = new Map<string, WegoItem[]>()
  for (const item of raw) {
    const caption = captionOf(item)
    if (!caption) continue
    const key = matchKey(caption)
    if (!key) continue
    if (/让利|关注相册|陆续出货/.test(caption) && !/款号/.test(caption)) continue
    const list = groups.get(key) ?? []
    list.push(item)
    groups.set(key, list)
  }
  return [...groups.entries()]
}

function toReady(key: string, posts: WegoItem[]): Ready | null {
  const captions = posts.map(captionOf).sort((a, b) => b.length - a.length)
  const caption = captions[0] ?? ''
  const urls = posts.flatMap(urlsOf)
  const media = partitionMedia(urls)
  if (!media.images.length && !media.video) return null
  const prices = posts.map((post) => priceCny(post, captionOf(post))).filter((n): n is number => n != null && n > 0)
  const cny = prices.length ? Math.min(...prices) : 500
  const pictured = posts.find((post) => partitionMedia(urlsOf(post)).images.length > 0)
  const id = idOf(pictured ?? posts[0])
  return {
    slug: `lv-${key.toLowerCase().replace(/[^a-z0-9]+/g, '-')}-${(id || key).replace(/[^a-zA-Z0-9]+/g, '').slice(-10)}`.slice(0, 120),
    title: headline(caption),
    description: stripQuotedPrice(caption),
    details: detailsOf(caption),
    brand: 'Louis Vuitton',
    category: bagType(caption).category,
    images: media.images,
    video: media.video,
    price: premiumUsd(cny),
  }
}

function toCsv(rows: Ready[]) {
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
    const images = [...row.images, ...(row.video ? [row.video] : [])]
    lines.push(
      [
        row.slug,
        csvCell(row.title),
        csvCell(row.description),
        csvCell(row.details),
        row.brand,
        row.category,
        'unisex',
        'active',
        row.price,
        '',
        'no',
        '',
        'OS',
        String(DEFAULT_STOCK),
        images.join('|'),
      ].join(','),
    )
  }
  return `${lines.join('\n')}\n`
}

function expired(payload: unknown) {
  const row = asRecord(payload)
  if (!row) return false
  const msg = String(row.errmsg ?? '')
  return row.errcode === 9 || row.errcode === '9' || msg.includes('登录')
}

function listUrl(timestamp: string) {
  const q = new URLSearchParams({
    albumId: SHOP,
    searchValue: '',
    searchImg: '',
    startDate: '',
    endDate: '',
    requestDataType: '',
    isFilter: 'true',
    tagList: '[]',
    timestamp,
  })
  return `${HOST}/album/personal/all?${q}`
}

async function fetchAll(cookie: string) {
  const all: WegoItem[] = []
  let timestamp = ''
  for (let page = 1; page <= 5000; page++) {
    const res = await fetch(listUrl(timestamp), {
      headers: { accept: 'application/json', cookie, referer: `${HOST}/`, 'user-agent': UA },
    })
    if (!res.ok) throw new Error(`相册 HTTP ${res.status}`)
    const payload = (await res.json()) as WegoItem
    if (expired(payload)) throw new Error('EXPIRED')
    const result = asRecord(payload.result)
    const items = (Array.isArray(result?.items) ? result.items : []).map(asRecord).filter((row): row is WegoItem => !!row)
    all.push(...items)
    const paging = asRecord(result?.pagination) ?? {}
    const next = String(paging.pageTimestamp ?? '')
    console.log(`  第 ${page} 页 ${items.length} 条，累计 ${all.length}`)
    if (!items.length || paging.isLoadMore !== true || !next || next === timestamp) break
    timestamp = next
    await sleep(350)
  }
  return all
}

async function attachImages(rows: Ready[]) {
  let added = 0
  let failed = 0
  let cursor = 0
  async function one() {
    while (cursor < rows.length) {
      const row = rows[cursor++]
      const code = row.title.match(/\b(M\d{4,}|N\d{4,})\b/)?.[0]
      const product = code
        ? await db.product.findFirst({
            where: { title: { contains: code } },
            select: { id: true, _count: { select: { images: true } } },
          })
        : await db.product.findUnique({
            where: { slug: row.slug },
            select: { id: true, _count: { select: { images: true } } },
          })
      if (!product) {
        failed++
        continue
      }
      if (product._count.images) continue
      let position = 0
      for (const url of row.images.filter((item) => !isVideoUrl(item)).slice(0, MAX_IMPORT_IMAGES)) {
        const fetched = await fetchRemoteImage(url)
        if (!fetched.ok) {
          failed++
          continue
        }
        const processed = await processImage(fetched.buffer, { dir: 'uploads', crop: 'full', withOg: position === 0 })
        await db.productImage.create({
          data: { productId: product.id, ...processed, alt: row.title, position },
        })
        position++
        added++
      }
      if (cursor % 20 === 0) console.log(`  配图 ${cursor} / ${rows.length}，已写入 ${added}`)
    }
  }
  await Promise.all(Array.from({ length: 3 }, () => one()))
  console.log(`配图完成：${added} 张，失败 ${failed}`)
}

function selfCheck() {
  if (premiumUsd(500) !== '230.00') throw new Error(`定价公式不对：500 → ${premiumUsd(500)}`)
  if (stripQuotedPrice('💰420, hello') !== 'hello') throw new Error('报价剥离坏了')
  if (stripQuotedPrice('Large size 💰600✈️x') !== 'Large size ✈️x') throw new Error('文中报价剥离坏了')
}

async function main() {
  selfCheck()
  const fromRaw = process.argv.includes('--from-raw')
  const imagesOnly = process.argv.includes('--images-only')
  await mkdir(OUT, { recursive: true })

  let raw: WegoItem[]
  if (fromRaw) {
    raw = JSON.parse(await readFile(RAW, 'utf8')) as WegoItem[]
    console.log(`用已有 raw.json，${raw.length} 条`)
  } else {
    const cookie = (await readFile(COOKIE_FILE, 'utf8')).trim()
    console.log(`拉相册 ${SHOP}`)
    raw = await fetchAll(cookie)
    await writeFile(RAW, JSON.stringify(raw, null, 2))
  }

  const groups = mergePosts(raw)
  const rows = groups.map(([key, posts]) => toReady(key, posts)).filter((row): row is Ready => !!row)
  console.log(`帖子 ${raw.length} → 商品 ${rows.length}（合并了 ${raw.length - rows.length} 条）`)
  console.log('样例', rows.slice(0, 3).map((row) => `${row.title} $${row.price} video=${row.video ? 'yes' : 'no'} imgs=${row.images.length}`))

  if (!imagesOnly) {
    const cache = new Map<string, string>()
    let done = 0
    for (const row of rows) {
      if (/[\u4e00-\u9fff]/.test(row.description)) {
        const translated = await translate(row.description, cache)
        if (translated.length > 20) row.description = stripQuotedPrice(translated).slice(0, 4000)
      }
      done++
      if (done % 30 === 0) console.log(`  翻译 ${done} / ${rows.length}`)
      await sleep(40)
    }
  }

  if (!imagesOnly) {
    await writeFile(path.join(OUT, 'products.csv'), `\uFEFF${toCsv(rows)}`, 'utf8')

    let created = 0
    let updated = 0
    for (let start = 0; start < rows.length; start += 400) {
      const plan = await buildPlan(toCsv(rows.slice(start, start + 400)))
      console.log(`计划 ${plan.rows.length} 行，问题 ${plan.issues.length}`)
      for (const issue of plan.issues.slice(0, 8)) console.log(`  第 ${issue.line} 行 ${issue.message}`)
      const result = await applyPlan(plan)
      created += result.created
      updated += result.updated
    }
    console.log(`写入 新建 ${created}，更新 ${updated}`)
    dropImageIndex()
  }

  console.log('配图…')
  await attachImages(rows)
  await db.$disconnect()
}

if (premiumUsd(500) !== '230.00') throw new Error(`定价公式不对：${premiumUsd(500)}`)
await main()
