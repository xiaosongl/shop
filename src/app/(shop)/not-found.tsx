import Link from 'next/link'

// 商品/品牌/类别找不到时走这里，保留页头页脚，让访客能直接接着逛
export default function ShopNotFound() {
  return (
    <div className="mx-auto flex max-w-md flex-col items-center px-5 py-28 text-center">
      <p className="label-xs text-faint">404</p>
      <h1 className="mt-3 text-2xl">We couldn’t find that</h1>
      <p className="mt-2 text-sm leading-relaxed text-muted">
        It may have sold out or moved. Browse the current collection instead.
      </p>
      <Link
        href="/brands"
        className="bg-ink px-6 py-3 text-sm text-white transition-opacity hover:opacity-85"
      >
        Shop brands
      </Link>
    </div>
  )
}
