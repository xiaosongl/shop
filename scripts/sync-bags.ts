/**
 * 把微购相册里「品牌_包包」分类的货，整理成英文后换上本店。
 *
 * 会清空站内现有商品（订单保留），再按微购的品牌标签建品牌、
 * 按袋型归到 totes / crossbody / backpacks。
 *
 *   npx tsx scripts/sync-bags.ts
 *   npx tsx scripts/sync-bags.ts --check
 */
import { mkdir, readFile, unlink, writeFile } from 'node:fs/promises'
import path from 'node:path'

import { db } from '../src/lib/db'
import { dropImageIndex } from '../src/lib/image-search'
import { IMAGE_WIDTHS, processImage } from '../src/lib/images'
import { isVideoUrl } from '../src/lib/media'
import { applyPlan, buildPlan, fetchRemoteImage, MAX_IMPORT_IMAGES } from '../src/lib/product-import'
import { MIN_PRICE_CENTS } from '../src/lib/totals'

const SHOP = '_deEi3qrohl0aNYdMSg6qcW_NOOHxT7WOf1o5Grw'
const HOST = 'https://www.szwego.com'
const COOKIE_FILE = 'data/wego-export/cookies.txt'
const OUT = 'data/wego-bags'
const RAW = path.join(OUT, 'raw.json')
const I18N = path.join(OUT, 'i18n.json')
const CHUNK = 400
const DEFAULT_USD = '189.00'
const DEFAULT_STOCK = '1000'
const PAGE_GAP_MS = 350
const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0.0.0 Safari/537.36'

const BRANDS: { tag: string; name: string; slug: string }[] = [
  { tag: 'lv_包包', name: 'Louis Vuitton', slug: 'louis-vuitton' },
  { tag: '香奈儿_包包', name: 'Chanel', slug: 'chanel' },
  { tag: '迪奥_包包', name: 'Dior', slug: 'dior' },
  { tag: 'ysl_包包', name: 'YSL', slug: 'ysl' },
  { tag: '古驰_包包', name: 'Gucci', slug: 'gucci' },
  { tag: '巴黎世家_包包', name: 'Balenciaga', slug: 'balenciaga' },
  { tag: 'miumiu_包包', name: 'Miu Miu', slug: 'miu-miu' },
  { tag: '爱马仕_包包', name: 'Hermes', slug: 'hermes' },
  { tag: '戈雅_包包', name: 'Goyard', slug: 'goyard' },
  { tag: 'bv_包包', name: 'Bottega Veneta', slug: 'bottega-veneta' },
]

const TYPES: { re: RegExp; en: string; category: 'totes' | 'crossbody' | 'backpacks' }[] = [
  { re: /双肩|backpack|背包/i, en: 'Backpack', category: 'backpacks' },
  { re: /斜挎|腋下|腰包|胸包|相机包|crossbody|pochette|woc|hobo|messenger/i, en: 'Crossbody', category: 'crossbody' },
  { re: /托特|tote|neverfull|onthego|keepall/i, en: 'Tote', category: 'totes' },
  { re: /手袋|手提包|手包|clutch|kelly|birkin|speedy|alma|capucines|boy|flap|2\.55|cf包/i, en: 'Handbag', category: 'totes' },
]

const WORDS: [RegExp, string][] = [
  [/杏棕色/g, 'apricot brown'],
  [/沙丘色/g, 'dune'],
  [/柠檬[黄色]*/g, 'lemon yellow'],
  [/薄荷绿|浅绿/g, 'mint green'],
  [/老花/g, 'Monogram'],
  [/牛皮/g, 'calfskin'],
  [/帆布/g, 'canvas'],
  [/尼龙/g, 'nylon'],
  [/羊皮/g, 'lambskin'],
  [/荔枝纹/g, 'caviar leather'],
  [/菱格/g, 'quilted'],
  [/可拆卸/g, 'detachable'],
  [/可调节/g, 'adjustable'],
  [/肩带/g, 'strap'],
  [/手柄/g, 'handle'],
  [/尺寸/g, 'size'],
  [/厘米|cm/gi, 'cm'],
  [/手袋/g, 'handbag'],
  [/腋下包/g, 'shoulder bag'],
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
  featured: boolean
  price: string
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function slugify(raw: string) {
  return raw
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 120)
}

function text(item: WegoItem, keys: string[]) {
  for (const key of keys) {
    const value = item[key]
    if (typeof value === 'string' && value.trim()) return value.trim()
  }
  return ''
}

function asRecord(value: unknown) {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as WegoItem) : null
}

function csvCell(value: string) {
  return /[",\n\r]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value
}

function cookieHeaders(cookie: string) {
  return { accept: 'application/json', cookie, referer: `${HOST}/`, 'user-agent': UA }
}

export function isJunk(caption: string) {
  const first = caption.split(/\r?\n/).map((line) => line.trim()).find(Boolean) ?? ''
  const tight = first.replace(/[^\p{Script=Han}a-zA-Z0-9]/gu, '')
  if (!tight) return true
  if (/尺码|尺寸|上身|模特图|效果图|实拍|细节图|详情图/.test(tight) && tight.length < 18) return true
  return false
}

export function bagCategory(caption: string): 'totes' | 'crossbody' | 'backpacks' {
  for (const type of TYPES) if (type.re.test(caption)) return type.category
  return 'totes'
}

function bagType(caption: string) {
  for (const type of TYPES) if (type.re.test(caption)) return type.en
  return 'Bag'
}

function applyGlossary(raw: string) {
  let out = raw
  for (const [re, en] of WORDS) out = out.replace(re, en)
  return out
}

function tidyEnglish(raw: string) {
  return raw
    .replace(/[【】\[\]！!～~]+/g, ' ')
    .replace(/[➕]+/g, ' ')
    .replace(/\s+/g, ' ')
    .replace(/\s+([,./])/g, '$1')
    .trim()
}

function titleCase(raw: string) {
  return raw
    .split(' ')
    .map((word, index) => {
      if (!word) return word
      if (/^[A-Z0-9]{2,}$/.test(word)) return word
      if (/[éèàùâêôç]/.test(word) && /[A-Z]/.test(word)) return word
      if (index > 0 && /^(in|and|or|the|a|of|with|x)$/i.test(word)) return word.toLowerCase()
      return word[0].toUpperCase() + word.slice(1)
    })
    .join(' ')
}

export function headline(caption: string, brand: string) {
  const lines = caption.split(/\r?\n/).map((line) => line.trim()).filter(Boolean)
  const first = lines[0] ?? ''
  const boxed = first.match(/【\s*([^】]+?)\s*】\s*(.*)/)
  const raw = boxed ? `${boxed[1]} ${boxed[2]}` : first
  const glossed = tidyEnglish(applyGlossary(raw))
  const type = bagType(caption)
  const hasLatin = /[A-Za-z]{3,}/.test(glossed)
  const base = hasLatin ? glossed : tidyEnglish(`${brand} ${glossed} ${type}`)
  return titleCase(base).slice(0, 200)
}

export function detailsOf(caption: string) {
  const size = caption.match(/尺寸[:：]?\s*([0-9]+(?:\s*[xX×]\s*[0-9]+){1,2}\s*(?:厘米|cm)?)/i)
  const bits = [size ? size[1].replace(/厘米/g, 'cm').replace(/\s*[xX]\s*/g, ' × ') : '']
  if (/牛皮/.test(caption)) bits.push('Calfskin')
  if (/帆布|canvas/i.test(caption)) bits.push('Canvas')
  if (/尼龙|nylon/i.test(caption)) bits.push('Nylon')
  if (/可拆卸/.test(caption)) bits.push('Detachable strap')
  if (/可调节/.test(caption)) bits.push('Adjustable strap')
  return bits.filter(Boolean).join('|')
}

function describe(caption: string, brand: string, title: string) {
  const body = caption
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line && line !== caption.split(/\r?\n/)[0])
    .filter((line) => !/发货|包装|现货太少|芯片|跳码|原厂|强烈推荐|必入/.test(line))
    .join(' ')
  const glossed = tidyEnglish(applyGlossary(body))
  if (glossed.length > 40 && /[A-Za-z]/.test(glossed)) return glossed.slice(0, 4000)
  const type = bagType(caption).toLowerCase()
  return `${title} from ${brand}. A ${type} with a clean everyday profile.`.slice(0, 4000)
}

function imagesOf(item: WegoItem) {
  const urls: string[] = []
  let video: string | null = null
  for (const key of ['imgsSrc', 'imgs']) {
    const value = item[key]
    for (const entry of Array.isArray(value) ? value : []) {
      const raw = typeof entry === 'string' ? entry : String(asRecord(entry)?.url ?? '')
      if (!/^https?:\/\//i.test(raw)) continue
      const url = raw.replace(/\?imageMogr2.*$/, '').replace(/^http:\/\//i, 'https://')
      if (/\.(mp4|webm|mov|m4v|m3u8)$/i.test(url.split(/[?#]/)[0] ?? '')) {
        video ??= url
        continue
      }
      urls.push(url)
    }
  }
  const images = [...new Set(urls)].slice(0, MAX_IMPORT_IMAGES)
  return video ? [...images, video] : images
}

function brandOf(item: WegoItem) {
  const tags = Array.isArray(item.tags) ? item.tags : []
  for (const tag of tags) {
    const name = String(asRecord(tag)?.tagName ?? '').toLowerCase()
    const hit = BRANDS.find((brand) => brand.tag === name)
    if (hit) return hit
  }
  return null
}

function priceUsd(caption: string) {
  const match = caption.match(/(?:¥|￥|价格[:：]\s*)(\d+(?:\.\d+)?)|(\d+(?:\.\d+)?)\s*元/)
  if (!match) return DEFAULT_USD
  const cny = Number(match[1] || match[2])
  const usd = Math.max(MIN_PRICE_CENTS / 100, Math.round((cny / 7) * 100) / 100)
  return usd.toFixed(2)
}

async function translateLeftovers(raw: string, cache: Map<string, string>) {
  if (!/[\u4e00-\u9fff]/.test(raw)) return raw
  const hit = cache.get(raw)
  if (hit) return hit
  const url =
    'https://translate.googleapis.com/translate_a/single?client=gtx&sl=zh-CN&tl=en&dt=t&q=' +
    encodeURIComponent(raw.slice(0, 1800))
  try {
    const res = await fetch(url)
    if (!res.ok) return raw
    const data = (await res.json()) as [string][][]
    const text = data[0].map((part) => part[0]).join('')
    const out = tidyEnglish(text)
    cache.set(raw, out)
    return out
  } catch {
    return raw
  }
}

async function loadCookie() {
  return (await readFile(COOKIE_FILE, 'utf8')).trim()
}

async function fetchTags(cookie: string) {
  const res = await fetch(`${HOST}/commodity/tags?hasVideo=0&hideUnCategorized=true&albumId=${SHOP}`, {
    headers: cookieHeaders(cookie),
  })
  if (!res.ok) throw new Error(`标签接口 HTTP ${res.status}`)
  const data = (await res.json()) as {
    errcode?: number
    errmsg?: string
    result?: { allTags?: { tagId: number; tagName?: string; itemCount?: number }[] }
  }
  if (data.errcode === 9) throw new Error('登录已过期，删掉 cookies.txt 再扫一次')
  return (data.result?.allTags ?? []).filter((tag) => /包包/.test(tag.tagName ?? ''))
}

async function fetchTag(cookie: string, tagId: number, name: string) {
  const all: WegoItem[] = []
  let timestamp = ''
  for (let page = 1; page <= 5000; page++) {
    const q = new URLSearchParams({
      albumId: SHOP,
      isFilter: 'true',
      tagList: `[${tagId}]`,
      timestamp,
    })
    const res = await fetch(`${HOST}/album/personal/all?${q}`, { headers: cookieHeaders(cookie) })
    if (!res.ok) throw new Error(`${name} HTTP ${res.status}`)
    const payload = (await res.json()) as WegoItem
    if (payload.errcode === 9) throw new Error('登录已过期')
    const result = asRecord(payload.result)
    const items = (Array.isArray(result?.items) ? result.items : [])
      .map(asRecord)
      .filter((row): row is WegoItem => !!row)
    all.push(...items)
    const paging = asRecord(result?.pagination) ?? {}
    const next = String(paging.pageTimestamp ?? '')
    process.stdout.write(`  ${name} 第 ${page} 页，累计 ${all.length}\r`)
    if (!items.length || paging.isLoadMore !== true || !next || next === timestamp) break
    timestamp = next
    await sleep(PAGE_GAP_MS)
  }
  console.log(`  ${name} ${all.length} 条`.padEnd(40))
  return all
}

function toReady(item: WegoItem, featured: boolean): Ready | null {
  const brand = brandOf(item)
  if (!brand) return null
  const caption = text(item, ['title', 'subTitle', 'itemName'])
  if (isJunk(caption)) return null
  const id = text(item, ['goods_id', 'goodsId', 'itemId'])
  if (!id) return null
  const title = headline(caption, brand.name)
  const description = describe(caption, brand.name, title)
  return {
    slug: `wego-${slugify(id) || id.replace(/[^a-zA-Z0-9]+/g, '').slice(0, 40)}`,
    title,
    description,
    details: detailsOf(caption),
    brand: brand.name,
    category: bagCategory(caption),
    images: imagesOf(item),
    featured,
    price: priceUsd(caption),
  }
}

async function polish(rows: Ready[], cache: Map<string, string>) {
  let done = 0
  for (const row of rows) {
    if (/[\u4e00-\u9fff]/.test(row.title)) row.title = titleCase(await translateLeftovers(row.title, cache)).slice(0, 200)
    if (/[\u4e00-\u9fff]/.test(row.description)) {
      row.description = (await translateLeftovers(row.description, cache)).slice(0, 4000)
    }
    done++
    if (done % 50 === 0) console.log(`  翻译 ${done} / ${rows.length}`)
    await sleep(40)
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
    lines.push(
      [
        row.slug,
        csvCell(row.title),
        csvCell(row.description),
        csvCell(row.details),
        csvCell(row.brand),
        row.category,
        'unisex',
        'active',
        row.price,
        '',
        row.featured ? 'yes' : 'no',
        '',
        'OS',
        DEFAULT_STOCK,
        row.images.join('|'),
      ].join(','),
    )
  }
  return `${lines.join('\n')}\n`
}

function forgetFile(url: string) {
  const match = url.match(/^\/(uploads|products)\/([a-f0-9]+)-(?:\d+|og)\.webp$/)
  if (!match) return
  const dir = match[1]
  const key = match[2]
  return Promise.all(
    [...IMAGE_WIDTHS, 'og'].map((width) => unlink(path.join('public', dir, `${key}-${width}.webp`)).catch(() => {})),
  )
}

async function wipe() {
  const count = await db.product.count()
  const images = await db.productImage.findMany({ select: { url: true, ogUrl: true } })
  console.log(`清空 ${count} 件商品、${images.length} 张图…`)
  await db.product.deleteMany()
  await db.brand.deleteMany()
  dropImageIndex()
  let gone = 0
  for (const image of images) {
    await forgetFile(image.url)
    if (image.ogUrl !== image.url) await forgetFile(image.ogUrl)
    gone++
    if (gone % 2000 === 0) console.log(`  已删文件 ${gone} / ${images.length}`)
  }
}

async function writeRows(rows: Ready[]) {
  let created = 0
  let updated = 0
  const issues: { line: number; message: string }[] = []
  for (let start = 0; start < rows.length; start += CHUNK) {
    const plan = await buildPlan(toCsv(rows.slice(start, start + CHUNK)))
    issues.push(...plan.issues)
    const result = await applyPlan(plan)
    created += result.created
    updated += result.updated
    issues.push(...result.issues)
    console.log(`  写入 ${Math.min(start + CHUNK, rows.length)} / ${rows.length}`)
  }
  return { created, updated, issues }
}

async function attachImages(rows: Ready[]) {
  let added = 0
  let failed = 0
  let cursor = 0
  async function one() {
    while (cursor < rows.length) {
      const row = rows[cursor++]
      const product = await db.product.findUnique({
        where: { slug: row.slug },
        select: { id: true, _count: { select: { images: true } } },
      })
      if (!product || product._count.images) continue
      let position = 0
      for (const url of row.images.filter((item) => !isVideoUrl(item)).slice(0, 6)) {
        const fetched = await fetchRemoteImage(url)
        if (!fetched.ok) {
          failed++
          continue
        }
        const processed = await processImage(fetched.buffer, {
          dir: 'uploads',
          crop: 'full',
          withOg: position === 0,
        })
        await db.productImage.create({
          data: { productId: product.id, ...processed, alt: row.title, position },
        })
        position++
        added++
      }
      if (cursor % 25 === 0) console.log(`  配图 ${cursor} / ${rows.length}，已写入 ${added}`)
    }
  }
  await Promise.all(Array.from({ length: 4 }, () => one()))
  console.log(`配图完成：${added} 张，失败 ${failed}`)
}

function selfCheck() {
  let failed = 0
  const ok = (name: string, pass: boolean) => {
    if (!pass) failed++
    console.log(`[${pass ? ' ok ' : 'FAIL'}] ${name}`)
  }
  ok('junk size chart', isJunk('尺码表💗'))
  ok('keep speedy', !isJunk('【SPEEDY BANDOULIÈRE 25 手袋】杏棕色'))
  ok('crossbody', bagCategory('LV 2026春夏新款Squire East West腋下包') === 'crossbody')
  ok('tote', bagCategory('【SPEEDY BANDOULIÈRE 25 手袋】杏棕色') === 'totes')
  const title = headline('【SPEEDY  BANDOULIÈRE 25 手袋】杏棕色', 'Louis Vuitton')
  ok('title english', /Speedy/i.test(title) && /Apricot/i.test(title) && !/[\u4e00-\u9fff]/.test(title))
  ok('details size', detailsOf('尺寸：25 x 15 x 15 厘米\n牛皮').includes('25 × 15 × 15'))
  if (failed) process.exit(1)
}

const argv = process.argv.slice(2)
if (argv.includes('--check')) {
  selfCheck()
} else {
  const cookie = await loadCookie()
  await mkdir(OUT, { recursive: true })

  let raw: WegoItem[] = []
  if (!argv.includes('--skip-fetch')) {
    const tags = await fetchTags(cookie)
    console.log(`包包标签 ${tags.length} 个`)
    const seen = new Set<string>()
    for (const tag of tags) {
      const items = await fetchTag(cookie, tag.tagId, tag.tagName ?? String(tag.tagId))
      for (const item of items) {
        const id = text(item, ['goods_id', 'goodsId'])
        if (!id || seen.has(id)) continue
        seen.add(id)
        raw.push(item)
      }
    }
    await writeFile(RAW, JSON.stringify(raw))
    console.log(`去重后 ${raw.length} 条`)
  } else {
    raw = JSON.parse(await readFile(RAW, 'utf8')) as WegoItem[]
    console.log(`用已有 raw.json，${raw.length} 条`)
  }

  const cache = new Map<string, string>()
  try {
    const saved = JSON.parse(await readFile(I18N, 'utf8')) as Record<string, string>
    for (const [key, value] of Object.entries(saved)) cache.set(key, value)
  } catch {
    /* 第一次没有缓存 */
  }

  const featuredOnce = new Set<string>()
  const rows: Ready[] = []
  let junk = 0
  for (const item of raw) {
    const brand = brandOf(item)
    const featured = !!brand && !featuredOnce.has(brand.slug)
    const row = toReady(item, featured)
    if (!row) {
      junk++
      continue
    }
    if (featured) featuredOnce.add(brand!.slug)
    rows.push(row)
  }
  console.log(`可用 ${rows.length}，跳过 ${junk}`)

  if (!argv.includes('--skip-translate')) {
    console.log('补译还没换成英文的标题和描述…')
    await polish(rows, cache)
    await writeFile(I18N, JSON.stringify(Object.fromEntries(cache), null, 2))
  }

  const byBrand = new Map<string, number>()
  const byCat = new Map<string, number>()
  for (const row of rows) {
    byBrand.set(row.brand, (byBrand.get(row.brand) ?? 0) + 1)
    byCat.set(row.category, (byCat.get(row.category) ?? 0) + 1)
  }
  console.log('--- 品牌 ---')
  for (const [name, count] of [...byBrand.entries()].sort((a, b) => b[1] - a[1])) {
    console.log(String(count).padStart(5), name)
  }
  console.log('--- 类目 ---')
  for (const [name, count] of [...byCat.entries()].sort((a, b) => b[1] - a[1])) {
    console.log(String(count).padStart(5), name)
  }

  await writeFile(path.join(OUT, 'products.csv'), `\uFEFF${toCsv(rows)}`, 'utf8')
  if (argv.includes('--dry')) {
    await db.$disconnect()
  } else {
    if (!argv.includes('--skip-wipe')) await wipe()
    console.log('写入商品…')
    const result = await writeRows(rows)
    console.log(`新建 ${result.created}，更新 ${result.updated}，问题 ${result.issues.length}`)
    for (const issue of result.issues.slice(0, 15)) console.log(`  第 ${issue.line} 行 ${issue.message}`)
    if (!argv.includes('--no-images')) {
      console.log('配图…')
      await attachImages(rows)
    }
    dropImageIndex()
    await db.$disconnect()
  }
}
