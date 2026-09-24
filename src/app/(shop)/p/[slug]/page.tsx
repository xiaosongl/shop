import type { Metadata } from 'next'
import Link from 'next/link'
import { notFound } from 'next/navigation'
import { ProductCard } from '@/components/product-card'
import { ProductGallery } from '@/components/product-gallery'
import { ProductPurchase } from '@/components/product-purchase'
import { db } from '@/lib/db'
import { formatPrice } from '@/lib/format'
import { productCardArgs } from '@/lib/queries'
import { absoluteUrl } from '@/lib/site'

type Props = { params: Promise<{ slug: string }> }

/*
  显式 select，不能图省事写 include：ProductImage 上挂着图搜用的 CLIP 向量，
  每张定长 2048 字节。include 会把它一并捞出来，然后随 RSC 数据原样发到浏览器
  ——客户端组件的 props 类型窄，运行时的对象却是整行。六张图就是 12KB 白扔。
*/
function getProduct(slug: string) {
  return db.product.findFirst({
    where: { slug, status: 'ACTIVE' },
    select: {
      id: true,
      slug: true,
      title: true,
      description: true,
      details: true,
      priceCents: true,
      compareAtCents: true,
      videoUrl: true,
      gender: true,
      categoryId: true,
      brand: { select: { name: true, slug: true } },
      category: {
        select: { name: true, slug: true, parent: { select: { name: true, slug: true } } },
      },
      images: {
        orderBy: { position: 'asc' },
        select: { url: true, blurDataUrl: true, alt: true, ogUrl: true },
      },
      variants: {
        orderBy: { id: 'asc' },
        select: { id: true, size: true, color: true, colorHex: true, stock: true },
      },
    },
  })
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const product = await getProduct((await params).slug)
  if (!product) return { title: 'Not found' }

  // ogUrl 是入库时压好的 1200×630，控制在 300KB 内——超了 WhatsApp 就不显示预览图
  const image = product.images[0]?.ogUrl
  const title = `${product.brand.name} ${product.title}`
  const description = `${formatPrice(product.priceCents)} — ${product.description}`

  return {
    title: product.title,
    description: product.description,
    openGraph: {
      type: 'website',
      title,
      description,
      url: absoluteUrl(`/p/${product.slug}`),
      images: image ? [{ url: absoluteUrl(image), width: 1200, height: 630 }] : undefined,
    },
    twitter: {
      card: 'summary_large_image',
      title,
      description,
      images: image ? [absoluteUrl(image)] : undefined,
    },
  }
}

export default async function ProductPage({ params }: Props) {
  const { slug } = await params
  const product = await getProduct(slug)
  if (!product) notFound()

  const related = await db.product.findMany({
    where: {
      categoryId: product.categoryId,
      id: { not: product.id },
      status: 'ACTIVE',
    },
    take: 4,
    orderBy: { featured: 'desc' },
    ...productCardArgs,
  })

  const details = product.details?.split('\n').filter(Boolean) ?? []
  const parent = product.category.parent
  const topCategory = parent ?? product.category

  return (
    <div className="mx-auto max-w-7xl px-5 py-6 md:py-10">
      <nav className="label-xs flex flex-wrap items-center gap-2 text-faint">
        <Link href="/brands" className="hover:text-ink">
          Brands
        </Link>
        <span aria-hidden>/</span>
        <Link href={`/brands/${product.brand.slug}`} className="hover:text-ink">
          {product.brand.name}
        </Link>
        <span aria-hidden>/</span>
        <Link
          href={`/brands/${product.brand.slug}/${topCategory.slug}`}
          className="hover:text-ink"
        >
          {topCategory.name}
        </Link>
      </nav>

      {/*
        轨道必须写 minmax(0,...)：裸 fr 等于 minmax(auto,1fr)，auto 下限会让
        画廊那一格撑到内容最小宽度，右栏被挤成一条竖缝。Tailwind 内置的
        grid-cols-N 都自带 minmax(0,1fr)，任意值不会自动加。
        右栏用固定宽度而不是比例：正文有个舒服的阅读宽度，屏幕再宽也不该跟着涨。
      */}
      <div className="mt-6 gap-10 md:grid md:grid-cols-[minmax(0,1fr)_18rem] lg:grid-cols-[minmax(0,1fr)_24rem] lg:gap-16">
        <ProductGallery images={product.images} videoUrl={product.videoUrl} />

        <div className="mt-10 md:mt-0">
          {/* top-28 对齐 sticky 页头的实际高度（公告条 + 导航栏约 97px） */}
          <div className="md:sticky md:top-28">
            <Link
              href={`/brands/${product.brand.slug}`}
              className="label-xs text-faint hover:text-ink"
            >
              {product.brand.name}
            </Link>
            <h1 className="mt-2.5 text-2xl leading-tight font-normal tracking-tight md:text-3xl">
              {product.title}
            </h1>

            <p className="mt-6 text-[15px] leading-relaxed text-muted">{product.description}</p>

            <ProductPurchase
              variants={product.variants}
              slug={product.slug}
              title={product.title}
              priceCents={product.priceCents}
              compareAtCents={product.compareAtCents}
            />

            {/* 原生 details，不用为一个折叠面板引入客户端组件 */}
            <div className="mt-10 border-t border-line">
              {details.length > 0 && (
                <details className="group border-b border-line">
                  <summary className="label-xs flex cursor-pointer list-none items-center justify-between py-4">
                    Details
                    <Chevron />
                  </summary>
                  <ul className="space-y-2 pb-5 text-sm text-muted">
                    {details.map((line) => (
                      <li key={line}>{line}</li>
                    ))}
                  </ul>
                </details>
              )}

              <details className="group border-b border-line">
                <summary className="label-xs flex cursor-pointer list-none items-center justify-between py-4">
                  Shipping &amp; returns
                  <Chevron />
                </summary>
                <div className="space-y-2 pb-5 text-sm leading-relaxed text-muted">
                  <p>Complimentary standard shipping on orders over $150.</p>
                  <p>Free returns within 30 days, unworn with tags attached.</p>
                </div>
              </details>
            </div>
          </div>
        </div>
      </div>

      {related.length > 0 && (
        <section className="mt-24">
          <h2 className="label-xs text-faint">You may also like</h2>
          <div className="mt-6 grid grid-cols-2 gap-x-4 gap-y-10 md:grid-cols-4">
            {related.map((item) => (
              <ProductCard key={item.id} product={item} />
            ))}
          </div>
        </section>
      )}
    </div>
  )
}

function Chevron() {
  return (
    <svg
      width="11"
      height="7"
      viewBox="0 0 11 7"
      fill="none"
      aria-hidden
      className="transition-transform group-open:rotate-180"
    >
      <path d="M1 1l4.5 4.5L10 1" stroke="currentColor" strokeWidth="1.2" />
    </svg>
  )
}
