import type { Metadata } from 'next'
import Image from 'next/image'
import Link from 'next/link'
import { notFound } from 'next/navigation'
import { BrandSubnav } from '@/components/brand-subnav'
import { getBrandPage } from '@/lib/queries'
import { GENDERS } from '@/lib/taxonomy'

type Props = { params: Promise<{ gender: string; brand: string }> }

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { gender, brand } = await params
  const page = await getBrandPage(gender, brand)
  if (!page) return { title: 'Not found' }
  return { title: `${page.brand.name} — ${GENDERS[page.gender].label}` }
}

export default async function BrandPage({ params }: Props) {
  const { gender, brand } = await params
  const page = await getBrandPage(gender, brand)
  if (!page) notFound()

  return (
    <>
      <BrandSubnav brand={page.brand} genders={page.genders} gender={page.gender} />

      <div className="mx-auto max-w-7xl px-5 py-14">
        <h2 className="label-xs text-faint">Categories</h2>
        <div className="mt-6 grid grid-cols-2 gap-x-4 gap-y-10 md:grid-cols-4">
          {page.categories.map((category, index) => (
            <Link
              key={category.slug}
              href={`/${page.gender}/${page.brand.slug}/${category.slug}`}
              className="group block"
            >
              <div className="relative aspect-[4/5] overflow-hidden bg-shell">
                {category.image && (
                  <Image
                    src={category.image.url}
                    alt={category.name}
                    fill
                    placeholder="blur"
                    blurDataURL={category.image.blurDataUrl}
                    priority={index < 4}
                    sizes="(min-width: 768px) 23vw, 47vw"
                    className="object-cover transition-transform duration-700 group-hover:scale-[1.03]"
                  />
                )}
              </div>
              <div className="mt-4 flex items-baseline justify-between gap-3">
                <h3 className="text-[15px] tracking-tight">{category.name}</h3>
                <span className="shrink-0 text-xs text-faint">{category.count}</span>
              </div>
            </Link>
          ))}
        </div>
      </div>
    </>
  )
}
