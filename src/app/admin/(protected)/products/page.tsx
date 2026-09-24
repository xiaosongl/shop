import Image from 'next/image'
import Link from 'next/link'
import { ProductRowActions } from '@/components/admin/product-actions'
import {
  Badge,
  ButtonLink,
  Empty,
  PageHeader,
  Pager,
  Search,
  STATUS_LABEL,
  Table,
  pageFrom,
  queryFrom,
} from '@/components/admin/ui'
import { getAdminRole } from '@/lib/admin-auth'
import { db } from '@/lib/db'
import { formatPrice } from '@/lib/format'

const STATUS_FILTERS = [
  { value: '', label: '全部' },
  { value: 'ACTIVE', label: '在售' },
  { value: 'ARCHIVED', label: '已下架' },
  { value: 'DRAFT', label: '草稿' },
] as const

export default async function AdminProducts({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; page?: string; status?: string }>
}) {
  const role = await getAdminRole()
  const canWrite = role === 'admin'
  const { q, page: pageParam, status: statusParam } = await searchParams
  const query = queryFrom(q)
  const status = STATUS_FILTERS.some((item) => item.value && item.value === statusParam)
    ? statusParam
    : ''
  const where = {
    ...(status ? { status } : {}),
    ...(query
      ? {
          OR: [
            { title: { contains: query } },
            { slug: { contains: query } },
            { brand: { name: { contains: query } } },
          ],
        }
      : {}),
  }

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
        action={
          canWrite ? (
            <div className="flex gap-2">
              <Link
                href="/admin/products/source"
                className="border border-line px-4 py-2 text-sm transition-colors hover:border-ink"
              >
                货源上架
              </Link>
              <Link
                href="/admin/products/import"
                className="border border-line px-4 py-2 text-sm transition-colors hover:border-ink"
              >
                批量导入
              </Link>
              <ButtonLink href="/admin/products/new">新建商品</ButtonLink>
            </div>
          ) : undefined
        }
      />

      <Search
        action="/admin/products"
        q={query}
        keep={{ status }}
        placeholder="搜索名称、slug 或品牌"
      />

      <div className="mb-4 flex flex-wrap gap-1">
        {STATUS_FILTERS.map((item) => {
          const active = item.value === status
          const href = item.value
            ? `/admin/products?status=${item.value}${query ? `&q=${encodeURIComponent(query)}` : ''}`
            : query
              ? `/admin/products?q=${encodeURIComponent(query)}`
              : '/admin/products'
          return (
            <Link
              key={item.label}
              href={href}
              aria-current={active ? 'page' : undefined}
              className={`px-3 py-1.5 text-sm ${active ? 'bg-ink text-white' : 'text-muted hover:text-ink'}`}
            >
              {item.label}
            </Link>
          )
        })}
      </div>

      <Table head={['商品', '品牌', '类别', '性别', '价格', '库存', '状态', ...(canWrite ? [''] : [])]}>
        {products.length === 0 ? (
          <tr>
            <td colSpan={canWrite ? 8 : 7}>
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
                {canWrite && (
                  <td className="px-4 py-3 text-right">
                    <ProductRowActions id={product.id} title={product.title} status={product.status} />
                  </td>
                )}
              </tr>
            )
          })
        )}
      </Table>

      <Pager path="/admin/products" params={{ q: query, status }} page={page} pages={pages} />
    </>
  )
}
