'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import type { GenderSlug } from '@/lib/taxonomy'

/** getBrands() 的返回形状。genders 留给还在按性别过滤的旧查询，导航本身不再用它。 */
export type BrandLink = { slug: string; name: string; genders: GenderSlug[] }

export function SiteNav({ brands }: { brands: BrandLink[] }) {
  const pathname = usePathname()
  const onBrands = pathname === '/brands' || pathname.startsWith('/brands/')

  return (
    <nav className="hidden md:flex md:items-center md:gap-7">
      <Link
        href="/new"
        aria-current={pathname === '/new' ? 'page' : undefined}
        className={`text-sm transition-colors ${pathname === '/new' ? 'text-ink' : 'text-muted hover:text-ink'}`}
      >
        New
      </Link>
      <Link
        href="/brands"
        aria-current={pathname === '/brands' ? 'page' : undefined}
        className={`text-sm transition-colors ${onBrands ? 'text-ink' : 'text-muted hover:text-ink'}`}
      >
        Brands
      </Link>
      <Link
        href="/grades"
        aria-current={pathname === '/grades' ? 'page' : undefined}
        className={`text-sm transition-colors ${pathname === '/grades' ? 'text-ink' : 'text-muted hover:text-ink'}`}
      >
        Grades
      </Link>

      {/* 大菜单纯 CSS 实现，hover 和键盘 focus 都能触发。
          品牌会涨到几十个，用多栏排版而不是单列，免得下拉长到出屏幕。 */}
      <div className="group relative py-5">
        <span className="cursor-default text-sm text-muted group-hover:text-ink">Shop</span>
        <div className="pointer-events-none invisible absolute top-full left-0 w-[42rem] border border-line bg-white p-7 opacity-0 transition-opacity duration-150 group-hover:pointer-events-auto group-hover:visible group-hover:opacity-100 group-focus-within:pointer-events-auto group-focus-within:visible group-focus-within:opacity-100">
          <div className="columns-4 gap-6">
            {brands.map((brand) => (
              <Link
                key={brand.slug}
                href={`/brands/${brand.slug}`}
                className="mb-2.5 block break-inside-avoid text-sm text-muted hover:text-ink"
              >
                {brand.name}
              </Link>
            ))}
          </div>
          <Link
            href="/brands"
            className="label-xs mt-6 inline-block border-t border-line pt-5 text-faint hover:text-ink"
          >
            All {brands.length} brands
          </Link>
        </div>
      </div>
    </nav>
  )
}
