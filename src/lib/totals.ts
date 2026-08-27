// 金额规则只在这里定义一份。购物车、结算、下单、种子数据全部走这个函数，
// 否则页面上显示的总价和真正落库的金额迟早会对不上。

// 报价即成交价：带盒就是商品原价，不额外加税。
// 以后要开税只改这一个数，落库字段和展示行都留着。
export const TAX_RATE = 0

/** 单件最大购买量，同时用作服务端的输入校验上限 */
export const MAX_QUANTITY = 10

/**
 * 把任意数字收敛成合法数量。
 *
 * 本地存的购物车是不可信输入，收敛而不是拒绝：单行不合法就整车作废的话，
 * 顾客看到的是空购物车，而本地那条坏数据没人清得掉，等于永久卡死。
 */
export function clampQuantity(quantity: number): number {
  if (!Number.isFinite(quantity)) return 1
  return Math.min(Math.max(Math.trunc(quantity), 1), MAX_QUANTITY)
}

/**
 * 运输方式。运费本身含在商品价里，两个选项的差别是包装：
 * 带盒带发票按原价，不带盒不带发票减 $15。
 */
export const SHIPPING_METHODS = {
  boxed: {
    label: 'USPS · Boxed with invoice',
    note: 'Ships in the original box with a printed invoice inside.',
    discountCents: 0,
  },
  discreet: {
    label: 'USPS · Discreet packaging',
    note: 'Protective wrap only — no box, no invoice. $15 off.',
    discountCents: 1500,
  },
} as const

export type ShippingMethod = keyof typeof SHIPPING_METHODS

/** 减免最多能减掉这么多 */
export const MAX_DISCOUNT_CENTS = Math.max(
  ...Object.values(SHIPPING_METHODS).map((method) => method.discountCents),
)

/**
 * 商品最低价，必须高过最大减免。
 *
 * 定价等于或低于减免时，单件加不带盒包装算出来的总价正好是 0：
 * 走虚拟币会永远付不掉（应收为 0 时链上核验直接拒），走 WhatsApp 则是白送。
 */
export const MIN_PRICE_CENTS = MAX_DISCOUNT_CENTS + 1

export const SHIPPING_METHOD_KEYS = Object.keys(SHIPPING_METHODS) as ShippingMethod[]

export function isShippingMethod(value: string): value is ShippingMethod {
  return value in SHIPPING_METHODS
}

export type Totals = {
  subtotalCents: number
  discountCents: number
  shippingCents: number
  taxCents: number
  totalCents: number
}

export function totalsFor(subtotalCents: number, method: ShippingMethod): Totals {
  // 小额订单选不带盒时，减免不能把总价压成负数
  const discountCents = Math.min(SHIPPING_METHODS[method].discountCents, subtotalCents)
  const taxable = subtotalCents - discountCents
  const taxCents = Math.round(taxable * TAX_RATE)

  return {
    subtotalCents,
    discountCents,
    shippingCents: 0,
    taxCents,
    totalCents: taxable + taxCents,
  }
}
