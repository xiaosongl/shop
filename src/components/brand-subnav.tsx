import Link from 'next/link'

type CategoryEntry = { slug: string; name: string; count: number }

/** 品牌页头部：面包屑 + 品牌名 + 类别栏。 */
export function BrandSubnav({
  brand,
  categories,
  category,
}: {
  brand: { slug: string; name: string; description?: string | null }
  categories?: CategoryEntry[]
  category?: string
}) {
  const base = `/brands/${brand.slug}`

  return (
    <div className="border-b border-line">
      <div className="mx-auto max-w-7xl px-5 pt-8">
        <nav aria-label="Breadcrumb" className="label-xs flex flex-wrap items-center gap-2 text-faint">
          <Link href="/brands" className="hover:text-ink">
            Brands
          </Link>
          <span aria-hidden>/</span>
          {category ? (
            <>
              <Link href={base} className="hover:text-ink">
                {brand.name}
              </Link>
              <span aria-hidden>/</span>
              <span className="text-ink">
                {categories?.find((entry) => entry.slug === category)?.name}
              </span>
            </>
          ) : (
            <span className="text-ink">{brand.name}</span>
          )}
        </nav>

        <Link href={base} className="mt-4 block">
          <h1 className="text-3xl font-normal tracking-tight md:text-4xl">{brand.name}</h1>
        </Link>
        {brand.description && !category && (
          <p className="mt-3 max-w-2xl text-[15px] leading-relaxed text-muted">{brand.description}</p>
        )}

        {categories && categories.length > 0 && (
          <div className="no-scrollbar -mx-5 mt-7 flex scroll-pl-5 gap-6 overflow-x-auto px-5 pb-3">
            <Link
              href={base}
              aria-current={category ? undefined : 'page'}
              className={`shrink-0 border-b-2 pb-3 text-sm transition-colors ${
                category ? 'border-transparent text-muted hover:text-ink' : 'border-ink text-ink'
              }`}
            >
              All
            </Link>
            {categories.map((entry) => (
              <Link
                key={entry.slug}
                href={`${base}/${entry.slug}`}
                aria-current={entry.slug === category ? 'page' : undefined}
                className={`shrink-0 border-b-2 pb-3 text-sm transition-colors ${
                  entry.slug === category
                    ? 'border-ink text-ink'
                    : 'border-transparent text-muted hover:text-ink'
                }`}
              >
                {entry.name}
                <span className="ml-1.5 text-xs text-faint">{entry.count}</span>
              </Link>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
