'use client'

import Image from 'next/image'
import Link from 'next/link'
import { useResolvedCart } from '@/lib/cart'
import { formatPrice } from '@/lib/format'
import type { ResolvedCart } from '@/lib/actions'
import { MAX_QUANTITY } from '@/lib/totals'

export function CartView() {
  const { data, loading, setQuantity, remove } = useResolvedCart()

  if (loading) {
    return (
      <Shell>
        <p className="py-24 text-center text-sm text-muted">Loading your bag…</p>
      </Shell>
    )
  }

  if (!data || data.lines.length === 0) {
    return (
      <Shell>
        <div className="py-24 text-center">
          <p className="text-sm text-muted">Your bag is empty.</p>
          <Link href="/" className="label-xs mt-5 inline-block border-b border-ink pb-0.5">
            Browse brands
          </Link>
        </div>
      </Shell>
    )
  }

  return (
    <Shell>
      <Notices cart={data} />

      <div className="mt-8 lg:grid lg:grid-cols-[minmax(0,1fr)_20rem] lg:gap-16">
        <ul className="divide-y divide-line border-y border-line">
          {data.lines.map((line) => (
            <li key={line.variantId} className="flex gap-5 py-6">
              <Link
                href={`/p/${line.slug}`}
                className="relative aspect-[4/5] w-24 shrink-0 overflow-hidden bg-shell sm:w-28"
              >
                {line.imageUrl && (
                  <Image
                    src={line.imageUrl}
                    alt={line.title}
                    fill
                    placeholder={line.blurDataUrl ? 'blur' : 'empty'}
                    blurDataURL={line.blurDataUrl || undefined}
                    sizes="112px"
                    className="object-cover"
                  />
                )}
              </Link>

              <div className="flex min-w-0 flex-1 flex-col">
                <div className="flex justify-between gap-4">
                  <div className="min-w-0">
                    <p className="label-xs text-faint">{line.brandName}</p>
                    <Link href={`/p/${line.slug}`} className="mt-1 block text-[15px] hover:underline">
                      {line.title}
                    </Link>
                    <p className="mt-1 text-sm text-muted">{line.label}</p>
                  </div>
                  <p className="shrink-0 text-sm tabular-nums">
                    {formatPrice(line.unitPriceCents * line.quantity)}
                  </p>
                </div>

                <div className="mt-auto flex items-center justify-between pt-4">
                  <div className="flex items-center border border-line">
                    <Step
                      label="Decrease quantity"
                      onClick={() => setQuantity(line.variantId, line.quantity - 1)}
                    >
                      −
                    </Step>
                    <span className="w-9 text-center text-sm tabular-nums">{line.quantity}</span>
                    <Step
                      label="Increase quantity"
                      disabled={line.quantity >= Math.min(line.stock, MAX_QUANTITY)}
                      onClick={() => setQuantity(line.variantId, line.quantity + 1)}
                    >
                      +
                    </Step>
                  </div>

                  <button
                    type="button"
                    onClick={() => remove(line.variantId)}
                    className="label-xs text-faint hover:text-ink"
                  >
                    Remove
                  </button>
                </div>

                {line.stock <= 3 && (
                  <p className="mt-2 text-xs text-sale">Only {line.stock} left</p>
                )}
              </div>
            </li>
          ))}
        </ul>

        <aside className="mt-10 lg:mt-0">
          <div className="lg:sticky lg:top-32">
            <Summary cart={data} />
            <Link
              href="/checkout"
              className="mt-6 block bg-ink py-3.5 text-center text-sm text-white transition-opacity hover:opacity-85"
            >
              Checkout
            </Link>
            <p className="mt-4 text-xs leading-relaxed text-faint">
              Choose packaging and payment at checkout.
            </p>
          </div>
        </aside>
      </div>
    </Shell>
  )
}

/** 结算页也要用同一份金额展示，避免两页算法走偏 */
export function Summary({ cart }: { cart: ResolvedCart }) {
  return (
    <div>
      <h2 className="label-xs text-faint">Summary</h2>
      <dl className="mt-5 space-y-3 border-t border-line pt-5 text-sm">
        <Row label="Subtotal" value={formatPrice(cart.subtotalCents)} />
        {cart.discountCents > 0 && (
          <Row
            label="Discreet packaging"
            value={`− ${formatPrice(cart.discountCents)}`}
            accent
          />
        )}
        <Row label="Shipping" value="Included" />
        {cart.taxCents > 0 && <Row label="Tax" value={formatPrice(cart.taxCents)} />}
        <div className="flex justify-between border-t border-line pt-4 text-base">
          <dt>Total</dt>
          <dd className="tabular-nums">{formatPrice(cart.totalCents)}</dd>
        </div>
      </dl>
    </div>
  )
}

function Row({ label, value, accent }: { label: string; value: string; accent?: boolean }) {
  return (
    <div className="flex justify-between">
      <dt className={accent ? 'text-sale' : 'text-muted'}>{label}</dt>
      <dd className={`tabular-nums ${accent ? 'text-sale' : ''}`}>{value}</dd>
    </div>
  )
}

function Notices({ cart }: { cart: ResolvedCart }) {
  if (!cart.removed.length && !cart.clamped.length) return null

  return (
    <div className="mt-8 border border-line bg-shell px-4 py-3 text-sm text-muted">
      {cart.removed.length > 0 && <p>Some items sold out and were removed from your bag.</p>}
      {cart.clamped.length > 0 && <p>Quantities were reduced to match available stock.</p>}
    </div>
  )
}

function Step({
  children,
  label,
  onClick,
  disabled,
}: {
  children: React.ReactNode
  label: string
  onClick: () => void
  disabled?: boolean
}) {
  return (
    <button
      type="button"
      aria-label={label}
      onClick={onClick}
      disabled={disabled}
      className="size-9 text-sm transition-colors hover:bg-shell disabled:cursor-not-allowed disabled:text-faint disabled:hover:bg-transparent"
    >
      {children}
    </button>
  )
}

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <div className="mx-auto max-w-6xl px-5 py-12">
      <h1 className="text-3xl font-normal tracking-tight md:text-4xl">Bag</h1>
      {children}
    </div>
  )
}
