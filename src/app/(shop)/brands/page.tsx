import type { Metadata } from 'next'
import Image from 'next/image'
import Link from 'next/link'
import { getBrandIndex } from '@/lib/queries'

export const metadata: Metadata = { title: 'Brands' }

export default async function BrandsPage() {
  const brands = await getBrandIndex()

  return (
    <div className="mx-auto max-w-7xl px-5">
      <header className="border-b border-line py-12 md:py-16">
        <nav aria-label="Breadcrumb" className="label-xs flex items-center gap-2 text-faint">
          <Link href="/" className="hover:text-ink">
            Home
          </Link>
          <span aria-hidden>/</span>
          <span className="text-ink">Brands</span>
        </nav>
        <h1 className="mt-5 text-3xl font-normal tracking-tight md:text-5xl">Brands</h1>
        <p className="mt-4 text-[15px] text-muted">{brands.length} brands</p>
      </header>

      <section className="py-14">
        <div className="grid grid-cols-2 gap-x-4 gap-y-12 md:grid-cols-3 lg:grid-cols-4">
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
                    sizes="(min-width: 1024px) 23vw, (min-width: 768px) 31vw, 47vw"
                    className="object-cover transition-transform duration-700 group-hover:scale-[1.03]"
                  />
                )}
              </div>
              <div className="mt-4 flex items-baseline justify-between gap-3">
                <h2 className="text-[15px] tracking-tight">{brand.name}</h2>
                <span className="shrink-0 text-xs text-faint">{brand.count}</span>
              </div>
              {brand.description && (
                <p className="mt-1.5 line-clamp-2 text-sm leading-relaxed text-muted">
                  {brand.description}
                </p>
              )}
            </Link>
          ))}
        </div>
      </section>
    </div>
  )
}
