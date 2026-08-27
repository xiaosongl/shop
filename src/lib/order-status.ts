// 订单状态机。放在独立模块里是因为 admin-actions.ts 带 'use server'，
// 那种文件的导出必须全是 async 函数，容不下这种同步的纯逻辑。

export const ORDER_STATUSES = [
  'PENDING',
  'PAID',
  'READY',
  'SHIPPED',
  'COMPLETED',
  'CANCELLED',
] as const

export type OrderStatus = (typeof ORDER_STATUSES)[number]

/** 正常流转的主干。客户那边的进度条按这个顺序画，取消不在主干上 */
export const ORDER_TIMELINE = ['PENDING', 'PAID', 'READY', 'SHIPPED', 'COMPLETED'] as const

const FLOW: Record<OrderStatus, OrderStatus[]> = {
  PENDING: ['PAID', 'CANCELLED'],
  PAID: ['READY', 'CANCELLED'],
  READY: ['SHIPPED', 'CANCELLED'],
  // 已经交给 USPS 了就不能再取消：取消会把库存加回去，可货已经在路上。
  // 真要退货是另一码事，走人工，不在这套状态机里做。
  SHIPPED: ['COMPLETED'],
  COMPLETED: [],
  CANCELLED: [],
}

export function allowedTransitions(status: string): OrderStatus[] {
  return FLOW[status as OrderStatus] ?? []
}

/** 钱已经到账的状态。算营收按这个筛，免得以后加状态漏算 */
export const SETTLED_STATUSES: OrderStatus[] = ['PAID', 'READY', 'SHIPPED', 'COMPLETED']

/** 还等着人动手的状态：确认收款、备货、发货 */
export const OPEN_STATUSES: OrderStatus[] = ['PENDING', 'PAID', 'READY']

/** 走到这一步必须有物流单号，否则客户点开订单只看到「运输中」却无处可查 */
export function requiresTracking(status: OrderStatus) {
  return status === 'SHIPPED'
}

/**
 * 单号清洗与校验。运营多半是从 USPS 页面复制过来的，中间带空格，
 * 直接存会拼出一个查不到的链接，所以先把空白抹掉再验。
 */
export function normalizeTracking(input: string | null | undefined) {
  const value = (input ?? '').trim().replace(/\s+/g, '')
  if (!value) return { ok: false, message: '发货要填物流单号' } as const
  if (!/^[A-Za-z0-9]{8,40}$/.test(value)) {
    return { ok: false, message: '单号只能是字母和数字，长度 8-40 位' } as const
  }
  return { ok: true, value } as const
}

/** 后台用的中文名。放这里是为了和状态机同源，免得加了状态忘了加名字 */
export const ORDER_STATUS_ZH: Record<OrderStatus, string> = {
  PENDING: '待付款',
  PAID: '已付款',
  READY: '待发货',
  SHIPPED: '运输中',
  COMPLETED: '完成',
  CANCELLED: '已取消',
}

/** 后台按钮上的动作名，说的是「点了会发生什么」而不是状态名 */
export const ORDER_ACTION_ZH: Record<OrderStatus, string> = {
  PENDING: '退回待付款',
  PAID: '确认收款',
  READY: '开始备货',
  SHIPPED: '填单号发货',
  COMPLETED: '标记完成',
  CANCELLED: '取消订单',
}

/** 前台展示。客户看到的是进展，不是内部状态 */
export const ORDER_STATUS_EN: Record<OrderStatus, { label: string; title: string; note: string }> =
  {
    PENDING: {
      label: 'Awaiting payment',
      title: 'Almost there.',
      note: 'Your items are reserved. Send payment below and we\u2019ll take it from here.',
    },
    PAID: {
      label: 'Payment confirmed',
      title: 'Payment confirmed.',
      note: 'We\u2019ve received your payment and your order is queued for packing.',
    },
    READY: {
      label: 'Packing',
      title: 'Packing your order.',
      note: 'Your items are being packed. You\u2019ll get a tracking number as soon as it ships.',
    },
    SHIPPED: {
      label: 'In transit',
      title: 'On its way.',
      note: 'Your order has left the building. Track it with the number below.',
    },
    COMPLETED: {
      label: 'Delivered',
      title: 'Delivered.',
      note: 'This order is complete. Thanks for shopping with us.',
    },
    CANCELLED: {
      label: 'Cancelled',
      title: 'Order cancelled.',
      note: 'Nothing was charged.',
    },
  }

/** 两种配送都走 USPS，所以单号直接拼 USPS 的查询地址 */
export function trackingUrl(trackingNumber: string) {
  return `https://tools.usps.com/go/TrackConfirmAction?tLabels=${encodeURIComponent(trackingNumber)}`
}
