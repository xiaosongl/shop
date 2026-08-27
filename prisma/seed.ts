import { createHash } from 'node:crypto'
import { PrismaBetterSqlite3 } from '@prisma/adapter-better-sqlite3'
import { PrismaClient } from '../src/generated/prisma/client'
import { placeholderSource, processImage } from '../src/lib/images'
import { DEFAULT_POLICIES } from '../src/lib/policy'
import { DEFAULT_BANNER } from '../src/lib/showcase'
import { totalsFor } from '../src/lib/totals'
import { BRANDS, CATEGORIES, COLORS, PRODUCTS, SIZE_SETS, genderFor } from './catalog'
import type { ProductSeed } from './catalog'

try {
  process.loadEnvFile('.env')
} catch {
  // 直接 npx tsx prisma/seed.ts 跑时用默认值
}

const db = new PrismaClient({
  adapter: new PrismaBetterSqlite3({
    url: process.env.DATABASE_URL ?? 'file:./data/shop.db',
  }),
})

// 同时下载 + 处理的商品数。再高会被 Unsplash 限速，也吃满 CPU。
const CONCURRENCY = 5

async function mapLimit<T, R>(items: T[], limit: number, fn: (item: T, index: number) => Promise<R>) {
  const results: R[] = new Array(items.length)
  let cursor = 0
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (cursor < items.length) {
      const index = cursor++
      results[index] = await fn(items[index], index)
    }
  })
  await Promise.all(workers)
  return results
}

/**
 * 直接向 Unsplash 要 3:4 的裁切结果，而不是拿原图回来自己裁。
 * 原图多为横构图，本地裁成竖版要放大，糊；服务端裁是从全分辨率原图裁的，清晰。
 */
async function loadSource(unsplashId: string, fallbackSeed: string): Promise<Buffer> {
  const url = `https://images.unsplash.com/${unsplashId}?w=1600&h=2133&fit=crop&crop=entropy&q=80&fm=jpg`

  for (let attempt = 1; attempt <= 2; attempt++) {
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(25_000) })
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      return Buffer.from(await res.arrayBuffer())
    } catch (error) {
      if (attempt === 2) {
        console.warn(`  ! ${unsplashId} 下载失败（${(error as Error).message}），改用占位图`)
      }
    }
  }
  return placeholderSource(fallbackSeed)
}

/** 库存按 sku 稳定派生，保证每次 seed 结果一致，同时留出缺货和低库存的样本给后台预警用 */
function stockFor(sku: string): number {
  const n = createHash('sha1').update(sku).digest()[0]
  if (n < 12) return 0
  if (n < 40) return (n % 5) + 1
  return (n % 30) + 6
}

function skuFor(product: ProductSeed, color: string, size: string | null) {
  return ['NS', product.slug, color, size ?? 'OS'].join('-').toUpperCase()
}

function variantsFor(product: ProductSeed) {
  const sizes = SIZE_SETS[product.sizes] as readonly string[]
  const pairs = sizes.length
    ? sizes.flatMap((size) => product.colors.map((color) => ({ size, color })))
    : product.colors.map((color) => ({ size: null as string | null, color }))

  return pairs.map(({ size, color }) => {
    const sku = skuFor(product, color, size)
    return {
      sku,
      size,
      color: color.charAt(0).toUpperCase() + color.slice(1),
      colorHex: COLORS[color],
      stock: stockFor(sku),
    }
  })
}

function orderNumber(seed: string) {
  const raw = createHash('sha1').update(seed).digest('hex').slice(0, 10).toUpperCase()
  return `NS-${raw}`
}

async function main() {
  console.log('清空旧数据…')
  await db.orderItem.deleteMany()
  await db.order.deleteMany()
  await db.productVariant.deleteMany()
  await db.productImage.deleteMany()
  await db.product.deleteMany()
  await db.category.deleteMany()
  await db.brand.deleteMany()

  // 站点文案和政策页不在上面的清空名单里：这些是管理员自己写的内容。
  // 用 update:{} 的 upsert = 「缺了才补」，重跑种子不会把改过的文案冲回出厂设置。
  console.log('补齐默认公告与政策页…')
  await db.showcase.upsert({
    where: { key: 'banner' },
    update: {},
    create: { key: 'banner', headline: DEFAULT_BANNER },
  })
  for (const policy of DEFAULT_POLICIES) {
    await db.policy.upsert({ where: { slug: policy.slug }, update: {}, create: { ...policy } })
  }

  console.log(`写入 ${BRANDS.length} 个品牌…`)
  const brandIds = new Map<string, string>()
  for (const [index, brand] of BRANDS.entries()) {
    const row = await db.brand.create({ data: { ...brand, position: index } })
    brandIds.set(brand.slug, row.id)
  }

  console.log(`写入分类树…`)
  const categoryIds = new Map<string, string>()
  for (const [index, parent] of CATEGORIES.entries()) {
    const parentRow = await db.category.create({
      data: { slug: parent.slug, name: parent.name, nameZh: parent.nameZh, position: index },
    })
    categoryIds.set(parent.slug, parentRow.id)

    for (const [childIndex, child] of parent.children.entries()) {
      const childRow = await db.category.create({
        data: { ...child, position: childIndex, parentId: parentRow.id },
      })
      categoryIds.set(child.slug, childRow.id)
    }
  }

  console.log(`处理 ${PRODUCTS.length} 个商品的图片并入库（每个 2 张构图 × 4 档宽度）…`)
  let done = 0

  await mapLimit(PRODUCTS, CONCURRENCY, async (product) => {
    const source = await loadSource(product.image, product.slug)

    // 主图是完整构图，第二张是同一原图的局部特写，用作商品卡 hover 的切换图。
    // 比让相邻商品互相借图自然得多，也不额外消耗图源。
    const [full, detail] = await Promise.all([
      processImage(source, { dir: 'products', crop: 'full', withOg: true }),
      processImage(source, { dir: 'products', crop: 'detail' }),
    ])

    const categoryId = categoryIds.get(product.category)
    const brandId = brandIds.get(product.brand)
    if (!categoryId) throw new Error(`商品 ${product.slug} 引用了不存在的分类 ${product.category}`)
    if (!brandId) throw new Error(`商品 ${product.slug} 引用了不存在的品牌 ${product.brand}`)

    await db.product.create({
      data: {
        slug: product.slug,
        title: product.title,
        description: product.description,
        details: product.details.join('\n'),
        priceCents: product.priceCents,
        compareAtCents: product.compareAtCents ?? null,
        featured: product.featured ?? false,
        gender: genderFor(product.slug),
        categoryId,
        brandId,
        images: {
          create: [
            { ...full, alt: product.title, position: 0 },
            { ...detail, alt: `${product.title} detail`, position: 1 },
          ],
        },
        variants: { create: variantsFor(product) },
      },
    })

    done += 1
    console.log(`  [${String(done).padStart(2, ' ')}/${PRODUCTS.length}] ${product.title}`)
  })

  await seedDemoOrders()

  const counts = {
    分类: await db.category.count(),
    品牌: await db.brand.count(),
    商品: await db.product.count(),
    图片: await db.productImage.count(),
    SKU: await db.productVariant.count(),
    订单: await db.order.count(),
  }
  console.log('\n完成：', counts)
}

/** 造几笔订单，否则后台仪表盘和订单列表是空的，看不出效果 */
async function seedDemoOrders() {
  console.log('生成演示订单…')

  const variants = await db.productVariant.findMany({
    where: { stock: { gt: 0 } },
    include: { product: { include: { brand: true, images: { take: 1, orderBy: { position: 'asc' } } } } },
    take: 40,
  })
  if (!variants.length) return

  const customers = [
    { name: 'Emily Carter', email: 'emily.carter@example.com', city: 'Portland', state: 'OR', postalCode: '97205' },
    { name: 'Daniel Ruiz', email: 'daniel.ruiz@example.com', city: 'Austin', state: 'TX', postalCode: '78701' },
    { name: 'Sophia Nguyen', email: 'sophia.nguyen@example.com', city: 'Seattle', state: 'WA', postalCode: '98101' },
    { name: 'Marcus Bell', email: 'marcus.bell@example.com', city: 'Chicago', state: 'IL', postalCode: '60601' },
    { name: 'Hannah Weiss', email: 'hannah.weiss@example.com', city: 'Brooklyn', state: 'NY', postalCode: '11201' },
    { name: 'Owen Fraser', email: 'owen.fraser@example.com', city: 'Denver', state: 'CO', postalCode: '80202' },
  ]
  // 把订单状态、包装和支付方式铺开，后台每种情况都能看到样例
  const statuses = ['PENDING', 'PAID', 'SHIPPED', 'SHIPPED', 'PAID', 'CANCELLED']
  const shippings = ['boxed', 'discreet', 'boxed', 'discreet', 'boxed', 'boxed'] as const
  const payments = ['btc', 'whatsapp', 'btc', 'btc', 'whatsapp', 'btc']

  for (const [index, customer] of customers.entries()) {
    const picked = [variants[index * 3 % variants.length], variants[(index * 3 + 1) % variants.length]]

    const items = picked.map((variant, i) => ({
      variantId: variant.id,
      productSlug: variant.product.slug,
      productTitle: variant.product.title,
      brandName: variant.product.brand.name,
      variantLabel: [variant.color, variant.size].filter(Boolean).join(' / ') || 'One size',
      imageUrl: variant.product.images[0]?.url ?? '',
      unitPriceCents: variant.product.priceCents,
      quantity: i === 0 ? 1 : 2,
    }))

    const subtotalCents = items.reduce((sum, item) => sum + item.unitPriceCents * item.quantity, 0)

    await db.order.create({
      data: {
        number: orderNumber(customer.email),
        email: customer.email,
        status: statuses[index],
        ...totalsFor(subtotalCents, shippings[index]),
        shippingMethod: shippings[index],
        paymentMethod: payments[index],
        name: customer.name,
        line1: `${100 + index * 37} Market Street`,
        city: customer.city,
        state: customer.state,
        postalCode: customer.postalCode,
        country: 'US',
        createdAt: new Date(Date.now() - index * 36 * 3600 * 1000),
        items: { create: items },
      },
    })
  }
}

main()
  .catch((error) => {
    console.error(error)
    process.exitCode = 1
  })
  .finally(() => db.$disconnect())
