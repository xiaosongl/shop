'use client'

import Image from 'next/image'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { useEffect, useRef, useState } from 'react'
import { useCart, useResolvedCart } from '@/lib/cart'
import { formatPrice } from '@/lib/format'
import { MAX_QUANTITY } from '@/lib/totals'

export function CartDrawer() {
  const { drawerOpen, closeCart } = useCart()
  const pathname = usePathname()
  const [mounted, setMounted] = useState(false)
  const [shown, setShown] = useState(false)

  useEffect(() => {
    closeCart()
  }, [pathname, closeCart])

  useEffect(() => {
    if (drawerOpen) {
      setMounted(true)
      const frame = requestAnimationFrame(() => setShown(true))
      return () => cancelAnimationFrame(frame)
    }
    setShown(false)
    const timer = window.setTimeout(() => setMounted(false), 300)
    return () => window.clearTimeout(timer)
  }, [drawerOpen])

  if (!mounted) return null
  return <Panel shown={shown} />
}

function Panel({ shown }: { shown: boolean }) {
  const { closeCart } = useCart()
  const { data, loading, setQuantity, remove } = useResolvedCart()
  const closeRef = useRef<HTMLButtonElement>(null)

  useEffect(() => {
    const previous = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    closeRef.current?.focus()
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') closeCart()
    }
    window.addEventListener('keydown', onKey)
    return () => {
      document.body.style.overflow = previous
      window.removeEventListener('keydown', onKey)
    }
  }, [closeCart])

  const empty = !loading && (!data || data.lines.length === 0)

  return (
    <div className={`fixed inset-0 z-50 ${shown ? '' : 'pointer-events-none'}`}>
      <button
        type="button"
        aria-label="Close bag"
        onClick={closeCart}
        className={`absolute inset-0 bg-ink/20 transition-opacity duration-300 ${
          shown ? 'opacity-100' : 'opacity-0'
        }`}
      />

      <aside
        role="dialog"
        aria-modal
        aria-labelledby="cart-drawer-title"
        className={`absolute inset-y-0 right-0 flex w-full max-w-md flex-col bg-white shadow-[-16px_0_40px_rgba(0,0,0,0.06)] transition-transform duration-300 ease-out ${
          shown ? 'translate-x-0' : 'translate-x-full'
        }`}
      >
        <div className="flex h-14 shrink-0 items-center justify-between border-b border-line px-5">
          <h2 id="cart-drawer-title" className="text-sm">
            Bag{data && data.lines.length > 0 ? ` (${data.lines.reduce((sum, line) => sum + line.quantity, 0)})` : ''}
          </h2>
          <button
            ref={closeRef}
            type="button"
            onClick={closeCart}
            aria-label="Close bag"
            className="-mr-2 p-2"
          >
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden>
              <path d="M1 1l14 14M15 1L1 15" stroke="currentColor" strokeWidth="1.25" />
            </svg>
          </button>
        </div>

        {loading ? (
          <p className="flex-1 px-5 py-16 text-center text-sm text-muted">Loading your bag…</p>
        ) : empty ? (
          <div className="flex flex-1 flex-col items-center justify-center px-5 text-center">
            <p className="text-sm text-muted">Your bag is empty.</p>
            <button
              type="button"
              onClick={closeCart}
              className="label-xs mt-5 border-b border-ink pb-0.5"
            >
              Continue shopping
            </button>
          </div>
        ) : (
          <>
            {(data.removed.length > 0 || data.clamped.length > 0) && (
              <p className="border-b border-line bg-shell px-5 py-3 text-xs text-muted">
                {data.removed.length > 0
                  ? 'Some items sold out and were removed.'
                  : 'Quantities were reduced to match stock.'}
              </p>
            )}

            <ul className="flex-1 overflow-y-auto px-5">
              {data.lines.map((line) => (
                <li key={line.key} className="flex gap-4 border-b border-line py-5">
                  <Link
                    href={`/p/${line.slug}`}
                    className="relative aspect-3/4 w-20 shrink-0 overflow-hidden bg-shell"
                  >
                    {line.imageUrl && (
                      <Image
                        src={line.imageUrl}
                        alt={line.title}
                        fill
                        placeholder={line.blurDataUrl ? 'blur' : 'empty'}
                        blurDataURL={line.blurDataUrl || undefined}
                        sizes="80px"
                        className="object-cover"
                      />
                    )}
                  </Link>

                  <div className="flex min-w-0 flex-1 flex-col">
                    <div className="flex justify-between gap-3">
                      <div className="min-w-0">
                        <p className="label-xs text-faint">{line.brandName}</p>
                        <Link href={`/p/${line.slug}`} className="mt-1 block text-sm hover:underline">
                          {line.title}
                        </Link>
                        <p className="mt-1 text-xs text-muted">{line.label}</p>
                      </div>
                      <p className="shrink-0 text-sm tabular-nums">
                        {formatPrice(line.unitPriceCents * line.quantity)}
                      </p>
                    </div>

                    <div className="mt-auto flex items-center justify-between pt-3">
                      <div className="flex items-center border border-line">
                        <button
                          type="button"
                          aria-label="Decrease quantity"
                          onClick={() => setQuantity(line.key, line.quantity - 1)}
                          className="size-8 text-sm hover:bg-shell"
                        >
                          −
                        </button>
                        <span className="w-7 text-center text-sm tabular-nums">{line.quantity}</span>
                        <button
                          type="button"
                          aria-label="Increase quantity"
                          disabled={line.quantity >= Math.min(line.stock, MAX_QUANTITY)}
                          onClick={() => setQuantity(line.key, line.quantity + 1)}
                          className="size-8 text-sm hover:bg-shell disabled:cursor-not-allowed disabled:text-faint"
                        >
                          +
                        </button>
                      </div>
                      <button
                        type="button"
                        onClick={() => remove(line.key)}
                        className="label-xs text-faint hover:text-ink"
                      >
                        Remove
                      </button>
                    </div>
                  </div>
                </li>
              ))}
            </ul>

            <div className="shrink-0 border-t border-line px-5 pt-5 pb-[max(1.25rem,env(safe-area-inset-bottom))]">
              <div className="flex justify-between text-sm">
                <span>Subtotal</span>
                <span className="tabular-nums">{formatPrice(data.subtotalCents)}</span>
              </div>
              <p className="mt-2 text-xs text-faint">Shipping and payment on the next step.</p>
              <Link
                href="/checkout"
                className="mt-5 block bg-ink py-3.5 text-center text-sm text-white transition-opacity hover:opacity-85"
              >
                Checkout
              </Link>
              <Link
                href="/cart"
                className="label-xs mt-4 block text-center text-faint hover:text-ink"
              >
                View bag
              </Link>
            </div>
          </>
        )}
      </aside>
    </div>
  )
}
