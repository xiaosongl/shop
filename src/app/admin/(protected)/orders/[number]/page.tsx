import Image from 'next/image'
import Link from 'next/link'
import { notFound } from 'next/navigation'
import { OrderActions } from '@/components/admin/order-actions'
import { Badge, Card, STATUS_LABEL } from '@/components/admin/ui'
import { getAdminRole } from '@/lib/admin-auth'
import { asset, isAssetKey } from '@/lib/crypto'
import { db } from '@/lib/db'
import { allowedTransitions } from '@/lib/order-status'
import { formatPrice } from '@/lib/format'

type Props = { params: Promise<{ number: string }> }

export default async function AdminOrderDetail({ params }: Props) {
  const role = await getAdminRole()
  const { number } = await params
  const order = await db.order.findUnique({
    where: { number: decodeURIComponent(number) },
    include: { items: true },
  })
  if (!order) notFound()

  // 币种目录取的是订单当初锁定的那个，后台事后关掉这个币也不影响历史订单展示
  const paid = isAssetKey(order.cryptoAsset) ? asset(order.cryptoAsset) : null

  return (
    <>
      <Link href="/admin/orders" className="text-xs text-faint hover:text-ink">
        ← 返回订单列表
      </Link>

      <div className="mt-4 mb-6 flex flex-wrap items-center gap-3">
        <h1 className="text-xl">{order.number}</h1>
        <Badge value={order.status} />
        <span className="text-xs text-faint">
          {order.createdAt.toLocaleString('zh-CN', { hour12: false })}
        </span>
      </div>

      {role === 'admin' && (
        <OrderActions
          orderId={order.id}
          status={order.status}
          transitions={allowedTransitions(order.status)}
          paymentMethod={order.paymentMethod}
          trackingNumber={order.trackingNumber}
          // 有单号但还挂在待付款，说明自动核验没过，给个手动重核的入口
          recheckNumber={
            order.status === 'PENDING' && order.cryptoTxid ? order.number : null
          }
        />
      )}

      <div className="mt-6 grid gap-5 lg:grid-cols-[minmax(0,1fr)_20rem]">
        <Card>
          <ul className="divide-y divide-line">
            {order.items.map((item) => (
              <li key={item.id} className="flex gap-4 p-4">
                <div className="relative aspect-[4/5] w-16 shrink-0 overflow-hidden bg-shell">
                  {item.imageUrl && (
                    <Image
                      src={item.imageUrl}
                      alt={item.productTitle}
                      fill
                      sizes="64px"
                      className="object-cover"
                    />
                  )}
                </div>
                <div className="flex flex-1 justify-between gap-4">
                  <div className="min-w-0">
                    <p className="text-xs text-faint">{item.brandName}</p>
                    <Link href={`/p/${item.productSlug}`} className="mt-0.5 block text-sm hover:underline">
                      {item.productTitle}
                    </Link>
                    <p className="mt-0.5 text-xs text-muted">
                      {item.variantLabel} · ×{item.quantity}
                    </p>
                  </div>
                  <p className="shrink-0 text-sm tabular-nums">
                    {formatPrice(item.unitPriceCents * item.quantity)}
                  </p>
                </div>
              </li>
            ))}
          </ul>

          <dl className="space-y-2 border-t border-line p-4 text-sm">
            <Row label="小计" value={formatPrice(order.subtotalCents)} />
            {order.discountCents > 0 && (
              <Row label="隐私包装减免" value={`− ${formatPrice(order.discountCents)}`} />
            )}
            <Row label="运费" value="已含" />
            {order.taxCents > 0 && <Row label="税" value={formatPrice(order.taxCents)} />}
            <div className="flex justify-between border-t border-line pt-2 text-base">
              <dt>合计</dt>
              <dd className="tabular-nums">{formatPrice(order.totalCents)}</dd>
            </div>
          </dl>
        </Card>

        <div className="space-y-5">
          <Card className="p-4">
            <h2 className="text-xs text-faint">收货信息</h2>
            <address className="mt-3 space-y-1 text-sm leading-relaxed text-muted not-italic">
              <p className="text-ink">{order.name}</p>
              <p>{order.line1}</p>
              {order.line2 && <p>{order.line2}</p>}
              <p>
                {order.city}, {order.state} {order.postalCode}
              </p>
              <p>{order.country}</p>
              <p className="pt-2 text-ink">{order.email}</p>
              {order.phone && <p>{order.phone}</p>}
            </address>
          </Card>

          <Card className="p-4">
            <h2 className="text-xs text-faint">配送与支付</h2>
            <dl className="mt-3 space-y-2 text-sm">
              <Row label="包装" value={STATUS_LABEL[order.shippingMethod] ?? order.shippingMethod} />
              {order.trackingNumber && <Row label="物流单号" value={order.trackingNumber} />}
              <Row label="支付方式" value={STATUS_LABEL[order.paymentMethod] ?? order.paymentMethod} />
              {paid && (
                <>
                  <Row label="收款链" value={`${paid.coin} · ${paid.networkLabel}`} />
                  <Row label="应付数额" value={`${order.cryptoAmount} ${paid.coin}`} />
                  {!paid.pegged && order.cryptoRateCents && (
                    <Row
                      label="下单汇率"
                      value={`$${(order.cryptoRateCents / 100).toLocaleString('en-US')}`}
                    />
                  )}
                </>
              )}
            </dl>

            {order.paymentMethod === 'crypto' && (
              <div className="mt-4 border-t border-line pt-3">
                {order.cryptoVerifiedAt ? (
                  <p className="mb-3 bg-emerald-50 px-3 py-2 text-xs text-emerald-900">
                    链上已核实 · 地址、金额、合约、确认数全对上，已自动放行
                    <span className="mt-0.5 block text-emerald-700">
                      {order.cryptoVerifiedAt.toLocaleString('zh-CN', { hour12: false })}
                    </span>
                  </p>
                ) : order.status === 'CANCELLED' ? (
                  order.cryptoTxid && (
                    <p className="mb-3 bg-red-50 px-3 py-2 text-xs text-red-900">
                      订单已取消，但客户回填了转账哈希 —— 钱可能真的到账了。
                      点下面的链接核一下，再决定退款还是恢复订单。
                    </p>
                  )
                ) : (
                  order.status !== 'PENDING' && (
                    <p className="mb-3 bg-amber-50 px-3 py-2 text-xs text-amber-900">
                      人工确认收款，未经链上核实
                    </p>
                  )
                )}
                {order.cryptoAddress && (
                  <div className="mb-3">
                    <p className="text-xs text-faint">下单时报给客户的收款地址</p>
                    <p className="mt-1.5 font-mono text-xs break-all text-muted">
                      {order.cryptoAddress}
                    </p>
                  </div>
                )}
                <p className="text-xs text-faint">客户回填的 TXID</p>
                {order.cryptoTxid && paid ? (
                  <a
                    // 直接跳到这条链自己的浏览器，别让运营再去猜该上哪查
                    href={paid.explorer(order.cryptoTxid)}
                    target="_blank"
                    rel="noreferrer noopener"
                    className="mt-1.5 block font-mono text-xs break-all text-ink hover:underline"
                  >
                    {order.cryptoTxid}
                  </a>
                ) : (
                  <p className="mt-1.5 text-xs text-muted">尚未填写</p>
                )}
              </div>
            )}
          </Card>
        </div>
      </div>
    </>
  )
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between gap-4">
      <dt className="text-muted">{label}</dt>
      <dd className="tabular-nums">{value}</dd>
    </div>
  )
}
