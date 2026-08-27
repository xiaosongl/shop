import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import { BrandSubnav } from '@/components/brand-subnav'
import { ProductListing } from '@/components/product-listing'
import type { SearchParams } from '@/lib/product-filters'
import { categoryScope, getBrandPage } from '@/lib/queries'
import { GENDERS, genderValues } from '@/lib/taxonomy'

type Props = {
  params: Promise<{ gender: string; brand: string; category: string }>
  searchParams: Promise<SearchParams>
}

async function load(params: Awaited<Props['params']>) {
  const [page, scope] = await Promise.all([
    getBrandPage(params.gender, params.brand),
    categoryScope(params.category),
  ])
  // 类别栏只列该品牌该性别真正有货的类别，手敲一个别的 slug 同样应该 404
  if (!page || !scope || !page.categories.some((entry) => entry.slug === params.category)) {
    return null
  }
  return { page, scope }
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const loaded = await load(await params)
  if (!loaded) return { title: 'Not found' }
  const { page, scope } = loaded
  return { title: `${page.brand.name} ${scope.category.name} — ${GENDERS[page.gender].label}` }
}

export default async function BrandCategoryPage({ params, searchParams }: Props) {
  const resolved = await params
  const loaded = await load(resolved)
  if (!loaded) notFound()

  const { page, scope } = loaded

  return (
    <>
      <BrandSubnav
        brand={page.brand}
        genders={page.genders}
        gender={page.gender}
        categories={page.categories}
        category={resolved.category}
      />
      <ProductListing
        basePath={`/${page.gender}/${page.brand.slug}/${resolved.category}`}
        base={{
          brandId: page.brand.id,
          gender: { in: genderValues(page.gender) },
          ...scope.where,
        }}
        searchParams={await searchParams}
      />
    </>
  )
}
