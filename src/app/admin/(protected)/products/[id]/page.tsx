import Image from 'next/image'
import Link from 'next/link'
import { notFound } from 'next/navigation'
import { ProductForm } from '@/components/admin/product-form'
import { Badge, Card, STATUS_LABEL } from '@/components/admin/ui'
import { getAdminRole } from '@/lib/admin-auth'
import { db } from '@/lib/db'
import { formatPrice } from '@/lib/format'

type Props = { params: Promise<{ id: string }> }

export default async function EditProduct({ params }: Props) {
  const role = await getAdminRole()
  const { id } = await params

  const [product, brands, categories] = await Promise.all([
    db.product.findUnique({
      where: { id },
      include: {
        brand: { select: { name: true } },
        category: { select: { name: true, nameZh: true } },
        images: { orderBy: { position: 'asc' }, select: { id: true, url: true } },
        variants: {
          orderBy: { sku: 'asc' },
          select: { id: true, sku: true, size: true, color: true, colorHex: true, stock: true },
        },
      },
    }),
    role === 'admin'
      ? db.brand.findMany({ orderBy: { name: 'asc' }, select: { id: true, name: true } })
      : Promise.resolve([]),
    role === 'admin'
      ? db.category.findMany({
          where: { parentId: { not: null } },
          orderBy: { position: 'asc' },
          select: { id: true, name: true, nameZh: true, parent: { select: { nameZh: true } } },
        })
      : Promise.resolve([]),
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
      {role === 'admin' ? (
        <ProductForm product={product} brands={brands} categories={categories} />
      ) : (
        <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_18rem]">
          <div className="space-y-5">
            <Card className="space-y-3 p-5 text-sm">
              <p className="text-muted">{product.description}</p>
              {product.details && (
                <ul className="list-disc space-y-1 pl-5 text-muted">
                  {product.details
                    .split('\n')
                    .filter(Boolean)
                    .map((line) => (
                      <li key={line}>{line}</li>
                    ))}
                </ul>
              )}
            </Card>
            {product.images.length > 0 && (
              <Card className="flex flex-wrap gap-3 p-5">
                {product.images.map((image, index) => (
                  <span key={image.id} className="relative aspect-[4/5] w-24 overflow-hidden bg-shell">
                    <Image src={image.url} alt="" fill sizes="96px" className="object-cover" />
                    {index === 0 && (
                      <span className="absolute top-1 left-1 bg-ink px-1.5 py-0.5 text-[10px] text-white">
                        主图
                      </span>
                    )}
                  </span>
                ))}
              </Card>
            )}
            <Card className="p-5">
              <p className="text-xs text-faint">规格库存</p>
              <ul className="mt-3 space-y-2 text-sm">
                {product.variants.map((variant) => (
                  <li key={variant.id} className="flex justify-between gap-4">
                    <span className="text-muted">
                      {[variant.color, variant.size].filter(Boolean).join(' / ') || '单一规格'}
                    </span>
                    <span className="tabular-nums">{variant.stock}</span>
                  </li>
                ))}
              </ul>
            </Card>
          </div>
          <Card className="space-y-3 p-5 text-sm">
            <p>
              <Badge value={product.status} />
            </p>
            <p className="text-muted">/{product.slug}</p>
            <p>{product.brand.name}</p>
            <p className="text-muted">{product.category.nameZh || product.category.name}</p>
            <p className="text-muted">{STATUS_LABEL[product.gender]}</p>
            <p className="tabular-nums">{formatPrice(product.priceCents)}</p>
            {product.videoUrl && <p className="text-muted">有视频</p>}
          </Card>
        </div>
      )}
    </>
  )
}
