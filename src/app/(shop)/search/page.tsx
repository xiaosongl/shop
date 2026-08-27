import type { Metadata } from 'next'
import { ImageSearch } from '@/components/image-search'
import { ProductListing } from '@/components/product-listing'
import { parseFilters, type SearchParams } from '@/lib/product-filters'

export const metadata: Metadata = { title: 'Search' }

export default async function SearchPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>
}) {
  const resolved = await searchParams
  const { q } = parseFilters(resolved)

  if (!q) {
    return (
      <div className="mx-auto max-w-7xl px-5 py-24">
        <h1 className="text-3xl font-normal tracking-tight">Search</h1>
        <form action="/search" className="mt-8 max-w-md">
          <input
            name="q"
            type="search"
            autoFocus
            placeholder="What are you looking for?"
            className="w-full border-b border-line bg-transparent pb-3 text-lg outline-none placeholder:text-faint focus:border-ink"
          />
        </form>

        <p className="mt-14 text-sm text-faint">Or find it by picture</p>
        <ImageSearch />
      </div>
    )
  }

  return (
    <ProductListing
      title={`Results for “${q}”`}
      basePath="/search"
      base={{}}
      searchParams={resolved}
    />
  )
}
