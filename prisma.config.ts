import { mkdirSync } from 'node:fs'
import { defineConfig } from 'prisma/config'

// Prisma 7 不再自动读 .env，CLI 侧要自己加载。
// process.loadEnvFile 是 Node 自带的，不用为此装 dotenv。
try {
  process.loadEnvFile('.env')
} catch {
  // .env 不存在时走下面的默认值，CI 和全新克隆都不会因此卡住
}

const url = process.env.DATABASE_URL ?? 'file:./data/shop.db'

// SQLite 不会自己建目录，data/ 又在 .gitignore 里，全新克隆时它不存在
mkdirSync('data', { recursive: true })

export default defineConfig({
  schema: 'prisma/schema.prisma',
  datasource: { url },
  migrations: {
    seed: 'tsx prisma/seed.ts',
  },
})
