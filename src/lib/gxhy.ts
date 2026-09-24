import { createDecipheriv } from 'node:crypto'
import { isVideoUrl } from './media'
import { MAX_IMPORT_IMAGES } from './product-import'
import { MIN_PRICE_CENTS } from './totals'
import { DEFAULT_STOCK } from './variants'

/**
 * 共享货源（gxhy1688）详情。页面是 Vue 壳，真数据在
 * GET /personProduct/productPrivateDetailsV2.action?pid=<code>，
 * 响应是他们前端写死的 AES-128-ECB（密钥就在公开 JS 里）。
 */

const HOST = 'https://gxhy1688.com'
const AES_KEY = Buffer.from('wxtdefgabcdawn12', 'utf8')
const DEFAULT_USD = '189.00'
const CNY_PER_USD = 7

const BRANDS: { re: RegExp; name: string; slug: string }[] = [
  { re: /louis\s*vuitton|\blv\b|路易威登/i, name: 'Louis Vuitton', slug: 'louis-vuitton' },
  { re: /chanel|chane[l1]|香奈儿/i, name: 'Chanel', slug: 'chanel' },
  { re: /dior|d1or|迪奥/i, name: 'Dior', slug: 'dior' },
  { re: /\bysl\b|saint\s*laurent|圣罗兰/i, name: 'YSL', slug: 'ysl' },
  { re: /gucci|古驰/i, name: 'Gucci', slug: 'gucci' },
  { re: /balenciaga|巴黎世家/i, name: 'Balenciaga', slug: 'balenciaga' },
  { re: /miu\s*miu|缪缪/i, name: 'Miu Miu', slug: 'miu-miu' },
  { re: /herm[eè]s|爱马仕/i, name: 'Hermes', slug: 'hermes' },
  { re: /goyard|戈雅/i, name: 'Goyard', slug: 'goyard' },
  { re: /bottega|葆蝶家|\bbv\b/i, name: 'Bottega Veneta', slug: 'bottega-veneta' },
]

const TYPES: { re: RegExp; en: string; category: 'totes' | 'crossbody' | 'backpacks' }[] = [
  { re: /双肩|backpack|背包/i, en: 'Backpack', category: 'backpacks' },
  {
    re: /斜挎|腋下|腰包|胸包|相机包|口盖|小金珠|金珠|链条包|crossbody|pochette|woc|hobo|messenger/i,
    en: 'Crossbody',
    category: 'crossbody',
  },
  { re: /托特|tote|neverfull|onthego|keepall/i, en: 'Tote', category: 'totes' },
  { re: /手袋|手提包|手包|clutch|kelly|birkin|speedy|alma|capucines|boy|flap|2\.55|cf包/i, en: 'Handbag', category: 'totes' },
]

export type SourceRef = { code: string; marketCode: string }

export type SourceListing = {
  code: string
  title: string
  description: string
  details: string
  brand: string
  category: 'totes' | 'crossbody' | 'backpacks'
  price: string
  sourcePrice: number | null
  images: string[]
  caption: string
}

export function parseSourceUrl(raw: string): SourceRef | { error: string } {
  const text = raw.trim()
  if (!text) return { error: '把货源链接贴进来' }
  if (/^\d{6,20}$/.test(text)) return { code: text, marketCode: '' }

  let url: URL
  try {
    url = new URL(text)
  } catch {
    return { error: '这不是一条合法链接' }
  }

  if (!/^https?:$/.test(url.protocol)) return { error: '只接受 http / https 链接' }

  const fromHash = url.hash.includes('?') ? new URLSearchParams(url.hash.slice(url.hash.indexOf('?') + 1)) : null
  const code = url.searchParams.get('code') || url.searchParams.get('pid') || fromHash?.get('code') || fromHash?.get('pid')
  if (!code || !/^\d{6,20}$/.test(code)) return { error: '链接里没有商品编号（code）' }

  return { code, marketCode: url.searchParams.get('marketCode') || fromHash?.get('marketCode') || '' }
}

function decryptBody(raw: string): unknown {
  const text = raw.trim()
  if (text.startsWith('{') || text.startsWith('[')) return JSON.parse(text)

  const decipher = createDecipheriv('aes-128-ecb', AES_KEY, null)
  const json = Buffer.concat([decipher.update(Buffer.from(text, 'base64')), decipher.final()]).toString('utf8')
  return JSON.parse(json)
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : null
}

function picturesOf(product: Record<string, unknown>): string[] {
  const pics = asRecord(product.pics)
  const list = Array.isArray(pics?.picList) ? pics.picList : []
  const urls: string[] = []
  let video: string | null = null
  for (const entry of list) {
    const url = typeof entry === 'string' ? entry : String(asRecord(entry)?.url ?? '')
    if (!/^https?:\/\//i.test(url)) continue
    const https = url.replace(/^http:\/\//i, 'https://')
    if (isVideoUrl(https)) {
      video ??= https
      continue
    }
    urls.push(https)
  }
  const images = [...new Set(urls)].slice(0, MAX_IMPORT_IMAGES)
  return video ? [...images, video] : images
}

export function brandOf(caption: string) {
  return BRANDS.find((brand) => brand.re.test(caption)) ?? { name: 'House', slug: 'house' }
}

export function bagCategory(caption: string): SourceListing['category'] {
  for (const type of TYPES) if (type.re.test(caption)) return type.category
  return 'totes'
}

function bagType(caption: string) {
  for (const type of TYPES) if (type.re.test(caption)) return type.en
  return 'Bag'
}

function tidy(raw: string) {
  return raw
    .replace(/顶级货_?/g, ' ')
    .replace(/\bp\d{2,5}\b/gi, ' ')
    .replace(/高端定制[品]?/g, ' ')
    .replace(/Chane1/gi, 'Chanel')
    .replace(/D1or/gi, 'Dior')
    .replace(/[【】\[\]！!～~·]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

function titleCase(raw: string) {
  return raw
    .split(' ')
    .map((word, index) => {
      if (!word) return word
      if (/^[A-Z0-9]{2,}$/.test(word)) return word
      if (index > 0 && /^(in|and|or|the|a|of|with|x)$/i.test(word)) return word.toLowerCase()
      return word[0].toUpperCase() + word.slice(1)
    })
    .join(' ')
}

function modelCode(caption: string) {
  return caption.match(/\bAS\d{3,}\b/i)?.[0]?.toUpperCase() ?? caption.match(/\b[A-Z]{2}\d{3,}\b/)?.[0] ?? ''
}

function listingTitle(caption: string, brand: string) {
  return titleCase([brand, bagType(caption), modelCode(caption)].filter(Boolean).join(' ')).slice(0, 200)
}

function detailsOf(caption: string) {
  const size = caption.match(/(?:size|尺寸)[:：]?\s*([0-9]+(?:\s*[xX×]\s*[0-9]+){1,2}\s*(?:厘米|cm)?)/i)
  const bits = [size ? size[1].replace(/厘米/g, 'cm').replace(/\s*[xX]\s*/g, ' × ') : '']
  if (/牛皮|小牛皮/.test(caption)) bits.push('Calfskin')
  if (/羊皮/.test(caption)) bits.push('Lambskin')
  if (/可调节/.test(caption)) bits.push('Adjustable strap')
  return bits.filter(Boolean).join('|')
}

function priceUsd(cny: number | null) {
  if (cny === null || !Number.isFinite(cny) || cny <= 0) return DEFAULT_USD
  const usd = Math.max(MIN_PRICE_CENTS / 100, Math.round((cny / CNY_PER_USD) * 100) / 100)
  return usd.toFixed(2)
}

async function translate(raw: string) {
  if (!/[\u4e00-\u9fff]/.test(raw)) return raw
  const url =
    'https://translate.googleapis.com/translate_a/single?client=gtx&sl=zh-CN&tl=en&dt=t&q=' +
    encodeURIComponent(raw.slice(0, 1800))
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(8_000) })
    if (!res.ok) return raw
    const data = (await res.json()) as [string][][]
    return tidy(data[0].map((part) => part[0]).join(''))
  } catch {
    return raw
  }
}

export function composeListing(product: Record<string, unknown>, translatedDescription?: string): SourceListing {
  const code = String(product.code ?? product.picturePath ?? '')
  const caption = [String(product.title ?? ''), String(product.description ?? '')].filter(Boolean).join('\n')
  const brand = brandOf(caption)
  const type = bagType(caption)
  const title = listingTitle(caption, brand.name)
  const description = (
    translatedDescription ||
    `${title} from ${brand.name}. A ${type.toLowerCase()} with a clean everyday profile.`
  ).slice(0, 4000)

  const rawPrice = Number(product.price)
  return {
    code,
    title,
    description,
    details: detailsOf(caption),
    brand: brand.name,
    category: bagCategory(caption),
    price: priceUsd(Number.isFinite(rawPrice) ? rawPrice : null),
    sourcePrice: Number.isFinite(rawPrice) ? rawPrice : null,
    images: picturesOf(product),
    caption,
  }
}

export async function fetchGxhyProduct(ref: SourceRef): Promise<SourceListing | { error: string }> {
  const query = new URLSearchParams({ pid: ref.code })
  if (ref.marketCode) query.set('marketCode', ref.marketCode)

  let res: Response
  try {
    res = await fetch(`${HOST}/personProduct/productPrivateDetailsV2.action?${query}`, {
      headers: {
        accept: '*/*',
        referer: `${HOST}/detailIndex?code=${ref.code}`,
        'user-agent': 'Mozilla/5.0',
      },
      signal: AbortSignal.timeout(15_000),
    })
  } catch (error) {
    return { error: `货源站连不上：${(error as Error).message}` }
  }
  if (!res.ok) return { error: `货源站返回 HTTP ${res.status}` }

  let payload: unknown
  try {
    payload = decryptBody(await res.text())
  } catch {
    return { error: '货源数据解不开，链接可能失效了' }
  }

  const root = asRecord(payload)
  const data = asRecord(root?.data)
  const product = asRecord(data?.product)
  if (!product) return { error: root && root.success === false ? String(root.msg || '货源站没找到这件商品') : '货源站没返回商品' }

  const draft = composeListing(product)
  if (!draft.images.length) return { error: '这件商品没有图片，没法上架' }
  if (!draft.code) return { error: '货源站没给商品编号' }

  const description = await translate(tidy(String(product.description ?? '')))
  return composeListing(product, description)
}

export function listingCsv(listing: SourceListing): string {
  const header = 'slug,title,description,details,brand,category,gender,status,price,compare_at,featured,colors,sizes,stock,images'
  const slug = `gxhy-${listing.code}`
  const cells = [
    slug,
    listing.title,
    listing.description,
    listing.details,
    listing.brand,
    listing.category,
    'unisex',
    'active',
    listing.price,
    '',
    'no',
    '',
    'OS',
    String(DEFAULT_STOCK),
    listing.images.join('|'),
  ].map((cell) => (/[",\n\r]/.test(cell) ? `"${cell.replace(/"/g, '""')}"` : cell))
  return `${header}\n${cells.join(',')}\n`
}
