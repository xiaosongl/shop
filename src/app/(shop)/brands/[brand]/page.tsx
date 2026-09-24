import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import { BrandSubnav } from '@/components/brand-subnav'
import { ProductListing } from '@/components/product-listing'
import type { SearchParams } from '@/lib/product-filters'
import { getBrandCatalog } from '@/lib/queries'

type Props = {
  params: Promise<{ brand: string }>
  searchParams: Promise<SearchParams>
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const page = await getBrandCatalog((await params).brand)
  return { title: page ? page.brand.name : 'Not found' }
}

export default async function BrandCatalogPage({ params, searchParams }: Props) {
  const { brand } = await params
  const page = await getBrandCatalog(brand)
  if (!page) notFound()

  return (
    <>
      <BrandSubnav brand={page.brand} categories={page.categories} />
      <ProductListing
        basePath={`/brands/${page.brand.slug}`}
        base={{ brandId: page.brand.id, status: 'ACTIVE' }}
        searchParams={await searchParams}
      />
    </>
  )
}
