'use client'

import { useRouter } from 'next/navigation'
import { useMemo, useState, useTransition } from 'react'
import { useCart } from '@/lib/cart'

export type PurchaseVariant = {
  id: string
  size: string | null
  color: string | null
  colorHex: string | null
  stock: number
}

export function ProductPurchase({ variants }: { variants: PurchaseVariant[] }) {
  const cart = useCart()
  const router = useRouter()
  const [pending, startTransition] = useTransition()

  const colors = useMemo(() => {
    const map = new Map<string, string>()
    for (const variant of variants) {
      if (variant.color && !map.has(variant.color)) map.set(variant.color, variant.colorHex ?? '#ccc')
    }
    return [...map].map(([name, hex]) => ({ name, hex }))
  }, [variants])

  const [color, setColor] = useState<string | null>(colors[0]?.name ?? null)

  // 尺码是跟着颜色走的：同一件衣服黑色可能断了 M 码，米色还有
  const sizes = useMemo(
    () =>
      variants
        .filter((variant) => (color ? variant.color === color : true))
        .filter((variant) => variant.size !== null),
    [variants, color],
  )

  const [sizeId, setSizeId] = useState<string | null>(null)
  const [added, setAdded] = useState(false)

  const selected = sizes.length
    ? (sizes.find((variant) => variant.id === sizeId) ?? null)
    : (variants.find((variant) => (color ? variant.color === color : true)) ?? null)

  const needsSize = sizes.length > 0 && !selected
  const soldOut = selected != null && selected.stock === 0
  const lowStock = selected != null && selected.stock > 0 && selected.stock <= 3
  const blocked = needsSize || soldOut

  const onAdd = () => {
    if (!selected || selected.stock === 0) return
    cart.add(selected.id)
    setAdded(true)
    window.setTimeout(() => setAdded(false), 2000)
  }

  /**
   * 直接支付：加进购物车再跳结算，不另开一条「只买这一件」的通道。
   * 袋子里已有的东西会一起结掉——对小店来说这比 Shopify 那种
   * 悄悄跳过购物车的语义更好预期，也不用为此多养一套状态。
   */
  const onBuyNow = () => {
    if (!selected || selected.stock === 0) return
    cart.add(selected.id)
    startTransition(() => router.push('/checkout'))
  }

  return (
    <div className="mt-8 space-y-7">
      {colors.length > 0 && (
        <div>
          <p className="label-xs text-faint">
            Color<span className="ml-2 tracking-normal normal-case text-ink">{color}</span>
          </p>
          <div className="mt-3 flex flex-wrap gap-2.5">
            {colors.map((option) => (
              <button
                key={option.name}
                type="button"
                onClick={() => {
                  setColor(option.name)
                  setSizeId(null)
                }}
                aria-label={option.name}
                aria-pressed={color === option.name}
                className={`size-8 rounded-full border-2 transition-colors ${
                  color === option.name ? 'border-ink' : 'border-transparent hover:border-line'
                }`}
              >
                <span
                  className="block size-full rounded-full border border-line"
                  style={{ background: option.hex }}
                />
              </button>
            ))}
          </div>
        </div>
      )}

      {sizes.length > 0 && (
        <div>
          <p className="label-xs text-faint">Size</p>
          {/* auto-fill 网格而不是 flex-wrap：每格宽度一致，窄栏下也不会被压扁 */}
          <div className="mt-3 grid grid-cols-[repeat(auto-fill,minmax(3.5rem,1fr))] gap-2">
            {sizes.map((variant) => {
              const out = variant.stock === 0
              const active = variant.id === sizeId
              return (
                <button
                  key={variant.id}
                  type="button"
                  disabled={out}
                  onClick={() => setSizeId(variant.id)}
                  className={`border px-3 py-2.5 text-sm transition-colors ${
                    active
                      ? 'border-ink bg-ink text-white'
                      : out
                        ? 'cursor-not-allowed border-line text-faint line-through'
                        : 'border-line hover:border-ink'
                  }`}
                >
                  {variant.size}
                </button>
              )
            })}
          </div>
        </div>
      )}

      <div>
        <button
          type="button"
          onClick={onAdd}
          disabled={blocked}
          className="label-xs w-full bg-ink py-4 text-white transition-opacity hover:opacity-85 disabled:cursor-not-allowed disabled:bg-line disabled:text-muted"
        >
          {added ? 'Added to bag' : soldOut ? 'Sold out' : needsSize ? 'Select a size' : 'Add to bag'}
        </button>

        <button
          type="button"
          onClick={onBuyNow}
          disabled={blocked || pending}
          className="label-xs mt-2.5 w-full border border-ink py-4 transition-colors hover:bg-ink hover:text-white disabled:cursor-not-allowed disabled:border-line disabled:text-muted disabled:hover:bg-transparent"
        >
          {pending ? 'Taking you to checkout…' : 'Buy it now'}
        </button>

        <p className="mt-3 h-4 text-center text-xs text-muted">
          {lowStock && `Only ${selected!.stock} left`}
        </p>
      </div>
    </div>
  )
}
