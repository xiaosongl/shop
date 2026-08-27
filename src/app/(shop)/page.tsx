import Image from 'next/image'
import Link from 'next/link'
import { Rail, RailItem } from '@/components/home-rail'
import { ProductCard } from '@/components/product-card'
import { getGenderBrands, getGenderEntries, getHomeRails, getShowcases } from '@/lib/queries'
import { showcaseText } from '@/lib/showcase'
import { GENDER_SLUGS, type GenderSlug } from '@/lib/taxonomy'

export default async function HomePage() {
  const [genders, showcases, rails, byGender] = await Promise.all([
    getGenderEntries(),
    getShowcases(),
    getHomeRails(),
    Promise.all(GENDER_SLUGS.map((slug) => getGenderBrands(slug))),
  ])
  const home = showcaseText(showcases.home, 'home')
  const siteName = showcaseText(showcases.site, 'site').headline

  // 品牌链接必须落在真有货的性别上，/[性别]/[品牌] 无货就是 404。
  // GENDER_SLUGS 是女在前，所以两边都做的品牌自然指向女装页，
  // 只做男装的也不会被漏掉。件数取的是所指性别的，点进去对得上。
  const brands = new Map<string, (typeof byGender)[number][number] & { gender: GenderSlug }>()
  for (const [index, list] of byGender.entries()) {
    for (const brand of list) {
      if (!brands.has(brand.slug)) brands.set(brand.slug, { ...brand, gender: GENDER_SLUGS[index] })
    }
  }

  return (
    <div className="mx-auto max-w-7xl px-5">
      {/* 选性别是进站第一件事，图放在最上面，标题退到图下面当注脚。
          手机上并排两格：竖着排一格就占满一屏，第二个性别永远在折线以下 */}
      <div className="grid grid-cols-2 gap-3 pt-5 md:gap-6 md:pt-8">
        {genders.map((entry) => (
          <Link key={entry.slug} href={`/${entry.slug}`} className="group block">
            <div className="relative aspect-3/4 overflow-hidden bg-shell">
              {entry.image && (
                <Image
                  src={entry.image.url}
                  alt={entry.label}
                  fill
                  // 后台传的图理论上都带 blur，但空串会让 next/image 直接抛
                  placeholder={entry.image.blurDataUrl ? 'blur' : 'empty'}
                  blurDataURL={entry.image.blurDataUrl || undefined}
                  // 统共就两张，又都在首屏，一起优先加载
                  priority
                  sizes="(min-width: 768px) 48vw, 46vw"
                  className="object-cover transition-transform duration-700 group-hover:scale-[1.03]"
                />
              )}
            </div>

            {/* 字放在图下面，不压在图上。兜底封面用的是商品图，大多是白底，
                压字就得加深色渐变，那层灰蒙在白底上像是图没加载好 */}
            <div className="mt-3 flex items-baseline justify-between gap-2 md:mt-5">
              <h2 className="text-lg tracking-tight md:text-3xl">{entry.label}</h2>
              <span className="shrink-0 text-[11px] text-faint md:text-xs">
                {entry.count} items
              </span>
            </div>
          </Link>
        ))}
      </div>

      {/* 居中：上面两个入口本来就是左右对称的两格，标题靠左会把整屏的重心拽偏。
          只给上边距，下面的间距由 Rail 自带的 pt 出，否则两段留白叠起来是个大洞 */}
      <section className="pt-12 text-center md:pt-20">
        <p className="label-xs text-faint">{siteName}</p>
        <h1 className="mx-auto mt-4 max-w-3xl text-3xl leading-[1.1] font-normal tracking-tight md:mt-5 md:text-5xl">
          {home.headline}
        </h1>
        {home.subhead && (
          <p className="mx-auto mt-4 max-w-xl text-sm leading-relaxed text-muted md:mt-6 md:text-[15px]">
            {home.subhead}
          </p>
        )}
      </section>

      {rails.sale.length > 0 && (
        <Rail title="On sale" note={`${rails.sale.length} reduced`}>
          {rails.sale.map((product) => (
            <RailItem key={product.id}>
              <ProductCard product={product} sizes="(min-width: 768px) 230px, 42vw" />
            </RailItem>
          ))}
        </Rail>
      )}

      {rails.picks.length > 0 && (
        <Rail title="Featured">
          {rails.picks.map((product) => (
            <RailItem key={product.id}>
              <ProductCard product={product} sizes="(min-width: 768px) 230px, 42vw" />
            </RailItem>
          ))}
        </Rail>
      )}

      {brands.size > 0 && (
        <Rail title="Brands">
          {[...brands.values()].map((brand) => (
            <RailItem key={brand.slug}>
              <Link href={`/${brand.gender}/${brand.slug}`} className="group block">
                <div className="relative aspect-square overflow-hidden bg-shell">
                  {brand.image && (
                    <Image
                      src={brand.image.url}
                      alt={brand.name}
                      fill
                      placeholder={brand.image.blurDataUrl ? 'blur' : 'empty'}
                      blurDataURL={brand.image.blurDataUrl || undefined}
                      sizes="(min-width: 768px) 230px, 42vw"
                      className="object-cover transition-transform duration-700 group-hover:scale-[1.03]"
                    />
                  )}
                </div>
                <p className="mt-2.5 text-sm">{brand.name}</p>
                <p className="text-[11px] text-faint">{brand.count} items</p>
              </Link>
            </RailItem>
          ))}
        </Rail>
      )}

      <div className="pb-16 md:pb-20" />
    </div>
  )
}
