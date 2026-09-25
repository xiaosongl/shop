import type { Metadata } from 'next'
import Image from 'next/image'
import Link from 'next/link'
import { notFound } from 'next/navigation'
import QRCode from 'qrcode'
import { CryptoPayment } from '@/components/crypto-payment'
import { OrderNumber } from '@/components/order-number'
import { AUTO_VERIFIED_NETWORKS } from '@/lib/chain'
import { asset, isAssetKey, paymentUri } from '@/lib/crypto'
import { db } from '@/lib/db'
import { formatPrice } from '@/lib/format'
import {
  ORDER_STATUS_EN,
  ORDER_TIMELINE,
  type OrderStatus,
  trackingUrl,
} from '@/lib/order-status'
import { messengerLink, whatsappLink } from '@/lib/payments'
import { getContacts } from '@/lib/queries'
import { payableAsset } from '@/lib/wallets'
import { SHIPPING_METHODS, isShippingMethod } from '@/lib/totals'

type Props = { params: Promise<{ number: string }> }

export const metadata: Metadata = { title: 'Your order' }

export default async function OrderPage({ params }: Props) {
  const { number } = await params
  const contacts = await getContacts()
  const order = await db.order.findUnique({
    where: { number: decodeURIComponent(number) },
    include: { items: true },
  })
  if (!order) notFound()

  const status = ORDER_STATUS_EN[order.status as OrderStatus] ?? ORDER_STATUS_EN.PENDING

  // 收款地址用下单时快照的那一个。展示和核验必须指向同一个地址：页面上给新地址、
  // 后台拿旧快照去核，客户照着页面付了反倒被判「没转到我们地址」。
  // 快照为空只可能是加这一列之前的老订单，那才退回现取。
  const item =
    order.status === 'PENDING' &&
    order.paymentMethod === 'crypto' &&
    order.cryptoAmount &&
    isAssetKey(order.cryptoAsset)
      ? asset(order.cryptoAsset)
      : null

  const payTo = item ? order.cryptoAddress?.trim() || (await payableAsset(item.key))?.address : null
  const paying = item && payTo ? { ...item, address: payTo } : null

  const qrDataUrl = paying
    ? await QRCode.toDataURL(paymentUri(paying.key, paying.address, order.cryptoAmount!), {
        margin: 1,
        width: 352,
        color: { dark: '#111111', light: '#ffffff' },
      })
    : null

  // 还欠款的单子，页面主线是「怎么付」；付完了主线就变成「记住单号」
  const unpaid = order.status === 'PENDING'

  const shipping = isShippingMethod(order.shippingMethod)
    ? SHIPPING_METHODS[order.shippingMethod]
    : SHIPPING_METHODS.boxed

  return (
    <div className="mx-auto max-w-3xl px-5 py-16">
      <header className="pb-10 text-center">
        <h1 className="text-3xl font-normal tracking-tight md:text-4xl">{status.title}</h1>
        <p className="mt-4 text-[15px] leading-relaxed text-muted">{status.note}</p>
      </header>

      {/* 单号是他们离开这页之前最该带走的东西，所以顶上就给。
          但还没付款时先让付款方式说话——把付款二维码挤到折线以下就本末倒置了，
          那种情况下单号挪到付款区后面，见下面。 */}
      {!unpaid && (
        <div className="mb-10">
          <OrderNumber number={order.number} />
        </div>
      )}

      {order.status === 'CANCELLED' ? null : <Progress status={order.status as OrderStatus} />}

      {order.trackingNumber && (
        <section className="mt-10 border border-line p-6 text-center md:p-8">
          <h2 className="label-xs text-faint">USPS tracking</h2>
          <p className="mt-3 font-mono text-sm break-all">{order.trackingNumber}</p>
          <a
            href={trackingUrl(order.trackingNumber)}
            target="_blank"
            rel="noreferrer noopener"
            className="mt-5 inline-block bg-ink px-8 py-3 text-sm text-white transition-opacity hover:opacity-85"
          >
            Track on USPS
          </a>
        </section>
      )}

      {paying && qrDataUrl && (
        <div className="mt-10 mb-12">
          <CryptoPayment
            orderNumber={order.number}
            coin={paying.coin}
            networkLabel={paying.networkLabel}
            address={paying.address}
            amount={order.cryptoAmount!}
            rateCents={order.cryptoRateCents ?? 0}
            pegged={paying.pegged}
            txidHint={paying.txidHint}
            qrDataUrl={qrDataUrl}
            txid={order.cryptoTxid}
            autoVerified={AUTO_VERIFIED_NETWORKS.includes(paying.networkKey)}
          />
        </div>
      )}

      {/* 条件是「没有币可付」而不是「选了本地支付」：老订单没有地址快照、后台又把
          那个币关掉了的话，上面那块会整个不渲染——页头还写着「Send payment below」，
          下面却什么都没有，客人只能干等。这一块兜住那种情况，
          反正走人工开发票本来就是通用的退路。 */}
      {unpaid && !paying && (
        <section className="mt-10 mb-12 border border-line p-6 text-center md:p-8">
          <h2 className="label-xs text-faint">Local payment</h2>
          <p className="mx-auto mt-4 max-w-md text-sm leading-relaxed text-muted">
            Message us on WhatsApp or Messenger and we&rsquo;ll send an invoice for{' '}
            {formatPrice(order.totalCents)}, payable by credit card, PayPal, or your usual local
            wallet. Your items stay reserved until then.
          </p>
          <div className="mt-6 flex flex-col items-center justify-center gap-2 sm:flex-row">
            {contacts.whatsapp && (
              <a
                href={whatsappLink(contacts.whatsapp, order.number, formatPrice(order.totalCents))}
                target="_blank"
                rel="noreferrer noopener"
                className="inline-block bg-ink px-8 py-3.5 text-sm text-white transition-opacity hover:opacity-85"
              >
                Open WhatsApp
              </a>
            )}
            {contacts.messenger && (
              <a
                href={messengerLink(contacts.messenger, order.number, formatPrice(order.totalCents))}
                target="_blank"
                rel="noreferrer noopener"
                className="inline-block border border-ink px-8 py-3.5 text-sm transition-colors hover:bg-ink hover:text-white"
              >
                Open Messenger
              </a>
            )}
          </div>
        </section>
      )}

      {/* 付款说明之后再给单号：付款期间联系客服、之后回来查件，靠的都是它 */}
      {unpaid && (
        <div className="mb-12">
          <OrderNumber number={order.number} />
        </div>
      )}

      <ul className="divide-y divide-line border-y border-line">
        {order.items.map((item) => (
          <li key={item.id} className="flex gap-5 py-6">
            <Link
              href={`/p/${item.productSlug}`}
              className="relative aspect-[4/5] w-20 shrink-0 overflow-hidden bg-shell"
            >
              {item.imageUrl && (
                <Image src={item.imageUrl} alt={item.productTitle} fill sizes="80px" className="object-cover" />
              )}
            </Link>
            <div className="flex flex-1 justify-between gap-4">
              <div className="min-w-0">
                <p className="label-xs text-faint">{item.brandName}</p>
                <Link href={`/p/${item.productSlug}`} className="mt-1 block text-[15px] hover:underline">
                  {item.productTitle}
                </Link>
                <p className="mt-1 text-sm text-muted">
                  {item.variantLabel} · Qty {item.quantity}
                </p>
              </div>
              <p className="shrink-0 text-sm tabular-nums">
                {formatPrice(item.unitPriceCents * item.quantity)}
              </p>
            </div>
          </li>
        ))}
      </ul>

      <div className="grid gap-10 py-10 sm:grid-cols-2">
        <div className="space-y-8">
          <div>
            <h2 className="label-xs text-faint">Shipping to</h2>
            <address className="mt-4 space-y-1 text-sm leading-relaxed text-muted not-italic">
              <p className="text-ink">{order.name}</p>
              <p>{order.line1}</p>
              {order.line2 && <p>{order.line2}</p>}
              <p>
                {order.city}, {order.state} {order.postalCode}
              </p>
              <p>{order.country}</p>
              {order.phone && <p>{order.phone}</p>}
            </address>
          </div>
          <div>
            <h2 className="label-xs text-faint">Packaging</h2>
            <p className="mt-3 text-sm leading-relaxed text-muted">{shipping.label}</p>
          </div>
        </div>

        <dl className="space-y-3 text-sm">
          <Row label="Subtotal" value={formatPrice(order.subtotalCents)} />
          {order.discountCents > 0 && (
            <Row label="Discreet packaging" value={`− ${formatPrice(order.discountCents)}`} />
          )}
          <Row label="Shipping" value="Included" />
          {order.taxCents > 0 && <Row label="Tax" value={formatPrice(order.taxCents)} />}
          <div className="flex justify-between border-t border-line pt-4 text-base">
            <dt>Total</dt>
            <dd className="tabular-nums">{formatPrice(order.totalCents)}</dd>
          </div>
        </dl>
      </div>

      <div className="flex flex-col items-center gap-3 border-t border-line pt-8">
        <Link href="/orders" className="label-xs hover:text-ink">
          Track this order later
        </Link>
        <Link href="/" className="label-xs text-faint hover:text-ink">
          Continue shopping
        </Link>
      </div>
    </div>
  )
}

/** 五步进度条。已走过的画实心，当前那步加粗，后面的留灰 */
function Progress({ status }: { status: OrderStatus }) {
  const current = ORDER_TIMELINE.indexOf(status as (typeof ORDER_TIMELINE)[number])

  return (
    <ol className="flex gap-1.5">
      {ORDER_TIMELINE.map((step, index) => {
        const done = index <= current
        return (
          <li key={step} className="flex-1">
            <div className={`h-0.5 ${done ? 'bg-ink' : 'bg-line'}`} />
            <p
              className={`mt-2.5 text-[10px] leading-tight tracking-wide uppercase ${
                index === current ? 'text-ink' : 'text-faint'
              }`}
            >
              {ORDER_STATUS_EN[step].label}
            </p>
          </li>
        )
      })}
    </ol>
  )
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between">
      <dt className="text-muted">{label}</dt>
      <dd className="tabular-nums">{value}</dd>
    </div>
  )
}
