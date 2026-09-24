import type { Metadata } from 'next'
import { ProductListing } from '@/components/product-listing'
import type { SearchParams } from '@/lib/product-filters'

export const metadata: Metadata = {
  title: 'New arrivals',
  description: 'The latest pieces just listed.',
}

export default async function NewArrivalsPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>
}) {
  const params = await searchParams
  return (
    <ProductListing
      title="New arrivals"
      description="Just listed — newest first."
      basePath="/new"
      base={{}}
      searchParams={{ sort: 'new', ...params }}
    />
  )
}
