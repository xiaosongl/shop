import Link from 'next/link'
import { GENDERS, type GenderSlug } from '@/lib/taxonomy'

type GenderEntry = { slug: GenderSlug; label: string; count: number }
type CategoryEntry = { slug: string; name: string; count: number }

/**
 * 品牌页头部：面包屑 + 品牌名 + 性别切换 + 类别栏。
 * 类别栏只在商品列表页给（品牌页本身把类别做成图块了）。
 */
export function BrandSubnav({
  brand,
  genders,
  gender,
  categories,
  category,
}: {
  brand: { slug: string; name: string; description?: string | null }
  genders: GenderEntry[]
  gender: GenderSlug
  categories?: CategoryEntry[]
  category?: string
}) {
  const base = `/${gender}/${brand.slug}`

  return (
    <div className="border-b border-line">
      <div className="mx-auto max-w-7xl px-5 pt-8">
        <nav aria-label="Breadcrumb" className="label-xs flex flex-wrap items-center gap-2 text-faint">
          <Link href={`/${gender}`} className="hover:text-ink">
            {GENDERS[gender].label}
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
          <p className="mt-3 max-w-2xl text-[15px] leading-relaxed text-muted">
            {brand.description}
          </p>
        )}

        <div className="mt-7 flex items-center gap-7">
          {genders.map((entry) => (
            <Link
              key={entry.slug}
              href={`/${entry.slug}/${brand.slug}`}
              aria-current={entry.slug === gender ? 'page' : undefined}
              className={`border-b-2 pt-2 pb-2.5 text-sm transition-colors ${
                entry.slug === gender
                  ? 'border-ink text-ink'
                  : 'border-transparent text-muted hover:text-ink'
              }`}
            >
              {entry.label}
            </Link>
          ))}
        </div>

        {categories && categories.length > 0 ? (
          <div className="no-scrollbar -mx-5 mt-3 flex scroll-pl-5 gap-6 overflow-x-auto px-5 pb-3">
            {categories.map((entry) => (
              <Link
                key={entry.slug}
                href={`${base}/${entry.slug}`}
                aria-current={entry.slug === category ? 'page' : undefined}
                className={`flex min-h-11 shrink-0 items-center text-sm whitespace-nowrap transition-colors ${
                  entry.slug === category
                    ? 'text-ink underline underline-offset-[6px]'
                    : 'text-muted hover:text-ink'
                }`}
              >
                {entry.name}
                <span className="ml-1.5 text-faint">{entry.count}</span>
              </Link>
            ))}
          </div>
        ) : (
          <div className="pb-6" />
        )}
      </div>
    </div>
  )
}
