import Image from 'next/image'
import Link from 'next/link'
import { formatPrice } from '@/lib/format'
import type { ProductCardData } from '@/lib/queries'

export function ProductCard({
  product,
  priority = false,
  sizes = '(min-width: 1024px) 25vw, (min-width: 768px) 33vw, 50vw',
  list = false,
}: {
  product: ProductCardData
  /** 首屏那几张要立刻加载，否则 LCP 会等在懒加载上 */
  priority?: boolean
  sizes?: string
  /**
   * 手机上排成「图左文右」的一行。平板以上不受影响，还是竖着的卡片。
   * 商品列表页用它；详情页底部的「相关商品」是两列小图，用了会挤成一团。
   */
  list?: boolean
}) {
  const [primary, secondary] = product.images
  const onSale = product.compareAtCents != null && product.compareAtCents > product.priceCents

  return (
    <Link
      href={`/p/${product.slug}`}
      className={list ? 'group flex gap-4 py-5 md:block md:py-0' : 'group block'}
    >
      <div
        className={`relative aspect-3/4 overflow-hidden bg-shell ${
          // 手机上定宽，md 起交回给网格决定宽度
          list ? 'w-32 shrink-0 md:w-auto' : ''
        }`}
      >
        {primary && (
          <Image
            src={primary.url}
            alt={primary.alt}
            fill
            sizes={sizes}
            placeholder="blur"
            blurDataURL={primary.blurDataUrl}
            priority={priority}
            className="object-cover transition-opacity duration-500 ease-out group-hover:opacity-0"
          />
        )}
        {secondary && (
          <Image
            src={secondary.url}
            alt=""
            aria-hidden
            fill
            sizes={sizes}
            className="object-cover opacity-0 transition-opacity duration-500 ease-out group-hover:opacity-100"
          />
        )}
        {onSale && (
          <span className="label-xs absolute top-3 left-3 bg-white px-2 py-1 text-sale">
            Sale
          </span>
        )}
      </div>

      <div className={list ? 'min-w-0 flex-1 md:mt-3' : 'mt-3'}>
        <p className="label-xs text-faint">{product.brand.name}</p>
        <h3 className="mt-1.5 text-sm leading-snug">{product.title}</h3>
        <p className="mt-1 flex items-baseline gap-2 text-sm">
          <span className={onSale ? 'text-sale' : 'text-muted'}>
            {formatPrice(product.priceCents)}
          </span>
          {onSale && (
            <span className="text-xs text-faint line-through">
              {formatPrice(product.compareAtCents!)}
            </span>
          )}
        </p>
      </div>
    </Link>
  )
}
