import { mkdirSync } from 'node:fs'
import path from 'node:path'
import { PrismaBetterSqlite3 } from '@prisma/adapter-better-sqlite3'
import { PrismaClient } from '@/generated/prisma/client'

const url = process.env.DATABASE_URL ?? 'file:./data/shop.db'

// data/ 在 .gitignore 里，全新克隆时不存在，而 SQLite 不会自己建目录
const filePath = url.replace(/^file:/, '')
if (filePath !== ':memory:') {
  mkdirSync(path.dirname(path.resolve(filePath)), { recursive: true })
}

// dev 模式下模块会被反复热重载，不缓存的话每次都新开一个连接池
const globalForDb = globalThis as unknown as { db?: PrismaClient }

export const db =
  globalForDb.db ?? new PrismaClient({ adapter: new PrismaBetterSqlite3({ url }) })

if (process.env.NODE_ENV !== 'production') globalForDb.db = db
