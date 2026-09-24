import Image from 'next/image'
import Link from 'next/link'
import { Rail, RailItem } from '@/components/home-rail'
import { ProductCard } from '@/components/product-card'
import { getBrandIndex, getHomeRails, getShowcases } from '@/lib/queries'
import { showcaseText } from '@/lib/showcase'

export default async function HomePage() {
  const [brands, showcases, rails] = await Promise.all([
    getBrandIndex(),
    getShowcases(),
    getHomeRails(),
  ])
  const home = showcaseText(showcases.home, 'home')
  const siteName = showcaseText(showcases.site, 'site').headline

  return (
    <div className="mx-auto max-w-7xl px-5">
      <section className="pt-12 text-center md:pt-16">
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

      {brands.length > 0 && (
        <section className="pt-12 md:pt-16">
          <h2 className="label-xs text-faint">Brands</h2>
          <div className="mt-6 grid grid-cols-2 gap-x-4 gap-y-10 md:grid-cols-4">
            {brands.map((brand, index) => (
              <Link key={brand.slug} href={`/brands/${brand.slug}`} className="group block">
                <div className="relative aspect-[4/5] overflow-hidden bg-shell">
                  {brand.image && (
                    <Image
                      src={brand.image.url}
                      alt={brand.name}
                      fill
                      placeholder={brand.image.blurDataUrl ? 'blur' : 'empty'}
                      blurDataURL={brand.image.blurDataUrl || undefined}
                      priority={index < 4}
                      sizes="(min-width: 768px) 23vw, 47vw"
                      className="object-cover transition-transform duration-700 group-hover:scale-[1.03]"
                    />
                  )}
                </div>
                <div className="mt-3 flex items-baseline justify-between gap-2">
                  <h3 className="text-[15px] tracking-tight">{brand.name}</h3>
                  <span className="shrink-0 text-xs text-faint">{brand.count}</span>
                </div>
              </Link>
            ))}
          </div>
        </section>
      )}

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

      <div className="pb-16 md:pb-20" />
    </div>
  )
}
