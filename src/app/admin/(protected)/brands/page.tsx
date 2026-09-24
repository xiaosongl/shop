import { BrandManager } from '@/components/admin/brand-manager'
import { PageHeader, Pager, Search, pageFrom, queryFrom } from '@/components/admin/ui'
import { assertAdminPage } from '@/lib/admin-auth'
import { db } from '@/lib/db'

export default async function AdminBrands({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; page?: string }>
}) {
  await assertAdminPage()
  const { q, page: pageParam } = await searchParams
  const query = queryFrom(q)
  const where = query
    ? { OR: [{ name: { contains: query } }, { slug: { contains: query } }] }
    : {}

  const total = await db.brand.count({ where })
  const { page, pages, skip, take } = pageFrom(pageParam, total)

  const brands = await db.brand.findMany({
    where,
    orderBy: [{ position: 'asc' }, { name: 'asc' }],
    skip,
    take,
    select: {
      id: true,
      name: true,
      slug: true,
      description: true,
      position: true,
      imageUrl: true,
      _count: { select: { products: true } },
    },
  })

  return (
    <>
      <PageHeader title="品牌" count={`共 ${total} 个`} />
      <Search action="/admin/brands" q={query} placeholder="搜索品牌名或 slug" />
      <BrandManager brands={brands} empty={query ? '没有找到品牌' : '还没有品牌'} />
      <Pager path="/admin/brands" params={{ q: query }} page={page} pages={pages} />
    </>
  )
}
