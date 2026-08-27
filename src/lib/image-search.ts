import { readFile } from 'node:fs/promises'
import path from 'node:path'

import { db } from './db'
import { productCardArgs, type ProductCardData } from './queries'
import { embedImage, fromBytes, similarity, toBytes } from './vision'

// 阈值是量出来的，不是拍的。拿商品原图做微信压缩/缩放/裁边/加白边截屏/多次转发/灰度，
// 同款最低 0.9042，不同款最高 0.8225，随机噪声和纯色块最高 0.6749。
// 改这几个数之前先跑 scripts/smoke.ts 里的 runImageSearch，那儿盯着这条线。
const DIRECT = 0.88 // 高于此且甩开第二名，就是同一件货，直接跳详情页
const MARGIN = 0.05 // 两件商品分数咬得很紧时别乱跳，老实列出来让人自己挑
const FLOOR = 0.7 // 低于此的是噪声级别，宁可说"没找到"也不硬凑
const LIMIT = 24

export type ImageMatch = { product: ProductCardData; score: number }
export type ImageSearchResult =
  | { kind: 'direct'; slug: string; score: number }
  | { kind: 'matches'; matches: ImageMatch[]; loose: boolean }
  | { kind: 'none' }
  | { kind: 'unindexed' }

type Row = { productId: string; vector: Float32Array }

// 每次搜索都从库里捞几万条 BLOB 太浪费，进程里存一份。
// ponytail: 单进程内存索引，暴力比对。上万商品也就几十 MB、几毫秒；
// 真到十万级再换 sqlite-vec 或者 HNSW。
let index: Promise<Row[]> | null = null

/** 商品图有增删时调用，下次搜索会重建索引 */
export function dropImageIndex() {
  index = null
}

async function load(): Promise<Row[]> {
  const rows = await db.productImage.findMany({
    where: { NOT: { embedding: null }, product: { status: 'ACTIVE' } },
    select: { productId: true, embedding: true },
  })
  return rows.flatMap((row) => {
    const vector = row.embedding && fromBytes(row.embedding)
    return vector ? [{ productId: row.productId, vector }] : []
  })
}

export async function searchByImage(input: Buffer): Promise<ImageSearchResult> {
  const [query, rows] = await Promise.all([embedImage(input), (index ??= load())])
  if (rows.length === 0) {
    index = null // 可能只是回填还没跑，别把空索引一直缓存着
    return { kind: 'unindexed' }
  }

  // 一件商品有主图和细节图两张，按最像的那张算分
  const best = new Map<string, number>()
  for (const row of rows) {
    const score = similarity(query, row.vector)
    if (score > (best.get(row.productId) ?? -1)) best.set(row.productId, score)
  }

  const ranked = [...best]
    .sort((a, b) => b[1] - a[1])
    .filter(([, score]) => score >= FLOOR)
    .slice(0, LIMIT)
  if (ranked.length === 0) return { kind: 'none' }

  const [topId, topScore] = ranked[0]
  const clear = ranked.length === 1 || topScore - ranked[1][1] >= MARGIN

  // 状态以库为准：索引可能是商品下架前建的
  const products = await db.product.findMany({
    where: { id: { in: ranked.map(([id]) => id) }, status: 'ACTIVE' },
    ...productCardArgs,
  })
  const byId = new Map(products.map((p) => [p.id, p]))

  if (topScore >= DIRECT && clear) {
    const hit = byId.get(topId)
    if (hit) return { kind: 'direct', slug: hit.slug, score: topScore }
  }

  const matches = ranked.flatMap(([id, score]) => {
    const product = byId.get(id)
    return product ? [{ product: product as ProductCardData, score }] : []
  })
  if (matches.length === 0) return { kind: 'none' }

  // 最高分也就刚过地板，说明库里没有很像的，前台要如实说明，别让人以为这就是同款
  return { kind: 'matches', matches, loose: matches[0].score < 0.78 }
}

/**
 * 建索引只有这一条路径：seed 完调、后台传完图调、部署时也调。
 * 只补 embedding 为空的行，所以随便重跑，漏了哪张下次自动补上。
 */
export async function backfillEmbeddings(log?: (message: string) => void) {
  const rows = await db.productImage.findMany({
    where: { embedding: null },
    select: { id: true, url: true },
  })
  if (rows.length === 0) return { done: 0, failed: 0 }

  let done = 0
  let failed = 0
  for (const row of rows) {
    try {
      const vector = await embedImage(await readSource(row.url))
      await db.productImage.update({ where: { id: row.id }, data: { embedding: toBytes(vector) } })
      done += 1
      if (done % 20 === 0) log?.(`  ${done}/${rows.length}`)
    } catch (error) {
      // 少一张图不该让整批停下
      failed += 1
      log?.(`  跳过 ${row.url}：${error instanceof Error ? error.message : error}`)
    }
  }

  dropImageIndex()
  return { done, failed }
}

/** url 指向 1200 那档，取 400 的来算：CLIP 反正要缩到 224，省一次大解码 */
function readSource(url: string) {
  const inPublic = (name: string) => path.join(process.cwd(), 'public', name)
  return readFile(inPublic(url.replace(/-\d+\.webp$/, '-400.webp'))).catch(() =>
    readFile(inPublic(url)),
  )
}
