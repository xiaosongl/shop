'use client'

import { useEffect, useState } from 'react'
import { ORDER_MEMORY_DAYS, rememberOrder } from '@/lib/recent-orders'

/**
 * 订单号是访客回到这一单的唯一凭据——没有账号，找不回就只能来问客服。
 * 所以这里给足视觉重量，并顺手记在本地，省得他们真去抄。
 */
export function OrderNumber({ number }: { number: string }) {
  const [copied, setCopied] = useState<boolean | null>(null)
  const [saved, setSaved] = useState(false)

  // 每次打开都续期：还在惦记这单的人不该中途被清掉
  useEffect(() => {
    rememberOrder(number)
    setSaved(true)
  }, [number])

  async function copy() {
    try {
      await navigator.clipboard.writeText(number)
      setCopied(true)
    } catch {
      // http 或老浏览器下没有剪贴板权限，退回让用户自己选中复制
      setCopied(false)
      select()
    }
    window.setTimeout(() => setCopied(null), 2400)
  }

  return (
    <section className="border border-ink p-6 text-center md:p-8">
      <h2 className="label-xs text-faint">Your order number</h2>

      <p
        id="order-number"
        // 全角字距 + 等宽：这串东西是要被人念出来、抄下来、发给客服的
        className="mt-3 font-mono text-2xl tracking-[0.14em] break-all md:text-3xl"
      >
        {number}
      </p>

      <button
        type="button"
        onClick={copy}
        className="label-xs mt-5 min-h-11 border border-line px-6 transition-colors hover:border-ink"
      >
        {copied === null ? 'Copy number' : copied ? 'Copied' : 'Select and copy'}
      </button>

      <p className="mx-auto mt-5 max-w-sm text-xs leading-relaxed text-faint">
        Keep this somewhere safe — it&rsquo;s how you track your order and how we find you on
        WhatsApp.
        {saved && ` We've also saved it in this browser for ${ORDER_MEMORY_DAYS} days.`}
      </p>
    </section>
  )
}

/** 剪贴板用不了时的退路：把号选中，用户自己长按/Ctrl+C */
function select() {
  const node = document.getElementById('order-number')
  if (!node) return
  const range = document.createRange()
  range.selectNodeContents(node)
  const selection = window.getSelection()
  selection?.removeAllRanges()
  selection?.addRange(range)
}
