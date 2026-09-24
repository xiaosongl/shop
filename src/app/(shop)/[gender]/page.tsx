import { notFound, redirect } from 'next/navigation'
import { isGenderSlug } from '@/lib/taxonomy'

type Props = { params: Promise<{ gender: string }> }

/** 旧的性别入口。前台改成按品牌走，这些地址转到品牌墙。 */
export default async function GenderPage({ params }: Props) {
  const { gender } = await params
  if (!isGenderSlug(gender)) notFound()
  redirect('/brands')
}
