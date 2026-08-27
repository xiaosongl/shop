import { BrandManager } from '@/components/admin/brand-manager'
import { PageHeader, Pager, pageFrom } from '@/components/admin/ui'
import { db } from '@/lib/db'

export default async function AdminBrands({
  searchParams,
}: {
  searchParams: Promise<{ page?: string }>
}) {
  const { page: pageParam } = await searchParams
  const total = await db.brand.count()
  const { page, pages, skip, take } = pageFrom(pageParam, total)

  const brands = await db.brand.findMany({
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
      <BrandManager brands={brands} />
      <Pager path="/admin/brands" page={page} pages={pages} />
    </>
  )
}
