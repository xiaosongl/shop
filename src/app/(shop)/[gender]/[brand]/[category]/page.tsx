import { notFound, redirect } from 'next/navigation'
import { isGenderSlug } from '@/lib/taxonomy'

type Props = { params: Promise<{ gender: string; brand: string; category: string }> }

export default async function LegacyBrandCategoryPage({ params }: Props) {
  const { gender, brand, category } = await params
  if (!isGenderSlug(gender)) notFound()
  redirect(`/brands/${brand}/${category}`)
}
