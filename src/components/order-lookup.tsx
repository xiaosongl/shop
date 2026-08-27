'use client'

import { useRouter } from 'next/navigation'
import { useState, useTransition } from 'react'
import { findOrder } from '@/lib/actions'
import { RecentOrders } from './recent-orders'

export function OrderLookup() {
  const router = useRouter()
  const [pending, startTransition] = useTransition()
  const [error, setError] = useState<string | null>(null)

  function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const form = Object.fromEntries(new FormData(event.currentTarget))
    setError(null)

    startTransition(async () => {
      const result = await findOrder(form)
      if (result.ok) router.push(`/order/${result.number}`)
      else setError(result.message)
    })
  }

  return (
    <div className="mx-auto max-w-md px-5 py-20">
      <h1 className="text-3xl font-normal tracking-tight md:text-4xl">Track your order</h1>
      <p className="mt-4 text-[15px] leading-relaxed text-muted">
        Enter the order number from your confirmation along with the email you used.
      </p>

      {/* 在同一台设备上下的单可以直接点，比默写单号快得多。没有记录时它什么都不渲染 */}
      <RecentOrders />

      <form onSubmit={onSubmit} className="mt-10 space-y-6">
        <div>
          <label htmlFor="number" className="label-xs text-faint">
            Order number
          </label>
          <input
            id="number"
            name="number"
            required
            placeholder="NS-XXXXXXXXXX"
            className="mt-2 w-full border-b border-line bg-transparent pb-2 text-[15px] outline-none transition-colors placeholder:text-faint focus:border-ink"
          />
        </div>

        <div>
          <label htmlFor="email" className="label-xs text-faint">
            Email
          </label>
          <input
            id="email"
            name="email"
            type="email"
            required
            autoComplete="email"
            className="mt-2 w-full border-b border-line bg-transparent pb-2 text-[15px] outline-none transition-colors focus:border-ink"
          />
        </div>

        {error && <p className="text-sm text-sale">{error}</p>}

        <button
          type="submit"
          disabled={pending}
          className="w-full bg-ink py-3.5 text-sm text-white transition-opacity hover:opacity-85 disabled:opacity-50"
        >
          {pending ? 'Looking…' : 'Find my order'}
        </button>
      </form>
    </div>
  )
}
