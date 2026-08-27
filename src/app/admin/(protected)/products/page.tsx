import Image from 'next/image'
import Link from 'next/link'
import {
  Badge,
  ButtonLink,
  Empty,
  PageHeader,
  Pager,
  STATUS_LABEL,
  Table,
  pageFrom,
} from '@/components/admin/ui'
import { db } from '@/lib/db'
import { formatPrice } from '@/lib/format'

export default async function AdminProducts({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; page?: string }>
}) {
  const { q, page: pageParam } = await searchParams
  const query = q?.trim() ?? ''
  const where = query ? { OR: [{ title: { contains: query } }, { slug: { contains: query } }] } : {}

  // 先数总数才能知道有几页，也才能把越界的页码夹回来
  const total = await db.product.count({ where })
  const { page, pages, skip, take } = pageFrom(pageParam, total)

  const products = await db.product.findMany({
    where,
    orderBy: [{ status: 'asc' }, { createdAt: 'desc' }],
    skip,
    take,
    select: {
      id: true,
      title: true,
      slug: true,
      status: true,
      gender: true,
      priceCents: true,
      brand: { select: { name: true } },
      category: { select: { name: true } },
      images: { take: 1, orderBy: { position: 'asc' }, select: { url: true } },
      variants: { select: { stock: true } },
    },
  })

  return (
    <>
      <PageHeader
        title="商品"
        count={`共 ${total} 个`}
        action={<ButtonLink href="/admin/products/new">新建商品</ButtonLink>}
      />

      <form className="mb-5">
        <input
          name="q"
          defaultValue={query}
          placeholder="按名称或 slug 搜索"
          className="w-full max-w-sm border border-line bg-white px-3 py-2 text-sm outline-none focus:border-ink"
        />
      </form>

      <Table head={['商品', '品牌', '类别', '性别', '价格', '库存', '状态']}>
        {products.length === 0 ? (
          <tr>
            <td colSpan={7}>
              <Empty>没有找到商品</Empty>
            </td>
          </tr>
        ) : (
          products.map((product) => {
            const stock = product.variants.reduce((sum, variant) => sum + variant.stock, 0)
            return (
              <tr key={product.id} className="hover:bg-shell">
                <td className="px-4 py-3">
                  <Link href={`/admin/products/${product.id}`} className="flex items-center gap-3">
                    <span className="relative aspect-[4/5] w-10 shrink-0 overflow-hidden bg-shell">
                      {product.images[0] && (
                        <Image
                          src={product.images[0].url}
                          alt=""
                          fill
                          sizes="40px"
                          className="object-cover"
                        />
                      )}
                    </span>
                    <span className="min-w-0">
                      <span className="block hover:underline">{product.title}</span>
                      <span className="block text-xs text-faint">{product.slug}</span>
                    </span>
                  </Link>
                </td>
                <td className="px-4 py-3 text-muted">{product.brand.name}</td>
                <td className="px-4 py-3 text-muted">{product.category.name}</td>
                <td className="px-4 py-3 text-muted">{STATUS_LABEL[product.gender]}</td>
                <td className="px-4 py-3 tabular-nums">{formatPrice(product.priceCents)}</td>
                <td className={`px-4 py-3 tabular-nums ${stock === 0 ? 'text-sale' : ''}`}>{stock}</td>
                <td className="px-4 py-3">
                  <Badge value={product.status} />
                </td>
              </tr>
            )
          })
        )}
      </Table>

      <Pager path="/admin/products" params={{ q: query }} page={page} pages={pages} />
    </>
  )
}
