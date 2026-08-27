import Link from 'next/link'
import { notFound } from 'next/navigation'
import { ProductForm } from '@/components/admin/product-form'
import { db } from '@/lib/db'

type Props = { params: Promise<{ id: string }> }

export default async function EditProduct({ params }: Props) {
  const { id } = await params

  const [product, brands, categories] = await Promise.all([
    db.product.findUnique({
      where: { id },
      include: {
        images: { orderBy: { position: 'asc' }, select: { id: true, url: true } },
        variants: {
          orderBy: { sku: 'asc' },
          select: { id: true, sku: true, size: true, color: true, colorHex: true, stock: true },
        },
      },
    }),
    db.brand.findMany({ orderBy: { name: 'asc' }, select: { id: true, name: true } }),
    db.category.findMany({
      where: { parentId: { not: null } },
      orderBy: { position: 'asc' },
      select: { id: true, name: true, nameZh: true, parent: { select: { nameZh: true } } },
    }),
  ])
  if (!product) notFound()

  return (
    <>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <Link href="/admin/products" className="text-xs text-faint hover:text-ink">
          ← 返回商品列表
        </Link>
        {product.status === 'ACTIVE' && (
          <Link
            href={`/p/${product.slug}`}
            target="_blank"
            className="text-xs text-faint hover:text-ink"
          >
            在前台查看 ↗
          </Link>
        )}
      </div>

      <h1 className="mt-4 mb-6 text-xl">{product.title}</h1>
      <ProductForm product={product} brands={brands} categories={categories} />
    </>
  )
}
