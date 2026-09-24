import Link from 'next/link'
import { Badge, Card, PageHeader, Search, Stat, Table } from '@/components/admin/ui'
import { db } from '@/lib/db'
import { formatPrice } from '@/lib/format'
import { SETTLED_STATUSES } from '@/lib/order-status'

export default async function AdminHome() {
  const [pending, toShip, paidAgg, lowStock, activeProducts, recent] = await Promise.all([
    db.order.count({ where: { status: 'PENDING' } }),
    db.order.count({ where: { status: { in: ['PAID', 'READY'] } } }),
    db.order.aggregate({
      _sum: { totalCents: true },
      _count: true,
      where: { status: { in: SETTLED_STATUSES } },
    }),
    db.productVariant.count({ where: { stock: { lte: 2 } } }),
    db.product.count({ where: { status: 'ACTIVE' } }),
    db.order.findMany({
      orderBy: { createdAt: 'desc' },
      take: 8,
      select: {
        number: true,
        email: true,
        status: true,
        totalCents: true,
        paymentMethod: true,
        createdAt: true,
      },
    }),
  ])

  return (
    <>
      <PageHeader title="概览" />

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-5">
        <Stat label="待付款订单" value={String(pending)} hint="收到款后在订单页确认" />
        <Stat label="待发货" value={String(toShip)} hint="已收款，等备货发出" />
        <Stat
          label="已收款金额"
          value={formatPrice(paidAgg._sum.totalCents ?? 0)}
          hint={`${paidAgg._count} 笔已收款`}
        />
        <Stat label="在售商品" value={String(activeProducts)} />
        <Stat label="低库存 SKU" value={String(lowStock)} hint="库存 ≤ 2" />
      </div>

      <h2 className="mt-10 mb-4 text-sm text-faint">最近订单</h2>
      <Search action="/admin/orders" q="" placeholder="搜索单号、邮箱或姓名" />
      {recent.length === 0 ? (
        <Card className="px-4 py-16 text-center text-sm text-faint">还没有订单</Card>
      ) : (
        <Table head={['单号', '邮箱', '金额', '支付', '状态', '时间']}>
          {recent.map((order) => (
            <tr key={order.number} className="hover:bg-shell">
              <td className="px-4 py-3">
                <Link href={`/admin/orders/${order.number}`} className="hover:underline">
                  {order.number}
                </Link>
              </td>
              <td className="px-4 py-3 text-muted">{order.email}</td>
              <td className="px-4 py-3 tabular-nums">{formatPrice(order.totalCents)}</td>
              <td className="px-4 py-3">
                <Badge value={order.paymentMethod} />
              </td>
              <td className="px-4 py-3">
                <Badge value={order.status} />
              </td>
              <td className="px-4 py-3 text-faint">
                {order.createdAt.toLocaleString('zh-CN', { hour12: false })}
              </td>
            </tr>
          ))}
        </Table>
      )}
    </>
  )
}
