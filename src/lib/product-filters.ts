import type { Prisma } from '@/generated/prisma/client'
import { db } from './db'

export const PAGE_SIZE = 24

export const SORTS = {
  featured: 'Featured',
  new: 'Newest',
  'price-asc': 'Price: low to high',
  'price-desc': 'Price: high to low',
} as const

export type SortKey = keyof typeof SORTS

const ORDER_BY: Record<SortKey, Prisma.ProductOrderByWithRelationInput[]> = {
  featured: [{ featured: 'desc' }, { createdAt: 'asc' }],
  new: [{ createdAt: 'desc' }],
  'price-asc': [{ priceCents: 'asc' }],
  'price-desc': [{ priceCents: 'desc' }],
}

export const PRICE_RANGES = {
  'under-100': { label: 'Under $100', min: 0, max: 9999 },
  '100-250': { label: '$100 – $250', min: 10000, max: 25000 },
  '250-500': { label: '$250 – $500', min: 25000, max: 50000 },
  '500-plus': { label: '$500+', min: 50000, max: Number.MAX_SAFE_INTEGER },
} as const

export type PriceKey = keyof typeof PRICE_RANGES

export type SearchParams = Record<string, string | string[] | undefined>

export type Filters = {
  brands: string[]
  sizes: string[]
  colors: string[]
  price: PriceKey | null
  sort: SortKey
  page: number
  q: string
}

function list(value: string | string[] | undefined): string[] {
  if (!value) return []
  const raw = Array.isArray(value) ? value.join(',') : value
  return raw.split(',').map((item) => item.trim()).filter(Boolean)
}

function one(value: string | string[] | undefined): string {
  return (Array.isArray(value) ? value[0] : value)?.trim() ?? ''
}

export function parseFilters(searchParams: SearchParams): Filters {
  const sort = one(searchParams.sort)
  const price = one(searchParams.price)
  const page = Number.parseInt(one(searchParams.page), 10)

  return {
    brands: list(searchParams.brand),
    sizes: list(searchParams.size),
    colors: list(searchParams.color),
    price: price in PRICE_RANGES ? (price as PriceKey) : null,
    sort: sort in SORTS ? (sort as SortKey) : 'featured',
    page: Number.isFinite(page) && page > 1 ? page : 1,
    q: one(searchParams.q),
  }
}

export function buildWhere(
  base: Prisma.ProductWhereInput,
  filters: Filters,
): Prisma.ProductWhereInput {
  const where: Prisma.ProductWhereInput = { ...base, status: 'ACTIVE' }

  if (filters.brands.length) where.brand = { slug: { in: filters.brands } }

  // size 和 color 放进同一个 some，语义是「存在一个同时满足两者的 SKU」，
  // 而不是「有黑色的款，也有 M 码的款」——后者会把只有黑色 XL 的商品也算进来
  if (filters.sizes.length || filters.colors.length) {
    where.variants = {
      some: {
        ...(filters.sizes.length ? { size: { in: filters.sizes } } : {}),
        ...(filters.colors.length ? { color: { in: filters.colors } } : {}),
      },
    }
  }

  if (filters.price) {
    const range = PRICE_RANGES[filters.price]
    where.priceCents = { gte: range.min, lte: range.max }
  }

  if (filters.q) {
    where.OR = [
      { title: { contains: filters.q } },
      { description: { contains: filters.q } },
      { brand: { name: { contains: filters.q } } },
      { category: { name: { contains: filters.q } } },
    ]
  }

  return where
}

export function orderByFor(sort: SortKey) {
  return ORDER_BY[sort]
}

/**
 * 侧边栏可选项。刻意只按 base 范围算（忽略当前已勾选的条件），
 * 否则勾了「黑色」之后其他颜色会从列表里消失，就没法多选了。
 */
export async function getFacets(base: Prisma.ProductWhereInput) {
  const scope: Prisma.ProductWhereInput = { ...base, status: 'ACTIVE' }

  const [brands, variants] = await Promise.all([
    db.brand.findMany({
      where: { products: { some: scope } },
      orderBy: { name: 'asc' },
      select: { slug: true, name: true },
    }),
    db.productVariant.findMany({
      where: { product: scope },
      select: { size: true, color: true, colorHex: true },
    }),
  ])

  const sizes = [...new Set(variants.map((v) => v.size).filter((s): s is string => !!s))].sort(
    sizeOrder,
  )

  const colorMap = new Map<string, string>()
  for (const variant of variants) {
    if (variant.color && !colorMap.has(variant.color)) {
      colorMap.set(variant.color, variant.colorHex ?? '#ccc')
    }
  }
  const colors = [...colorMap].map(([name, hex]) => ({ name, hex })).sort((a, b) => a.name.localeCompare(b.name))

  return { brands, sizes, colors }
}

/** XS/S/M/L/XL 按人穿的顺序排，纯数字尺码按数值排，别让 10 排在 7 前面 */
const APPAREL_ORDER = ['XS', 'S', 'M', 'L', 'XL', 'XXL']
function sizeOrder(a: string, b: string) {
  const ai = APPAREL_ORDER.indexOf(a)
  const bi = APPAREL_ORDER.indexOf(b)
  if (ai !== -1 || bi !== -1) return (ai === -1 ? 99 : ai) - (bi === -1 ? 99 : bi)
  const an = Number.parseFloat(a)
  const bn = Number.parseFloat(b)
  if (Number.isFinite(an) && Number.isFinite(bn)) return an - bn
  return a.localeCompare(b)
}

/** 生成「在当前筛选基础上改动某一项」的链接。翻页参数一律重置，否则会跳到不存在的页 */
export function hrefWith(
  basePath: string,
  searchParams: SearchParams,
  changes: Record<string, string | null>,
): string {
  const params = new URLSearchParams()

  for (const [key, value] of Object.entries(searchParams)) {
    if (key === 'page' || value == null) continue
    params.set(key, Array.isArray(value) ? value.join(',') : value)
  }

  for (const [key, value] of Object.entries(changes)) {
    if (value === null) params.delete(key)
    else params.set(key, value)
  }

  const query = params.toString()
  return query ? `${basePath}?${query}` : basePath
}

/** 多选项的勾选/取消 */
export function hrefToggle(
  basePath: string,
  searchParams: SearchParams,
  key: string,
  value: string,
): string {
  const current = list(searchParams[key])
  const next = current.includes(value)
    ? current.filter((item) => item !== value)
    : [...current, value]

  return hrefWith(basePath, searchParams, { [key]: next.length ? next.join(',') : null })
}
