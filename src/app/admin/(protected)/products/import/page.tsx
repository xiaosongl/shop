import { ImportProducts } from '@/components/admin/import-products'
import { assertAdminPage } from '@/lib/admin-auth'
import { db } from '@/lib/db'
import { IMPORT_COLUMNS } from '@/lib/product-import'

export default async function AdminImportProducts() {
  await assertAdminPage()
  // 类目是种子里固定的，后台建不了。先摆出来，省得填错了才从报错里知道有哪些
  const categories = await db.category.findMany({
    where: { parentId: { not: null } },
    orderBy: [{ parent: { position: 'asc' } }, { position: 'asc' }],
    select: { slug: true, nameZh: true },
  })

  // 列定义从服务端传：product-import 里引了 dns 和数据库，客户端直接 import 会把它们打进包
  return (
    <ImportProducts
      columns={IMPORT_COLUMNS.map((column) => ({ ...column }))}
      categories={categories}
    />
  )
}
