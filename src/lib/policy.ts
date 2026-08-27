/**
 * 政策页：退款、配送、条款、隐私这类静态长文。
 *
 * 正文是纯文本，不是 HTML。后台能写、访客能读的字段一旦按 HTML 渲染，
 * 就等于给自己开了一个存储型 XSS，所以这里只认三种极简标记：
 *   空行  → 分段
 *   ## 开头的一行 → 小标题
 *   - 开头的连续几行 → 列表
 * 别的一律当普通段落，交给 React 转义。
 */

export type PolicyBlock =
  | { kind: 'heading'; text: string }
  | { kind: 'list'; items: string[] }
  | { kind: 'text'; text: string }

export function parsePolicy(body: string): PolicyBlock[] {
  return body
    .replace(/\r\n/g, '\n')
    .split(/\n[ \t]*\n/)
    .map((chunk) => chunk.trim())
    .filter(Boolean)
    .map((chunk): PolicyBlock => {
      const lines = chunk.split('\n').map((line) => line.trim())

      if (lines.every((line) => line.startsWith('- '))) {
        return { kind: 'list', items: lines.map((line) => line.slice(2).trim()) }
      }
      if (lines.length === 1 && lines[0].startsWith('## ')) {
        return { kind: 'heading', text: lines[0].slice(3).trim() }
      }
      return { kind: 'text', text: lines.join(' ') }
    })
}

/** slug 直接进 URL，只放行小写字母数字和连字符 */
export const POLICY_SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/

/**
 * 开箱即用的四份政策，由种子写进库，之后完全归后台管（能改能删能加）。
 * 内容按本站真实的流程写：USPS 两种包装、访客下单、虚拟币和 WhatsApp 收款。
 * 上线前请自己核一遍，尤其是退货地址和时限。
 */
export const DEFAULT_POLICIES = [
  {
    slug: 'returns',
    title: 'Returns & Refunds',
    position: 10,
    body: `We want you to be happy with what you ordered. If something isn't right, we'll make it right.

## The short version

- You have 30 days from delivery to request a return.
- Items must be unworn, unwashed, and in their original condition.
- Return shipping is on us for defective or incorrect items.

## How to start a return

Message us on WhatsApp with your order number and a short note about what's wrong. We'll reply with a return address and instructions. Please don't ship anything back before you hear from us — parcels sent without a reference are very hard to match to an order.

## Refunds

Once your return arrives and passes a quick check, we issue the refund within 5 business days.

Card and local payments are refunded to the original method. Cryptocurrency payments are refunded in the same coin, at the exchange rate recorded on your order — not the rate on the day of the refund. That rate is shown on your order page, so you always know the number in advance.

## What we can't take back

- Items marked final sale at the time of purchase.
- Anything damaged by normal wear, accident, or alteration.`,
  },
  {
    slug: 'shipping',
    title: 'Shipping',
    position: 20,
    body: `Every order ships from the United States via USPS with tracking.

## Two ways to pack

At checkout you choose how your order is packed:

- Boxed with invoice — the full retail presentation, original box and paperwork included.
- Discreet packaging — no box, no invoice, protective wrap only. This option is $15 less per order.

## Timing

Orders are picked and packed within 1–2 business days of payment clearing. Cryptocurrency payments clear once the transaction has enough confirmations on-chain, which is usually well under an hour.

Once your parcel is handed to USPS we add the tracking number to your order page, and you can follow it from there at any time.

## Tracking your order

Keep your order number. It's the only thing you need to look up an order — enter it along with your email on the Track your order page.`,
  },
  {
    slug: 'terms',
    title: 'Terms of Service',
    position: 30,
    body: `By placing an order on this site you agree to the terms below.

## Orders

Placing an order is an offer to buy. We confirm that offer when we accept payment. If an item sells out between your order and our confirmation, we'll contact you and refund you in full.

All prices are shown in US dollars. Where a cryptocurrency amount is displayed, it is converted from the US dollar total at the rate recorded on your order at the moment you placed it.

## Payment

We accept cryptocurrency and local payment arranged over WhatsApp. Orders stay unpaid until payment is confirmed — for crypto, that means confirmed on-chain against the address and amount on your order.

Never send payment to an address given to you anywhere other than your own order page. We will never message you first asking you to re-send a payment.

## Accounts

There are none. Checkout is guest-only by design; we don't ask you to create a password and we don't store one. Your order number is what identifies your order, so keep it somewhere safe.

## Liability

Our responsibility for any order is limited to the amount you paid for it.`,
  },
  {
    slug: 'privacy',
    title: 'Privacy',
    position: 40,
    body: `We collect the least we can get away with, and we don't sell any of it.

## What we collect

- The email address, shipping address, and phone number you enter at checkout.
- Your order contents, totals, and payment method.
- For crypto payments, the transaction ID you submit.

That's it. There are no accounts, no advertising trackers, and no third-party analytics on this site.

## Photo search

If you use the photo search, your image is processed on our own server to find visually similar products. It is never sent to a third party and it is not written to disk — it exists only for the moment it takes to run the match.

## Who else sees your data

- USPS, to deliver your parcel.
- Public blockchain explorers, which we query to confirm a payment. We look up the transaction ID you give us; we don't send them anything about you.

## How long we keep it

Order records are kept for as long as we need them for accounting and returns. Ask us on WhatsApp if you'd like your details removed and we'll take care of it.`,
  },
] as const
