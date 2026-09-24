'use client'

import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useState, useTransition, type FormEvent, type ReactNode } from 'react'
import { placeOrder } from '@/lib/actions'
import { useResolvedCart } from '@/lib/cart'
import { formatPrice } from '@/lib/format'
import { PAYMENT_METHODS, type PaymentMethod } from '@/lib/payments'
import { SHIPPING_METHODS, SHIPPING_METHOD_KEYS, type ShippingMethod } from '@/lib/totals'
import { Summary } from './cart-view'

/** 前台只需要知道每个币的展示名和链，地址留在服务端 */
export type AssetChoice = {
  key: string
  coin: string
  networkLabel: string
  pegged: boolean
}

function emailLooksOk(value: string) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.trim())
}

export function CheckoutForm({
  assets,
  whatsappReady,
}: {
  assets: AssetChoice[]
  whatsappReady: boolean
}) {
  const router = useRouter()
  const [shipping, setShipping] = useState<ShippingMethod>('boxed')
  const { data, loading, lines, clear } = useResolvedCart(shipping)
  const [pending, startTransition] = useTransition()
  const [placed, setPlaced] = useState(false)
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [message, setMessage] = useState<string | null>(null)
  const [step, setStep] = useState(1)
  const [reached, setReached] = useState(1)

  const [email, setEmail] = useState('')
  const [phone, setPhone] = useState('')
  const [name, setName] = useState('')
  const [line1, setLine1] = useState('')
  const [line2, setLine2] = useState('')
  const [city, setCity] = useState('')
  const [state, setState] = useState('')
  const [postalCode, setPostalCode] = useState('')
  const [country, setCountry] = useState('United States')

  // 没配币种就不露出 crypto 这一项，免得用户选了却走不下去
  const payable = (Object.keys(PAYMENT_METHODS) as PaymentMethod[]).filter((key) =>
    key === 'crypto' ? assets.length > 0 : whatsappReady,
  )
  const [method, setMethod] = useState<PaymentMethod>(payable[0] ?? 'crypto')
  const [coin, setCoin] = useState(assets[0]?.key ?? '')

  const contactDone = emailLooksOk(email)
  const addressDone = [name, line1, city, state, postalCode, country].every((value) => value.trim())
  const paymentDone = payable.length > 0 && (method !== 'crypto' || Boolean(coin))
  const complete = contactDone && addressDone && paymentDone && reached >= 4

  function openStep(next: number) {
    if (next <= reached) setStep(next)
  }

  function goNext() {
    if (step === 1 && !contactDone) return
    if (step === 2 && !addressDone) return
    const next = Math.min(4, step + 1)
    setReached((current) => Math.max(current, next))
    setStep(next)
  }

  function jumpToErrors(fieldErrors: Record<string, string>) {
    if (fieldErrors.email) {
      setStep(1)
      return
    }
    if (fieldErrors.name || fieldErrors.line1 || fieldErrors.city || fieldErrors.state || fieldErrors.postalCode || fieldErrors.country) {
      setStep(2)
      return
    }
    setStep(4)
    setReached(4)
  }

  // 下单成功后购物车会被清空，这里要挡住「购物车为空」那一屏，直到跳转完成
  if (loading || placed) {
    return (
      <Shell>
        <p className="py-24 text-center text-sm text-muted">
          {placed ? 'Placing your order…' : 'Loading…'}
        </p>
      </Shell>
    )
  }

  if (!data || data.lines.length === 0) {
    return (
      <Shell>
        <div className="py-24 text-center">
          <p className="text-sm text-muted">Your bag is empty.</p>
          <Link href="/" className="label-xs mt-5 inline-block border-b border-ink pb-0.5">
            Start shopping
          </Link>
        </div>
      </Shell>
    )
  }

  function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!complete) return
    const form = Object.fromEntries(new FormData(event.currentTarget))

    setMessage(null)
    startTransition(async () => {
      const result = await placeOrder(lines, form)
      if (!result.ok) {
        setErrors(result.fieldErrors)
        setMessage(result.message ?? null)
        jumpToErrors(result.fieldErrors)
        return
      }
      setPlaced(true)
      clear()
      router.push(`/order/${result.number}`)
    })
  }

  return (
    <Shell>
      <form onSubmit={onSubmit} className="mt-8 lg:grid lg:grid-cols-[minmax(0,1fr)_20rem] lg:gap-16">
        <div>
          {message && <p className="mb-8 border border-sale px-4 py-3 text-sm text-sale">{message}</p>}

          <Step
            number={1}
            title="Contact"
            open={step === 1}
            locked={false}
            summary={contactDone ? email : undefined}
            onOpen={() => openStep(1)}
          >
            <div className="space-y-5">
              <Field
                name="email"
                label="Email"
                type="email"
                error={errors.email}
                autoComplete="email"
                value={email}
                onChange={setEmail}
              />
              <Field
                name="phone"
                label="Phone (optional)"
                error={errors.phone}
                autoComplete="tel"
                value={phone}
                onChange={setPhone}
              />
            </div>
            <Continue disabled={!contactDone} onClick={goNext} />
          </Step>

          <Step
            number={2}
            title="Shipping address"
            open={step === 2}
            locked={reached < 2}
            summary={addressDone ? `${name}, ${city}` : undefined}
            onOpen={() => openStep(2)}
          >
            <div className="space-y-5">
              <Field name="name" label="Full name" error={errors.name} autoComplete="name" value={name} onChange={setName} />
              <Field name="line1" label="Address" error={errors.line1} autoComplete="address-line1" value={line1} onChange={setLine1} />
              <Field
                name="line2"
                label="Apartment, suite (optional)"
                error={errors.line2}
                autoComplete="address-line2"
                value={line2}
                onChange={setLine2}
              />
              <div className="grid gap-5 sm:grid-cols-3">
                <Field name="city" label="City" error={errors.city} autoComplete="address-level2" value={city} onChange={setCity} />
                <Field name="state" label="State" error={errors.state} autoComplete="address-level1" value={state} onChange={setState} />
                <Field
                  name="postalCode"
                  label="ZIP"
                  error={errors.postalCode}
                  autoComplete="postal-code"
                  value={postalCode}
                  onChange={setPostalCode}
                />
              </div>
              <Field
                name="country"
                label="Country"
                error={errors.country}
                autoComplete="country-name"
                value={country}
                onChange={setCountry}
              />
            </div>
            <Continue disabled={!addressDone} onClick={goNext} />
          </Step>

          <Step
            number={3}
            title="Shipping method"
            open={step === 3}
            locked={reached < 3}
            summary={reached > 3 ? SHIPPING_METHODS[shipping].label : undefined}
            onOpen={() => openStep(3)}
          >
            <div className="space-y-3">
              {SHIPPING_METHOD_KEYS.map((key) => (
                <Choice
                  key={key}
                  name="shippingMethod"
                  value={key}
                  checked={shipping === key}
                  onChange={() => setShipping(key)}
                  title={SHIPPING_METHODS[key].label}
                  note={SHIPPING_METHODS[key].note}
                  aside={
                    SHIPPING_METHODS[key].discountCents > 0
                      ? `− ${formatPrice(SHIPPING_METHODS[key].discountCents)}`
                      : 'Included'
                  }
                />
              ))}
            </div>
            <Continue onClick={goNext} />
          </Step>

          <Step
            number={4}
            title="Payment"
            open={step === 4}
            locked={reached < 4}
            summary={reached >= 4 && payable.length > 0 ? PAYMENT_METHODS[method].label : undefined}
            onOpen={() => openStep(4)}
          >
            {payable.length === 0 ? (
              <p className="border border-sale px-4 py-3 text-sm text-sale">
                No payment method is configured yet.
              </p>
            ) : (
              <div className="space-y-3">
                {payable.map((key) => (
                  <div key={key}>
                    <Choice
                      name="paymentMethod"
                      value={key}
                      checked={method === key}
                      onChange={() => setMethod(key)}
                      title={PAYMENT_METHODS[key].label}
                      note={PAYMENT_METHODS[key].note}
                    />

                    {key === 'crypto' && method === 'crypto' && (
                      <fieldset className="mt-3 ml-4 border-l border-line pl-4">
                        <legend className="sr-only">Coin and network</legend>
                        <div className="grid gap-2 sm:grid-cols-2">
                          {assets.map((item) => (
                            <label
                              key={item.key}
                              className={`flex cursor-pointer items-baseline justify-between gap-3 border px-3.5 py-2.5 transition-colors ${
                                item.key === coin ? 'border-ink' : 'border-line hover:border-muted'
                              }`}
                            >
                              <span className="min-w-0">
                                <input
                                  type="radio"
                                  name="cryptoAsset"
                                  value={item.key}
                                  checked={item.key === coin}
                                  onChange={() => setCoin(item.key)}
                                  className="sr-only"
                                />
                                <span className="block text-sm">{item.coin}</span>
                                <span className="block text-xs text-faint">{item.networkLabel}</span>
                              </span>
                              {item.pegged && (
                                <span className="shrink-0 text-[10px] tracking-wide text-faint uppercase">
                                  1:1 USD
                                </span>
                              )}
                            </label>
                          ))}
                        </div>
                        <p className="mt-3 text-xs leading-relaxed text-faint">
                          Send on the network shown — a transfer on the wrong network cannot be
                          recovered.
                        </p>
                      </fieldset>
                    )}
                  </div>
                ))}
              </div>
            )}
          </Step>
        </div>

        <aside className="mt-12 lg:mt-0">
          <div className="lg:sticky lg:top-32">
            <ul className="mb-8 space-y-3 border-b border-line pb-6 text-sm">
              {data.lines.map((line) => (
                <li key={line.key} className="flex justify-between gap-4">
                  <span className="min-w-0 text-muted">
                    {line.title}
                    <span className="text-faint"> × {line.quantity}</span>
                  </span>
                  <span className="shrink-0 tabular-nums">
                    {formatPrice(line.unitPriceCents * line.quantity)}
                  </span>
                </li>
              ))}
            </ul>

            <Summary cart={data} />

            <button
              type="submit"
              disabled={pending || !complete}
              className="mt-6 w-full bg-ink py-3.5 text-sm text-white transition-opacity hover:opacity-85 disabled:cursor-not-allowed disabled:opacity-40"
            >
              {pending ? 'Placing order…' : 'Place order'}
            </button>

            {!complete && (
              <p className="mt-3 text-xs leading-relaxed text-faint">
                Finish contact, address, shipping, and payment to place the order.
              </p>
            )}

            <p className="mt-4 text-xs leading-relaxed text-faint">
              You&rsquo;ll get payment instructions on the next screen. Nothing is charged until you
              send payment.
            </p>

            <Link href="/cart" className="label-xs mt-5 block text-center text-faint hover:text-ink">
              Back to bag
            </Link>
          </div>
        </aside>
      </form>
    </Shell>
  )
}

function Step({
  number,
  title,
  open,
  locked,
  summary,
  onOpen,
  children,
}: {
  number: number
  title: string
  open: boolean
  locked: boolean
  summary?: string
  onOpen: () => void
  children: ReactNode
}) {
  return (
    <section className="border-b border-line">
      <h2>
        <button
          type="button"
          onClick={onOpen}
          disabled={locked}
          aria-expanded={open}
          className="flex w-full items-baseline gap-2.5 py-5 text-left disabled:cursor-not-allowed"
        >
          <span className={`label-xs tabular-nums ${locked ? 'text-faint' : 'text-muted'}`}>
            {String(number).padStart(2, '0')}
          </span>
          <span className={`text-sm ${locked ? 'text-faint' : 'text-ink'}`}>{title}</span>
          {!open && summary && (
            <span className="ml-auto max-w-[50%] truncate text-xs text-muted">{summary}</span>
          )}
        </button>
      </h2>
      <div hidden={!open} className="pb-8">
        {children}
      </div>
    </section>
  )
}

function Continue({ disabled, onClick }: { disabled?: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      className="label-xs mt-6 bg-ink px-6 py-3 text-white transition-opacity hover:opacity-85 disabled:cursor-not-allowed disabled:bg-line disabled:text-muted"
    >
      Continue
    </button>
  )
}

function Choice({
  name,
  value,
  title,
  note,
  aside,
  checked,
  defaultChecked,
  onChange,
}: {
  name: string
  value: string
  title: string
  note: string
  aside?: string
  checked?: boolean
  defaultChecked?: boolean
  onChange?: () => void
}) {
  return (
    <label className="flex cursor-pointer gap-3.5 border border-line p-4 transition-colors has-checked:border-ink">
      <input
        type="radio"
        name={name}
        value={value}
        checked={checked}
        defaultChecked={defaultChecked}
        onChange={onChange}
        className="mt-1 size-4 shrink-0 accent-ink"
      />
      <span className="min-w-0 flex-1">
        <span className="flex items-baseline justify-between gap-3">
          <span className="text-sm">{title}</span>
          {aside && <span className="shrink-0 text-sm tabular-nums text-muted">{aside}</span>}
        </span>
        <span className="mt-1 block text-sm leading-relaxed text-muted">{note}</span>
      </span>
    </label>
  )
}

function Field({
  name,
  label,
  error,
  type = 'text',
  value,
  onChange,
  autoComplete,
}: {
  name: string
  label: string
  error?: string
  type?: string
  value: string
  onChange: (value: string) => void
  autoComplete?: string
}) {
  return (
    <div>
      <label htmlFor={name} className="label-xs text-faint">
        {label}
      </label>
      <input
        id={name}
        name={name}
        type={type}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        autoComplete={autoComplete}
        aria-invalid={error ? true : undefined}
        className={`mt-2 w-full border-b bg-transparent pb-2 text-[15px] outline-none transition-colors focus:border-ink ${
          error ? 'border-sale' : 'border-line'
        }`}
      />
      {error && <p className="mt-1.5 text-xs text-sale">{error}</p>}
    </div>
  )
}

function Shell({ children }: { children: ReactNode }) {
  return (
    <div className="mx-auto max-w-6xl px-5 py-12">
      <h1 className="text-3xl font-normal tracking-tight md:text-4xl">Checkout</h1>
      {children}
    </div>
  )
}
