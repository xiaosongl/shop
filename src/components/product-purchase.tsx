'use client'

import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useMemo, useState, useTransition } from 'react'
import { useCart } from '@/lib/cart'
import { formatPrice } from '@/lib/format'
import { DEFAULT_GRADE, GRADE_KEYS, GRADES, gradePrices, inquireGrade, type GradeKey } from '@/lib/grades'
import { inquireLink, type ChatContacts } from '@/lib/payments'

export type PurchaseVariant = {
  id: string
  size: string | null
  color: string | null
  colorHex: string | null
  stock: number
}

export function ProductPurchase({
  variants,
  slug,
  title,
  priceCents,
  compareAtCents,
  contacts,
}: {
  variants: PurchaseVariant[]
  slug: string
  title: string
  priceCents: number
  compareAtCents: number | null
  contacts: ChatContacts
}) {
  const cart = useCart()
  const router = useRouter()
  const [pending, startTransition] = useTransition()
  const prices = gradePrices(priceCents)
  const [grade, setGrade] = useState<GradeKey>(DEFAULT_GRADE)

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

  // 包这类只有一个在售尺码时（几乎全是 OS）不必再点一次。
  // 多码仍要用户自己选，避免默默下错号。
  const inStock = sizes.filter((variant) => variant.stock > 0)
  const resolvedSizeId = sizeId ?? (inStock.length === 1 ? inStock[0].id : null)

  const selected = sizes.length
    ? (sizes.find((variant) => variant.id === resolvedSizeId) ?? null)
    : (variants.find((variant) => (color ? variant.color === color : true)) ?? null)

  const needsSize = sizes.length > 0 && !selected
  const soldOut = selected != null && selected.stock === 0
  const lowStock = selected != null && selected.stock > 0 && selected.stock <= 3
  const inquire = inquireGrade(grade)
  const blocked = !inquire && (needsSize || soldOut)
  const price = prices[grade]
  const onSale = !inquire && grade === 'premium' && compareAtCents != null && compareAtCents > priceCents
  const chat = inquireLink(contacts, title, `/p/${slug}`)

  const onAdd = () => {
    if (inquire || !selected || selected.stock === 0) return
    cart.add(selected.id, 1, grade)
  }

  /**
   * 直接支付：加进购物车再跳结算，不另开一条「只买这一件」的通道。
   * 袋子里已有的东西会一起结掉——对小店来说这比 Shopify 那种
   * 悄悄跳过购物车的语义更好预期，也不用为此多养一套状态。
   */
  const onBuyNow = () => {
    if (!selected || selected.stock === 0) return
    cart.add(selected.id, 1, grade, false)
    startTransition(() => router.push('/checkout'))
  }

  return (
    <div className="mt-8 space-y-7">
      <p className="flex items-baseline gap-3">
        <span className={`text-lg ${onSale ? 'text-sale' : ''}`}>
          {price == null ? 'Contact us' : formatPrice(price)}
        </span>
        {onSale && (
          <span className="text-sm text-faint line-through">{formatPrice(compareAtCents!)}</span>
        )}
      </p>

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

      <div>
        <div className="flex items-baseline justify-between gap-3">
          <p className="label-xs text-faint">Grade</p>
          <Link
            href={`/grades?from=${encodeURIComponent(`/p/${slug}`)}`}
            className="text-xs text-faint underline-offset-2 hover:text-ink hover:underline"
          >
            Compare grades
          </Link>
        </div>
        <div className="mt-3 grid gap-2">
          {GRADE_KEYS.map((key) => {
            const option = GRADES[key]
            const active = grade === key
            return (
              <button
                key={key}
                type="button"
                onClick={() => setGrade(key)}
                aria-pressed={active}
                className={`flex items-baseline justify-between gap-4 border px-3 py-3 text-left transition-colors ${
                  active ? 'border-ink' : 'border-line hover:border-ink'
                }`}
              >
                <span>
                  <span className="block text-sm">{option.label}</span>
                  <span className="mt-0.5 block text-xs text-muted">{option.blurb}</span>
                </span>
                <span className="shrink-0 text-sm tabular-nums">
                  {prices[key] == null ? 'Contact us' : formatPrice(prices[key])}
                </span>
              </button>
            )
          })}
        </div>
      </div>

      {sizes.length > 0 && (
        <div>
          <p className="label-xs text-faint">Size</p>
          {/* auto-fill 网格而不是 flex-wrap：每格宽度一致，窄栏下也不会被压扁 */}
          <div className="mt-3 grid grid-cols-[repeat(auto-fill,minmax(3.5rem,1fr))] gap-2">
            {sizes.map((variant) => {
              const out = variant.stock === 0
              const active = variant.id === resolvedSizeId
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
        {inquire ? (
          chat ? (
            <a
              href={chat}
              target="_blank"
              rel="noreferrer"
              className="label-xs block w-full bg-ink py-4 text-center text-white transition-opacity hover:opacity-85"
            >
              Contact us
            </a>
          ) : (
            <p className="text-center text-sm text-muted">Message us to ask about this bag.</p>
          )
        ) : (
          <>
            <button
              type="button"
              onClick={onAdd}
              disabled={blocked}
              className="label-xs w-full bg-ink py-4 text-white transition-opacity hover:opacity-85 disabled:cursor-not-allowed disabled:bg-line disabled:text-muted"
            >
              {soldOut ? 'Sold out' : needsSize ? 'Select a size' : 'Add to bag'}
            </button>

            <button
              type="button"
              onClick={onBuyNow}
              disabled={blocked || pending}
              className="label-xs mt-2.5 w-full border border-ink py-4 transition-colors hover:bg-ink hover:text-white disabled:cursor-not-allowed disabled:border-line disabled:text-muted disabled:hover:bg-transparent"
            >
              {pending ? 'Taking you to checkout…' : 'Buy it now'}
            </button>
          </>
        )}

        <p className="mt-3 h-4 text-center text-xs text-muted">
          {lowStock && `Only ${selected!.stock} left`}
        </p>
      </div>
    </div>
  )
}
