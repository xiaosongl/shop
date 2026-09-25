import type { Prisma } from '@/generated/prisma/client'
import { db } from './db'
import { readContacts, type ChatContacts } from './payments'
import {
  EMPTY_SHOWCASE,
  SHOWCASE_KEYS,
  showcaseText,
  type ShowcaseEntry,
  type ShowcaseKey,
} from './showcase'
import { GENDERS, GENDER_SLUGS, genderValues, isGenderSlug, type GenderSlug } from './taxonomy'

const showcaseSelect = {
  key: true,
  imageUrl: true,
  imageBlur: true,
  headline: true,
  subhead: true,
} as const

/**
 * 老站的客服号写在环境变量里。库里还没有 contact 这一行时抄一次进来，
 * 之后只认后台。行已经在（哪怕两个都空）就不再抄，不然清空保存会被环境变量填回来。
 */
async function importContactFromEnv(): Promise<ShowcaseEntry | null> {
  const headline = process.env.NEXT_PUBLIC_WHATSAPP_NUMBER?.trim() || null
  const subhead = process.env.NEXT_PUBLIC_MESSENGER?.trim() || null
  if (!headline && !subhead) return null

  try {
    return await db.showcase.create({
      data: { key: 'contact', headline, subhead },
      select: showcaseSelect,
    })
  } catch {
    return db.showcase.findUnique({ where: { key: 'contact' }, select: showcaseSelect })
  }
}

/** 一次取回全部展示位，缺的补空对象，调用方不用到处判 null */
export async function getShowcases(): Promise<Record<ShowcaseKey, ShowcaseEntry>> {
  const rows = await db.showcase.findMany({ select: showcaseSelect })
  const byKey = new Map<string, ShowcaseEntry>(rows.map((row) => [row.key, row]))
  if (!byKey.has('contact')) {
    const seeded = await importContactFromEnv()
    if (seeded) byKey.set('contact', seeded)
  }
  return Object.fromEntries(
    SHOWCASE_KEYS.map((key) => [key, byKey.get(key) ?? EMPTY_SHOWCASE]),
  ) as Record<ShowcaseKey, ShowcaseEntry>
}

/** WhatsApp / Messenger。结算、下单、商品询价各自只要这两个字符串 */
export async function getContacts(): Promise<ChatContacts> {
  const row = await db.showcase.findUnique({
    where: { key: 'contact' },
    select: { headline: true, subhead: true },
  })
  if (row) return readContacts(row)
  return readContacts(await importContactFromEnv())
}

/**
 * 站名和简介。页头、页脚、metadata 三处都要，单独开一条只取一行，
 * 别为了两个字符串把六个展示位全捞回来。
 *
 * 查不到就回退到缺省。这里必须吞异常：根布局的 generateMetadata 会调它，
 * 而 /_not-found 是构建期预渲染的——数据库还没迁移就构建的话（Docker、CI），
 * 整个构建会挂在一个只用来生成 <title> 的查询上，报错还完全指不到这里。
 */
export async function getSiteText() {
  const row = await db.showcase
    .findUnique({ where: { key: 'site' }, select: { headline: true, subhead: true } })
    .catch(() => null)

  const { headline, subhead } = showcaseText(row ?? undefined, 'site')
  return { name: headline, description: subhead }
}

/** 页脚列的政策链接，只出已发布的 */
export async function getPolicyLinks() {
  return db.policy.findMany({
    where: { published: true },
    orderBy: [{ position: 'asc' }, { title: 'asc' }],
    select: { slug: true, title: true },
  })
}

/** 下架的政策直接当不存在，前台会走 404 */
export async function getPolicy(slug: string) {
  return db.policy.findFirst({
    where: { slug, published: true },
    select: { slug: true, title: true, body: true, updatedAt: true },
  })
}

// 商品卡只需要这些字段。images 取前两张：第一张是主图，第二张是特写，用于 hover 切换。
export const productCardArgs = {
  select: {
    id: true,
    slug: true,
    title: true,
    priceCents: true,
    compareAtCents: true,
    brand: { select: { name: true, slug: true } },
    images: {
      orderBy: { position: 'asc' },
      take: 2,
      select: { url: true, blurDataUrl: true, alt: true },
    },
  },
} as const

export type ProductCardData = {
  id: string
  slug: string
  title: string
  priceCents: number
  compareAtCents: number | null
  brand: { name: string; slug: string }
  images: { url: string; blurDataUrl: string; alt: string }[]
}

type Cover = { url: string; blurDataUrl: string } | null

const activeIn = (gender: GenderSlug) =>
  ({ status: 'ACTIVE', gender: { in: genderValues(gender) } }) satisfies Prisma.ProductWhereInput

/**
 * 封面图的取值规则，全站一致：后台传过的自定义图优先，
 * 没传就拿这个范围下的第一张商品图顶上。所以后台不配置也不会开天窗。
 */
function coverOf(
  custom: { imageUrl: string | null; imageBlur: string | null },
  fallback: { url: string; blurDataUrl: string } | undefined,
): Cover {
  if (custom.imageUrl) {
    return { url: custom.imageUrl, blurDataUrl: custom.imageBlur ?? '' }
  }
  return fallback ?? null
}

/**
 * 兜底封面在候选里挑图时，同性别的优先。
 *
 * 包、表这类是 UNISEX，男女两边都算在范围内，谁排在前面纯看创建时间。
 * 直接取第一张的后果是女装的分类块上挂一张男模照片，或者首页男女两格
 * 用同一张图——看着都像是页面出错了。挑不到本性别的再退回第一张。
 */
function ownGenderFirst<T>(items: T[], gender: GenderSlug, genderOf: (item: T) => string) {
  return items.find((item) => genderOf(item) === GENDERS[gender].value) ?? items[0]
}

/**
 * 性别入口，首页和品牌页共用。没有货的那一边直接不返回，
 * 免得用户点进一个空页。
 */
export async function getGenderEntries(scope: Prisma.ProductWhereInput = {}) {
  const [products, showcases] = await Promise.all([
    db.product.findMany({
      where: { ...scope, status: 'ACTIVE' },
      orderBy: [{ featured: 'desc' }, { createdAt: 'asc' }],
      select: {
        gender: true,
        images: { where: { position: 0 }, take: 1, select: { url: true, blurDataUrl: true } },
      },
    }),
    getShowcases(),
  ])

  return GENDER_SLUGS.map((slug) => {
    const values = genderValues(slug)
    const matched = products.filter((product) => values.includes(product.gender))
    const custom = showcases[slug]

    const cover = ownGenderFirst(
      matched.filter((product) => product.images[0]),
      slug,
      (product) => product.gender,
    )

    return {
      slug,
      // 后台设了就用后台的，没设就退回代码里的 Men / Women
      label: custom.headline || GENDERS[slug].label,
      count: matched.length,
      image: coverOf(custom, cover?.images[0]),
    }
  }).filter((entry) => entry.count > 0)
}

/**
 * 某个性别下的品牌墙。封面图用一条查询取回全部候选再在内存里分组，
 * 而不是每个品牌查一次——品牌数会涨到几十个，N+1 不划算。
 */
export async function getGenderBrands(gender: GenderSlug) {
  const scope = activeIn(gender)

  const [brands, covers] = await Promise.all([
    db.brand.findMany({
      orderBy: { position: 'asc' },
      select: {
        slug: true,
        name: true,
        description: true,
        imageUrl: true,
        imageBlur: true,
        _count: { select: { products: { where: scope } } },
      },
    }),
    db.productImage.findMany({
      where: { position: 0, product: scope },
      orderBy: [{ product: { featured: 'desc' } }, { product: { createdAt: 'asc' } }],
      select: {
        url: true,
        blurDataUrl: true,
        product: { select: { gender: true, brand: { select: { slug: true } } } },
      },
    }),
  ])

  // 每个品牌留一张。同性别的能顶掉先占位的 UNISEX，理由见 ownGenderFirst
  const cover = new Map<string, { url: string; blurDataUrl: string; own: boolean }>()
  for (const image of covers) {
    const slug = image.product.brand.slug
    const own = image.product.gender === GENDERS[gender].value
    const held = cover.get(slug)
    if (!held || (own && !held.own)) {
      cover.set(slug, { url: image.url, blurDataUrl: image.blurDataUrl, own })
    }
  }

  return brands
    .filter((brand) => brand._count.products > 0)
    .map((brand) => ({
      slug: brand.slug,
      name: brand.name,
      description: brand.description,
      count: brand._count.products,
      image: coverOf(brand, cover.get(brand.slug)),
    }))
}

const RAIL_SIZE = 12

/**
 * 首页那几条横向商品栏。免税店首页那种密度靠的就是这个：
 * 进来先看到货和价格，而不是只有两个性别入口。
 *
 * 精选打头、新品补位合成一条：店主在后台标的精选是有意的，但只有几件时
 * 单开一条会很空；补上最新的凑满，既尊重人工挑选又不会开天窗。
 */
export async function getHomeRails() {
  const active = { status: 'ACTIVE' } satisfies Prisma.ProductWhereInput

  const [featured, newest, discounted] = await Promise.all([
    db.product.findMany({
      where: { ...active, featured: true },
      orderBy: { createdAt: 'asc' },
      take: RAIL_SIZE,
      ...productCardArgs,
    }),
    db.product.findMany({
      where: active,
      orderBy: { createdAt: 'desc' },
      take: RAIL_SIZE * 2,
      ...productCardArgs,
    }),
    // SQLite 下两列相互比较不好写进 where，先粗筛非空再在内存里挑真正降价的
    db.product.findMany({
      where: { ...active, compareAtCents: { not: null } },
      orderBy: { createdAt: 'desc' },
      take: RAIL_SIZE * 2,
      ...productCardArgs,
    }),
  ])

  const seen = new Set(featured.map((product) => product.id))
  const picks = [...featured, ...newest.filter((product) => !seen.has(product.id))].slice(
    0,
    RAIL_SIZE,
  )

  return {
    picks,
    sale: discounted
      .filter((product) => product.compareAtCents! > product.priceCents)
      .slice(0, RAIL_SIZE),
  }
}

/**
 * 顶部大菜单用的品牌，按字母排，带上各自有货的性别。
 *
 * /[性别]/[品牌] 在该性别无货时直接 404，所以导航不能拿全量品牌去拼链接：
 * 新建还没上货的品牌、货全下架的品牌、以及只做单性别的品牌，都会变成死链。
 * 有货的性别在这里一次算清楚，调用方按当前性别过滤即可。
 */
export async function getBrands() {
  const brands = await db.brand.findMany({
    orderBy: { name: 'asc' },
    select: {
      slug: true,
      name: true,
      // distinct 之后每个品牌最多回三行（MEN/WOMEN/UNISEX），不会因为货多而变大
      products: { where: { status: 'ACTIVE' }, select: { gender: true }, distinct: ['gender'] },
    },
  })

  return brands
    .map(({ products, ...brand }) => ({
      ...brand,
      genders: GENDER_SLUGS.filter((slug) =>
        products.some((product) => genderValues(slug).includes(product.gender)),
      ),
    }))
    .filter((brand) => brand.genders.length > 0)
}

/**
 * 首页和 /brands 的品牌墙。不按性别拆：一个品牌一行，封面优先用后台传的图。
 */
export async function getBrandIndex() {
  const active = { status: 'ACTIVE' } satisfies Prisma.ProductWhereInput

  const [brands, covers] = await Promise.all([
    db.brand.findMany({
      orderBy: [{ position: 'asc' }, { name: 'asc' }],
      select: {
        slug: true,
        name: true,
        description: true,
        imageUrl: true,
        imageBlur: true,
        _count: { select: { products: { where: active } } },
      },
    }),
    db.productImage.findMany({
      where: { position: 0, product: active },
      orderBy: [{ product: { featured: 'desc' } }, { product: { createdAt: 'asc' } }],
      select: {
        url: true,
        blurDataUrl: true,
        product: { select: { brand: { select: { slug: true } } } },
      },
    }),
  ])

  const cover = new Map<string, { url: string; blurDataUrl: string }>()
  for (const image of covers) {
    const slug = image.product.brand.slug
    if (!cover.has(slug)) cover.set(slug, { url: image.url, blurDataUrl: image.blurDataUrl })
  }

  return brands
    .filter((brand) => brand._count.products > 0)
    .map((brand) => ({
      slug: brand.slug,
      name: brand.name,
      description: brand.description,
      count: brand._count.products,
      image: coverOf(brand, cover.get(brand.slug)),
    }))
}

/** /brands/[brand]：品牌不存在或没有在售商品就当没有这个页 */
export async function getBrandCatalog(brandSlug: string) {
  const brand = await db.brand.findUnique({
    where: { slug: brandSlug },
    select: { id: true, slug: true, name: true, description: true },
  })
  if (!brand) return null

  const active = { status: 'ACTIVE', brandId: brand.id } satisfies Prisma.ProductWhereInput
  const [parents, products] = await Promise.all([
    db.category.findMany({
      where: { parentId: null },
      orderBy: { position: 'asc' },
      select: { slug: true, name: true, children: { select: { id: true } } },
    }),
    db.product.findMany({
      where: active,
      select: { categoryId: true },
    }),
  ])

  const categories = parents
    .map((parent) => {
      const ids = new Set(parent.children.map((child) => child.id))
      const count = products.filter((product) => ids.has(product.categoryId)).length
      return { slug: parent.slug, name: parent.name, count }
    })
    .filter((parent) => parent.count > 0)

  if (!products.length) return null
  return { brand, categories }
}

/** 某品牌某性别下真正有货的一级类别，带封面图和件数 */
export async function getBrandCategories(brandId: string, gender: GenderSlug) {
  const scope = { ...activeIn(gender), brandId }

  const [parents, products] = await Promise.all([
    db.category.findMany({
      where: { parentId: null },
      orderBy: { position: 'asc' },
      select: { slug: true, name: true, children: { select: { id: true } } },
    }),
    db.product.findMany({
      where: scope,
      orderBy: [{ featured: 'desc' }, { createdAt: 'asc' }],
      select: {
        categoryId: true,
        gender: true,
        images: { where: { position: 0 }, take: 1, select: { url: true, blurDataUrl: true } },
      },
    }),
  ])

  return parents
    .map((parent) => {
      const ids = new Set(parent.children.map((child) => child.id))
      const matched = products.filter((product) => ids.has(product.categoryId))
      const cover = ownGenderFirst(
        matched.filter((product) => product.images[0]),
        gender,
        (product) => product.gender,
      )
      return {
        slug: parent.slug,
        name: parent.name,
        count: matched.length,
        image: (cover?.images[0] ?? null) as Cover,
      }
    })
    .filter((parent) => parent.count > 0)
}

/**
 * /[性别]/[品牌] 和它下面的类别页要的是同一批数据，在这里查一次。
 * 性别拼错、品牌不存在、或该品牌这个性别根本没货，一律返回 null 交给页面 404。
 */
export async function getBrandPage(genderSlug: string, brandSlug: string) {
  if (!isGenderSlug(genderSlug)) return null

  const brand = await db.brand.findUnique({
    where: { slug: brandSlug },
    select: { id: true, slug: true, name: true, description: true },
  })
  if (!brand) return null

  const [genders, categories] = await Promise.all([
    getGenderEntries({ brandId: brand.id }),
    getBrandCategories(brand.id, genderSlug),
  ])
  if (categories.length === 0) return null

  return { brand, gender: genderSlug, genders, categories }
}

/**
 * 把一个分类 slug 转成 where 片段。一级分类要连同它下面的二级分类一起算，
 * 否则点 Clothing 会一件都查不到——商品全挂在二级分类上。
 */
export async function categoryScope(slug: string) {
  const category = await db.category.findUnique({
    where: { slug },
    select: { id: true, name: true, nameZh: true, children: { select: { id: true } } },
  })
  if (!category) return null

  const ids = [category.id, ...category.children.map((child) => child.id)]
  return {
    category,
    where: { categoryId: { in: ids } } satisfies Prisma.ProductWhereInput,
  }
}
