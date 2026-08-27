'use client'

import Link from 'next/link'
import { useCart } from '@/lib/cart'

export function CartLink() {
  const { count, ready } = useCart()

  return (
    // 手机端购物车在底部导航里，还带角标，这里再来一个就是同屏重复
    <Link href="/cart" className="hidden min-h-11 items-center text-sm md:flex">
      Cart
      {/* 数量要等 localStorage 读完再显示，否则服务端渲染的 0 和客户端不一致会告警 */}
      <span className="ml-1 tabular-nums">{ready && count > 0 ? `(${count})` : ''}</span>
    </Link>
  )
}
