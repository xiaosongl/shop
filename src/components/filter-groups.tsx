import Link from 'next/link'
import {
  PRICE_RANGES,
  hrefToggle,
  hrefWith,
  type Filters,
  type PriceKey,
  type SearchParams,
} from '@/lib/product-filters'

type Facets = {
  brands: { slug: string; name: string }[]
  sizes: string[]
  colors: { name: string; hex: string }[]
}

// 每个筛选项都是一条普通链接，服务端处理，不需要任何客户端状态。
// 顺带白拿 Next 的链接预取，点下去几乎没有等待感。
export function FilterGroups({
  facets,
  filters,
  basePath,
  searchParams,
}: {
  facets: Facets
  filters: Filters
  basePath: string
  searchParams: SearchParams
}) {
  const hasAny =
    filters.brands.length > 0 ||
    filters.sizes.length > 0 ||
    filters.colors.length > 0 ||
    filters.price !== null

  return (
    <div className="space-y-9">
      {hasAny && (
        <Link
          href={hrefWith(basePath, searchParams, {
            brand: null,
            size: null,
            color: null,
            price: null,
          })}
          className="label-xs inline-flex min-h-11 items-center text-sale"
        >
          Clear all
        </Link>
      )}

      {facets.brands.length > 1 && (
        <Group title="Brand">
          {facets.brands.map((brand) => (
            <Check
              key={brand.slug}
              label={brand.name}
              checked={filters.brands.includes(brand.slug)}
              href={hrefToggle(basePath, searchParams, 'brand', brand.slug)}
            />
          ))}
        </Group>
      )}

      {facets.sizes.length > 0 && (
        <Group title="Size">
          <div className="flex flex-wrap gap-2">
            {facets.sizes.map((size) => {
              const active = filters.sizes.includes(size)
              return (
                <Link
                  key={size}
                  href={hrefToggle(basePath, searchParams, 'size', size)}
                  className={`flex min-h-11 min-w-11 items-center justify-center border px-3 text-sm transition-colors ${
                    active ? 'border-ink bg-ink text-white' : 'border-line hover:border-ink'
                  }`}
                >
                  {size}
                </Link>
              )
            })}
          </div>
        </Group>
      )}

      {facets.colors.length > 0 && (
        <Group title="Color">
          {facets.colors.map((color) => (
            <Check
              key={color.name}
              label={color.name}
              swatch={color.hex}
              checked={filters.colors.includes(color.name)}
              href={hrefToggle(basePath, searchParams, 'color', color.name)}
            />
          ))}
        </Group>
      )}

      <Group title="Price">
        {(Object.keys(PRICE_RANGES) as PriceKey[]).map((key) => (
          <Check
            key={key}
            label={PRICE_RANGES[key].label}
            checked={filters.price === key}
            href={hrefWith(basePath, searchParams, {
              price: filters.price === key ? null : key,
            })}
          />
        ))}
      </Group>
    </div>
  )
}

function Group({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div>
      <p className="label-xs text-faint">{title}</p>
      {/* 行与行之间不留缝：每行自己有 44px 高，靠在一起手指才不会点到空档 */}
      <div className="mt-2">{children}</div>
    </div>
  )
}

function Check({
  label,
  href,
  checked,
  swatch,
}: {
  label: string
  href: string
  checked: boolean
  swatch?: string
}) {
  return (
    <Link href={href} className="group flex min-h-11 items-center gap-2.5 text-sm">
      <span
        aria-hidden
        className={`flex size-4 shrink-0 items-center justify-center border transition-colors ${
          checked ? 'border-ink bg-ink' : 'border-line group-hover:border-ink'
        }`}
      >
        {checked && (
          <svg width="9" height="7" viewBox="0 0 9 7" fill="none">
            <path d="M1 3.4L3.3 5.7L8 1" stroke="#fff" strokeWidth="1.4" />
          </svg>
        )}
      </span>
      {swatch && (
        <span
          aria-hidden
          className="size-3.5 shrink-0 rounded-full border border-line"
          style={{ background: swatch }}
        />
      )}
      <span className={checked ? 'text-ink' : 'text-muted group-hover:text-ink'}>{label}</span>
    </Link>
  )
}
