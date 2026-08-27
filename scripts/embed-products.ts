// 给还没有向量的商品图补上，跑完图搜才认得出它们。
// 可以反复跑：已经有向量的会跳过。加了新商品之后跑一遍即可。
// 换过模型就得 --reset 全部重算，否则新旧向量混在一个索引里，比出来的分没意义。
process.loadEnvFile?.()

// 全部走动态 import：db 要先读到 .env 里的 DATABASE_URL 才能建连接，
// 静态 import 会被提升到 loadEnvFile 之前。export {} 只是让 TS 认它是模块。
export {}

const { db } = await import('../src/lib/db')
const { backfillEmbeddings } = await import('../src/lib/image-search')

if (process.argv.includes('--reset')) {
  const { count } = await db.productImage.updateMany({ data: { embedding: null } })
  console.log(`已清空 ${count} 条旧向量`)
}

const started = Date.now()
const { done, failed } = await backfillEmbeddings((message) => console.log(message))

if (!done && !failed) console.log('所有商品图都已建好索引')
else {
  const secs = (Date.now() - started) / 1000
  console.log(`完成 ${done} 张，用时 ${secs.toFixed(1)}s（每张 ${((secs * 1000) / done).toFixed(0)}ms）`)
  if (failed) console.log(`有 ${failed} 张没能建索引`)
}
