'use client'

import Image from 'next/image'
import { useRouter } from 'next/navigation'
import { useEffect, useState, useTransition } from 'react'
import { recheckPayment, submitTxid } from '@/lib/actions'

export function CryptoPayment({
  orderNumber,
  coin,
  networkLabel,
  address,
  amount,
  rateCents,
  pegged,
  txidHint,
  qrDataUrl,
  txid,
  autoVerified,
}: {
  orderNumber: string
  coin: string
  networkLabel: string
  address: string
  amount: string
  rateCents: number
  pegged: boolean
  txidHint: string
  qrDataUrl: string
  txid: string | null
  /** 这条链支不支持自动核验。不支持就别让用户干等轮询 */
  autoVerified: boolean
}) {
  const router = useRouter()
  const [copied, setCopied] = useState<'amount' | 'address' | null>(null)
  const [saved, setSaved] = useState(!!txid)
  const [note, setNote] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [pending, startTransition] = useTransition()

  /**
   * 填过单号但还没放行时每 20 秒回查一次。
   * 链上确认要一会儿，让用户守着页面自己刷不合适。
   */
  useEffect(() => {
    if (!saved || !autoVerified) return

    const timer = setInterval(async () => {
      const result = await recheckPayment(orderNumber)
      if (result.state === 'paid') {
        clearInterval(timer)
        // 状态已变，重取服务端数据，整页会切成「已付款」
        router.refresh()
      } else {
        setNote(result.message)
      }
    }, 20_000)

    return () => clearInterval(timer)
  }, [saved, autoVerified, orderNumber, router])

  async function copy(value: string, what: 'amount' | 'address') {
    try {
      await navigator.clipboard.writeText(value)
      setCopied(what)
      setTimeout(() => setCopied(null), 1800)
    } catch {
      setError('Copy failed — select the text and copy it by hand.')
    }
  }

  function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const value = new FormData(event.currentTarget).get('txid')
    setError(null)
    setNote(null)

    startTransition(async () => {
      const result = await submitTxid(orderNumber, value)
      if (result.state === 'rejected') {
        setError(result.message)
        return
      }
      setSaved(true)
      if (result.state === 'paid') router.refresh()
      else setNote(result.message)
    })
  }

  return (
    <section className="border border-line p-6 md:p-8">
      <h2 className="label-xs text-faint">Pay with {coin}</h2>

      {/* 打错链的钱要不回来，这句必须显眼，不能塞进小字里 */}
      <p className="mt-4 border border-ink px-4 py-3 text-sm leading-relaxed">
        Send <span className="font-medium">{coin}</span> on the{' '}
        <span className="font-medium">{networkLabel}</span> network only. A transfer on any other
        network is permanently lost.
      </p>

      <div className="mt-6 flex flex-col gap-8 sm:flex-row sm:items-start">
        <Image
          src={qrDataUrl}
          alt={`${coin} payment QR code`}
          width={176}
          height={176}
          unoptimized
          className="shrink-0 self-center border border-line sm:self-start"
        />

        <div className="min-w-0 flex-1 space-y-5">
          <div>
            <p className="label-xs text-faint">Amount</p>
            <button
              type="button"
              onClick={() => copy(amount, 'amount')}
              className="mt-1.5 block text-left text-xl tabular-nums hover:underline"
            >
              {amount} {coin}
            </button>
            <p className="mt-1 text-xs text-faint">
              {pegged
                ? `${coin} is pegged 1:1 to the US dollar, so this amount will not move.`
                : `Locked at $${(rateCents / 100).toLocaleString('en-US')} / ${coin} when you ordered.`}
            </p>
          </div>

          <div>
            <p className="label-xs text-faint">Address · {networkLabel}</p>
            <button
              type="button"
              onClick={() => copy(address, 'address')}
              className="mt-1.5 block w-full text-left text-sm break-all hover:underline"
            >
              {address}
            </button>
          </div>

          <p className="text-xs leading-relaxed text-faint">
            {copied === 'amount'
              ? 'Amount copied.'
              : copied === 'address'
                ? 'Address copied.'
                : 'Tap the amount or address to copy. Send the exact amount — a short payment will hold up the order.'}
          </p>
        </div>
      </div>

      <div className="mt-8 border-t border-line pt-6">
        {saved ? (
          <div className="flex items-start gap-3">
            <span className="mt-1.5 size-2 shrink-0 animate-pulse rounded-full bg-ink" />
            <p className="text-sm leading-relaxed text-muted">
              {note ?? 'Transaction ID received. Checking the blockchain…'}
              {autoVerified && (
                <span className="mt-1 block text-xs text-faint">
                  This page updates on its own once the transfer confirms. You can safely close it.
                </span>
              )}
            </p>
          </div>
        ) : (
          <form onSubmit={onSubmit}>
            <label htmlFor="txid" className="label-xs text-faint">
              Paste your transaction ID
            </label>
            <div className="mt-2 flex flex-col gap-3 sm:flex-row">
              <input
                id="txid"
                name="txid"
                required
                spellCheck={false}
                placeholder={txidHint}
                className="min-w-0 flex-1 border-b border-line bg-transparent pb-2 font-mono text-sm outline-none transition-colors placeholder:text-faint focus:border-ink"
              />
              <button
                type="submit"
                disabled={pending}
                className="shrink-0 bg-ink px-6 py-2.5 text-sm text-white transition-opacity hover:opacity-85 disabled:opacity-50"
              >
                {pending ? 'Saving…' : 'Submit'}
              </button>
            </div>
          </form>
        )}
        {error && <p className="mt-3 text-xs text-sale">{error}</p>}
      </div>
    </section>
  )
}
