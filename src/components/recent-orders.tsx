'use client'

import Link from 'next/link'
import { useEffect, useState } from 'react'
import {
  forgetOrders,
  readRecentOrders,
  ORDER_MEMORY_DAYS,
  type RecentOrder,
} from '@/lib/recent-orders'

const day = new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric' })

/**
 * 这台设备上下过的单，直接点进去，不用再默写单号加邮箱。
 * 订单号本身就是访问凭据（40 位随机），所以这里可以直连订单页。
 */
export function RecentOrders() {
  // null 表示还没读——localStorage 只有客户端有，先渲染成空再补，避免水合不一致
  const [orders, setOrders] = useState<RecentOrder[] | null>(null)

  useEffect(() => setOrders(readRecentOrders()), [])

  if (!orders?.length) return null

  return (
    <section className="mt-10">
      <div className="flex items-baseline justify-between gap-3">
        <h2 className="label-xs text-faint">On this device</h2>
        <button
          type="button"
          onClick={() => {
            forgetOrders()
            setOrders([])
          }}
          className="label-xs text-faint transition-colors hover:text-ink"
        >
          Clear
        </button>
      </div>

      <ul className="mt-2 divide-y divide-line border-y border-line">
        {orders.map((order) => (
          <li key={order.number}>
            <Link
              href={`/order/${order.number}`}
              className="flex min-h-14 items-center justify-between gap-4 py-3"
            >
              <span className="font-mono text-sm tracking-wide">{order.number}</span>
              <span className="shrink-0 text-xs text-faint">{day.format(order.savedAt)}</span>
            </Link>
          </li>
        ))}
      </ul>

      <p className="mt-3 text-xs text-faint">
        Kept for {ORDER_MEMORY_DAYS} days after you last opened them. Clearing your browser data
        removes them, so keep your order number somewhere else too.
      </p>
    </section>
  )
}
