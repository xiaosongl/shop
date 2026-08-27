import { db } from './db'

/**
 * 按「颜色 × 尺码」把规格拉平成 SKU 行。
 *
 * 两边都留空也会建一个无规格的兜底 SKU——没有任何 variant 的商品在详情页
 * 会渲染出一个点了没反应的加购按钮，那是最难被发现的一类坏。
 *
 * 已有 SKU 的库存原样保留（库存是运营改出来的，不该被商品表单覆盖）；
 * 不再列出的规格只有在没被下过单时才删，否则历史订单的 variantId 会被置空。
 *
 * 放在 admin-actions.ts 外面，是因为那个文件带 'use server'，
 * 从那里导出等于给这个函数开一个不需要登录的公开端点。
 *
 * ponytail: 颜色和尺码取笛卡尔积，做不了「黑色只有 M/L、米色全码」这种不规则组合。
 * 真要做得上一张规格表逐行编辑，等有这个需求再说。
 */
export async function syncVariants(
  productId: string,
  slug: string,
  colorsRaw: string | undefined,
  sizesRaw: string | undefined,
) {
  const colors = splitList(colorsRaw).map((entry) => {
    const [name, hex] = entry.split(':').map((part) => part.trim())
    return { name, hex: hex || null }
  })
  const sizes = splitList(sizesRaw)

  const combos: { color: string | null; colorHex: string | null; size: string | null }[] = []
  for (const color of colors.length ? colors : [null]) {
    for (const size of sizes.length ? sizes : [null]) {
      combos.push({ color: color?.name ?? null, colorHex: color?.hex ?? null, size })
    }
  }

  const existing = await db.productVariant.findMany({
    where: { productId },
    select: { id: true, sku: true, _count: { select: { orderItems: true } } },
  })
  const bySku = new Map(existing.map((variant) => [variant.sku, variant]))

  const wanted = new Set<string>()
  for (const combo of combos) {
    const sku = skuFor(slug, combo.color, combo.size)
    wanted.add(sku)
    const match = bySku.get(sku)
    if (match) {
      await db.productVariant.update({
        where: { id: match.id },
        data: { size: combo.size, color: combo.color, colorHex: combo.colorHex },
      })
    } else {
      await db.productVariant.create({ data: { productId, sku, ...combo, stock: 0 } })
    }
  }

  const orphans = existing.filter(
    (variant) => !wanted.has(variant.sku) && variant._count.orderItems === 0,
  )
  if (orphans.length) {
    await db.productVariant.deleteMany({ where: { id: { in: orphans.map((v) => v.id) } } })
  }
}

function splitList(raw: string | undefined): string[] {
  return (raw ?? '')
    .split(',')
    .map((entry) => entry.trim())
    .filter(Boolean)
}

/** SKU 全局唯一，所以带上 slug；只留 A-Z0-9- 是为了扫码枪和人工核对都不出错 */
export function skuFor(slug: string, color: string | null, size: string | null): string {
  return [slug, color, size]
    .filter(Boolean)
    .join('-')
    .toUpperCase()
    .replace(/[^A-Z0-9-]/g, '')
}
