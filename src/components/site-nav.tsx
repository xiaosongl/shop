'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { GENDERS, GENDER_SLUGS, isGenderSlug, type GenderSlug } from '@/lib/taxonomy'

/** getBrands() 的返回形状。genders 是这个品牌真正有货的性别，导航靠它避开死链。 */
export type BrandLink = { slug: string; name: string; genders: GenderSlug[] }

/**
 * 导航要知道当前在男装还是女装，才能把品牌链接指到对的分支。
 * 不在性别路由下时（购物车、结算这些）退回 men，这只是个链接落点，点进去是有效页面。
 */
export function useCurrentGender(): GenderSlug {
  const pathname = usePathname()
  const first = pathname.split('/')[1] ?? ''
  return isGenderSlug(first) ? first : GENDER_SLUGS[0]
}

export function SiteNav({ brands }: { brands: BrandLink[] }) {
  const gender = useCurrentGender()
  const pathname = usePathname()
  // 这个性别没货的品牌点进去是 404，菜单里就别列
  const listed = brands.filter((brand) => brand.genders.includes(gender))

  return (
    <nav className="hidden md:flex md:items-center md:gap-7">
      {GENDER_SLUGS.map((slug) => (
        <Link
          key={slug}
          href={`/${slug}`}
          aria-current={pathname.startsWith(`/${slug}`) ? 'page' : undefined}
          className={`text-sm transition-colors ${
            pathname.startsWith(`/${slug}`) ? 'text-ink' : 'text-muted hover:text-ink'
          }`}
        >
          {GENDERS[slug].label}
        </Link>
      ))}

      {/* 大菜单纯 CSS 实现，hover 和键盘 focus 都能触发。
          品牌会涨到几十个，用多栏排版而不是单列，免得下拉长到出屏幕。 */}
      <div className="group relative py-5">
        <span className="cursor-default text-sm text-muted group-hover:text-ink">Brands</span>
        <div className="pointer-events-none invisible absolute top-full left-0 w-[42rem] border border-line bg-white p-7 opacity-0 transition-opacity duration-150 group-hover:pointer-events-auto group-hover:visible group-hover:opacity-100 group-focus-within:pointer-events-auto group-focus-within:visible group-focus-within:opacity-100">
          <p className="label-xs mb-5 text-faint">{GENDERS[gender].label}</p>
          <div className="columns-4 gap-6">
            {listed.map((brand) => (
              <Link
                key={brand.slug}
                href={`/${gender}/${brand.slug}`}
                className="mb-2.5 block break-inside-avoid text-sm text-muted hover:text-ink"
              >
                {brand.name}
              </Link>
            ))}
          </div>
          <Link
            href={`/${gender}`}
            className="label-xs mt-6 inline-block border-t border-line pt-5 text-faint hover:text-ink"
          >
            All {listed.length} brands
          </Link>
        </div>
      </div>
    </nav>
  )
}
