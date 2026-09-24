import Link from 'next/link'
import type { Prisma } from '@/generated/prisma/client'
import { db } from '@/lib/db'
import {
  PAGE_SIZE,
  SORTS,
  buildWhere,
  getFacets,
  hrefWith,
  orderByFor,
  parseFilters,
  type SearchParams,
  type SortKey,
} from '@/lib/product-filters'
import { productCardArgs } from '@/lib/queries'
import { FilterDrawer } from './filter-drawer'
import { FilterGroups } from './filter-groups'
import { ProductCard } from './product-card'
import { SortSelect } from './sort-select'

export async function ProductListing({
  title,
  description,
  basePath,
  base,
  searchParams,
}: {
  /** 省略时不渲染标题区，留给页面自己的头部（例如品牌页的二级导航） */
  title?: string
  description?: string | null
  basePath: string
  /** 页面自身的范围限定，例如某个分类下的所有商品或某个品牌的所有商品 */
  base: Prisma.ProductWhereInput
  searchParams: SearchParams
}) {
  const filters = parseFilters(searchParams)
  const where = buildWhere(base, filters)

  const [products, total, facets] = await Promise.all([
    db.product.findMany({
      where,
      orderBy: orderByFor(filters.sort),
      skip: (filters.page - 1) * PAGE_SIZE,
      take: PAGE_SIZE,
      ...productCardArgs,
    }),
    db.product.count({ where }),
    getFacets(base),
  ])

  const pageCount = Math.max(1, Math.ceil(total / PAGE_SIZE))
  const activeCount =
    filters.brands.length + filters.sizes.length + filters.colors.length + (filters.price ? 1 : 0)

  const sortOptions = (Object.keys(SORTS) as SortKey[]).map((key) => ({
    value: key,
    label: SORTS[key],
    href: hrefWith(basePath, searchParams, { sort: key }),
  }))

  const filterGroups = (
    <FilterGroups
      facets={facets}
      filters={filters}
      basePath={basePath}
      searchParams={searchParams}
    />
  )

  return (
    <div className="mx-auto max-w-7xl px-5 py-12">
      {title && (
        <header className="max-w-2xl">
          <h1 className="text-3xl font-normal tracking-tight md:text-4xl">{title}</h1>
          {description && (
            <p className="mt-3 text-[15px] leading-relaxed text-muted">{description}</p>
          )}
        </header>
      )}

      {/* 这一条的高度由 Filter / 排序自己的 min-h-11 撑起来，别再在这儿加 pb：
          手指要够得着，44px 是下限，光靠文字行高只有 13px */}
      <div
        className={`flex items-center justify-between border-b border-line ${
          title ? 'mt-10' : ''
        }`}
      >
        <div className="flex items-center gap-5">
          <span className="label-xs text-faint">
            {total} {total === 1 ? 'item' : 'items'}
          </span>
          <FilterDrawer count={activeCount}>{filterGroups}</FilterDrawer>
        </div>
        <SortSelect value={filters.sort} options={sortOptions} />
      </div>

      <div className="mt-8 lg:grid lg:grid-cols-[190px_minmax(0,1fr)] lg:gap-12">
        <aside className="hidden lg:block">{filterGroups}</aside>

        <div>
          {products.length === 0 ? (
            <div className="py-24 text-center">
              <p className="text-sm text-muted">Nothing matches these filters.</p>
              <Link
                href={hrefWith(basePath, searchParams, {
                  brand: null,
                  size: null,
                  color: null,
                  price: null,
                })}
                className="label-xs mt-4 inline-block border-b border-ink pb-0.5"
              >
                Clear filters
              </Link>
            </div>
          ) : (
            // 手机上是一行一个的图文列表，md 起换回网格
            <div className="flex flex-col divide-y divide-line md:grid md:grid-cols-3 md:gap-x-4 md:gap-y-10 md:divide-y-0">
              {products.map((product, index) => (
                <ProductCard
                  key={product.id}
                  product={product}
                  list
                  priority={index < 3}
                  // 手机上图只有 128px 宽，报 50vw 会让 3 倍屏白下载 800 那档
                  sizes="(min-width: 1024px) 28vw, (min-width: 768px) 33vw, 128px"
                />
              ))}
            </div>
          )}

          {pageCount > 1 && (
            <nav className="mt-16 flex items-center justify-center gap-1">
              {filters.page > 1 && (
                <Link
                  href={hrefWith(basePath, searchParams, {
                    page: filters.page === 2 ? null : String(filters.page - 1),
                  })}
                  className="px-3 pt-2 text-sm text-muted hover:text-ink"
                >
                  Prev
                </Link>
              )}
              {pageWindow(filters.page, pageCount).map((page) => (
                <Link
                  key={page}
                  href={hrefWith(basePath, searchParams, { page: page === 1 ? null : String(page) })}
                  className={`size-9 pt-2 text-center text-sm transition-colors ${
                    page === filters.page ? 'bg-ink text-white' : 'text-muted hover:text-ink'
                  }`}
                >
                  {page}
                </Link>
              ))}
              {filters.page < pageCount && (
                <Link
                  href={hrefWith(basePath, searchParams, { page: String(filters.page + 1) })}
                  className="px-3 pt-2 text-sm text-muted hover:text-ink"
                >
                  Next
                </Link>
              )}
            </nav>
          )}
        </div>
      </div>
    </div>
  )
}

/** 页数一多就把页码收成当前页附近的一段，避免几十个按钮排成一条。 */
function pageWindow(current: number, total: number) {
  const width = 7
  if (total <= width) return Array.from({ length: total }, (_, index) => index + 1)
  const start = Math.max(1, Math.min(current - 3, total - width + 1))
  return Array.from({ length: width }, (_, index) => start + index)
}
