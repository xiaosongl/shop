import { notFound, redirect } from 'next/navigation'
import { isGenderSlug } from '@/lib/taxonomy'

type Props = { params: Promise<{ gender: string; brand: string }> }

export default async function LegacyBrandPage({ params }: Props) {
  const { gender, brand } = await params
  if (!isGenderSlug(gender)) notFound()
  redirect(`/brands/${brand}`)
}
