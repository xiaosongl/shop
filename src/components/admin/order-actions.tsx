'use client'

import { useRouter } from 'next/navigation'
import { useState, useTransition } from 'react'
import { recheckPayment } from '@/lib/actions'
import { REASON_COPY } from '@/lib/chain'
import { setOrderStatus } from '@/lib/admin-actions'
import { ORDER_ACTION_ZH, type OrderStatus, requiresTracking } from '@/lib/order-status'
import { Card, STATUS_LABEL, inputClass } from './ui'

const CONFIRM: Partial<Record<OrderStatus, string>> = {
  PAID: '确认已收到这笔款项？确认后订单进入待发货。',
  READY: '开始备货？',
  COMPLETED: '标记为已送达？',
  CANCELLED: '取消这笔订单？库存会自动退回。',
}

export function OrderActions({
  orderId,
  status,
  transitions,
  paymentMethod,
  trackingNumber,
  recheckNumber,
}: {
  orderId: string
  status: string
  transitions: OrderStatus[]
  paymentMethod: string
  trackingNumber: string | null
  recheckNumber: string | null
}) {
  const router = useRouter()
  const [pending, startTransition] = useTransition()
  const [error, setError] = useState<string | null>(null)
  const [recheck, setRecheck] = useState<string | null>(null)
  // 展开发货表单的那个状态，展开后要填单号才能提交
  const [shipping, setShipping] = useState(false)

  if (transitions.length === 0) {
    return (
      <Card className="p-4 text-sm text-muted">
        订单已{STATUS_LABEL[status]}，没有可执行的操作。
        {trackingNumber && <span className="ml-2 font-mono text-xs">{trackingNumber}</span>}
      </Card>
    )
  }

  function run(next: OrderStatus, tracking?: string) {
    setError(null)
    startTransition(async () => {
      const result = await setOrderStatus(orderId, next, tracking)
      if (result.ok) {
        setShipping(false)
        router.refresh()
      } else {
        setError(result.message)
      }
    })
  }

  function onClick(next: OrderStatus) {
    // 发货要单号，不能用 confirm 弹窗糊弄过去
    if (requiresTracking(next)) {
      setShipping(true)
      return
    }
    if (!confirm(CONFIRM[next] ?? '确认执行？')) return
    run(next)
  }

  return (
    <Card className="p-4">
      <p className="text-xs text-faint">
        {status === 'PENDING' && paymentMethod === 'crypto'
          ? '到区块浏览器核对 TXID、收款地址与金额后再确认收款'
          : '订单操作'}
      </p>

      <div className="mt-3 flex flex-wrap gap-2">
        {recheckNumber && (
          <button
            type="button"
            disabled={pending}
            onClick={() =>
              startTransition(async () => {
                const result = await recheckPayment(recheckNumber)
                // 链上判定给的是原因码，在这儿换成中文；限流之类的兜底消息是英文的，照原样显示
                setRecheck(
                  result.state === 'paid'
                    ? '链上核实通过，已放行'
                    : result.reason
                      ? REASON_COPY[result.reason].zh
                      : result.message,
                )
                if (result.state === 'paid') router.refresh()
              })
            }
            className="border border-line px-4 py-2 text-sm transition-opacity hover:opacity-85 disabled:opacity-50"
          >
            重新链上核验
          </button>
        )}
        {transitions.map((next) => (
          <button
            key={next}
            type="button"
            disabled={pending}
            onClick={() => onClick(next)}
            className={`px-4 py-2 text-sm transition-opacity hover:opacity-85 disabled:opacity-50 ${
              next === 'CANCELLED' ? 'border border-line text-muted' : 'bg-ink text-white'
            }`}
          >
            {ORDER_ACTION_ZH[next]}
          </button>
        ))}
      </div>

      {shipping && (
        <form
          className="mt-4 border-t border-line pt-4"
          onSubmit={(event) => {
            event.preventDefault()
            const value = new FormData(event.currentTarget).get('trackingNumber')
            run('SHIPPED', typeof value === 'string' ? value : '')
          }}
        >
          <label htmlFor="trackingNumber" className="text-xs text-faint">
            USPS 物流单号
          </label>
          <input
            id="trackingNumber"
            name="trackingNumber"
            required
            autoFocus
            spellCheck={false}
            placeholder="9400 1000 0000 0000 0000 00"
            className={`${inputClass} font-mono`}
          />
          <p className="mt-1 text-xs text-faint">填完客户订单页就能直接跳到 USPS 查件</p>
          <div className="mt-3 flex gap-2">
            <button
              type="submit"
              disabled={pending}
              className="bg-ink px-4 py-2 text-sm text-white transition-opacity hover:opacity-85 disabled:opacity-50"
            >
              {pending ? '提交中…' : '确认发货'}
            </button>
            <button
              type="button"
              onClick={() => setShipping(false)}
              className="px-4 py-2 text-sm text-muted"
            >
              取消
            </button>
          </div>
        </form>
      )}

      {recheck && <p className="mt-3 text-xs text-muted">{recheck}</p>}
      {error && <p className="mt-3 text-xs text-sale">{error}</p>}
    </Card>
  )
}
