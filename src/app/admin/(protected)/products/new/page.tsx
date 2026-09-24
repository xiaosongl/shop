import Link from 'next/link'
import { ProductForm } from '@/components/admin/product-form'
import { assertAdminPage } from '@/lib/admin-auth'
import { db } from '@/lib/db'

export default async function NewProduct() {
  await assertAdminPage()
  const [brands, categories] = await Promise.all([
    db.brand.findMany({ orderBy: { name: 'asc' }, select: { id: true, name: true } }),
    db.category.findMany({
      where: { parentId: { not: null } },
      orderBy: { position: 'asc' },
      select: { id: true, name: true, nameZh: true, parent: { select: { nameZh: true } } },
    }),
  ])

  return (
    <>
      <Link href="/admin/products" className="text-xs text-faint hover:text-ink">
        ← 返回商品列表
      </Link>
      <h1 className="mt-4 mb-6 text-xl">新建商品</h1>
      <ProductForm brands={brands} categories={categories} />
    </>
  )
}
