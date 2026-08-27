import Link from 'next/link'
import { Badge, Empty, PageHeader, Pager, STATUS_LABEL, Table, pageFrom } from '@/components/admin/ui'
import { db } from '@/lib/db'
import { formatPrice } from '@/lib/format'
import { ORDER_STATUSES } from '@/lib/order-status'

// 筛选项跟着状态机走，加了新状态这里自动出现
const STATUSES: readonly string[] = ORDER_STATUSES

export default async function AdminOrders({
  searchParams,
}: {
  searchParams: Promise<{ status?: string; page?: string }>
}) {
  const { status, page: pageParam } = await searchParams
  const active = status && STATUSES.includes(status) ? status : null

  // 筛选标签上本来就要显示各状态的笔数，总数直接从这里加出来，不用再数一遍
  const counts = await db.order.groupBy({ by: ['status'], _count: true })
  const countFor = (value: string) => counts.find((row) => row.status === value)?._count ?? 0
  const all = counts.reduce((sum, row) => sum + row._count, 0)

  const { page, pages, skip, take } = pageFrom(pageParam, active ? countFor(active) : all)

  const orders = await db.order.findMany({
    where: active ? { status: active } : {},
    orderBy: { createdAt: 'desc' },
    skip,
    take,
    select: {
      number: true,
      email: true,
      status: true,
      totalCents: true,
      paymentMethod: true,
      shippingMethod: true,
      cryptoTxid: true,
      createdAt: true,
    },
  })

  return (
    <>
      <PageHeader title="订单" count={`共 ${all} 笔`} />

      <div className="mb-5 flex flex-wrap gap-2">
        <Filter href="/admin/orders" label="全部" active={!active} />
        {STATUSES.map((value) => (
          <Filter
            key={value}
            href={`/admin/orders?status=${value}`}
            label={`${STATUS_LABEL[value]} ${countFor(value)}`}
            active={active === value}
          />
        ))}
      </div>

      <Table head={['单号', '邮箱', '金额', '支付', '包装', '状态', '时间']}>
        {orders.length === 0 ? (
          <tr>
            <td colSpan={7}>
              <Empty>没有符合条件的订单</Empty>
            </td>
          </tr>
        ) : (
          orders.map((order) => (
            <tr key={order.number} className="hover:bg-shell">
              <td className="px-4 py-3">
                <Link href={`/admin/orders/${order.number}`} className="hover:underline">
                  {order.number}
                </Link>
                {order.status === 'PENDING' && order.cryptoTxid && (
                  <span className="ml-2 text-xs text-amber-700">已填 TXID</span>
                )}
                {/* 取消之后才回填的哈希：钱很可能真到了，这一单得有人去核 */}
                {order.status === 'CANCELLED' && order.cryptoTxid && (
                  <span className="ml-2 text-xs text-red-700">取消后收到款</span>
                )}
              </td>
              <td className="px-4 py-3 text-muted">{order.email}</td>
              <td className="px-4 py-3 tabular-nums">{formatPrice(order.totalCents)}</td>
              <td className="px-4 py-3">
                <Badge value={order.paymentMethod} />
              </td>
              <td className="px-4 py-3 text-muted">{STATUS_LABEL[order.shippingMethod]}</td>
              <td className="px-4 py-3">
                <Badge value={order.status} />
              </td>
              <td className="px-4 py-3 text-faint">
                {order.createdAt.toLocaleString('zh-CN', { hour12: false })}
              </td>
            </tr>
          ))
        )}
      </Table>

      <Pager
        path="/admin/orders"
        params={{ status: active ?? undefined }}
        page={page}
        pages={pages}
      />
    </>
  )
}

function Filter({ href, label, active }: { href: string; label: string; active: boolean }) {
  return (
    <Link
      href={href}
      className={`border px-3 py-1.5 text-sm transition-colors ${
        active ? 'border-ink bg-ink text-white' : 'border-line bg-white text-muted hover:border-ink'
      }`}
    >
      {label}
    </Link>
  )
}
