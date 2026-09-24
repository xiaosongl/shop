import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import { BrandSubnav } from '@/components/brand-subnav'
import { ProductListing } from '@/components/product-listing'
import type { SearchParams } from '@/lib/product-filters'
import { categoryScope, getBrandCatalog } from '@/lib/queries'

type Props = {
  params: Promise<{ brand: string; category: string }>
  searchParams: Promise<SearchParams>
}

async function load(params: Awaited<Props['params']>) {
  const [page, scope] = await Promise.all([
    getBrandCatalog(params.brand),
    categoryScope(params.category),
  ])
  if (!page || !scope || !page.categories.some((entry) => entry.slug === params.category)) {
    return null
  }
  return { page, scope }
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const loaded = await load(await params)
  if (!loaded) return { title: 'Not found' }
  return { title: `${loaded.page.brand.name} ${loaded.scope.category.name}` }
}

export default async function BrandCategoryPage({ params, searchParams }: Props) {
  const resolved = await params
  const loaded = await load(resolved)
  if (!loaded) notFound()

  const { page, scope } = loaded

  return (
    <>
      <BrandSubnav brand={page.brand} categories={page.categories} category={resolved.category} />
      <ProductListing
        basePath={`/brands/${page.brand.slug}/${resolved.category}`}
        base={{ brandId: page.brand.id, status: 'ACTIVE', ...scope.where }}
        searchParams={await searchParams}
      />
    </>
  )
}
