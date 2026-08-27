import { db } from './db'

/**
 * 未付款订单的自动回收。
 *
 * 下单那一刻就扣库存，而放回去只有「人工取消」一条路。虚拟币结算的弃单是常态：
 * 客户看一眼收款地址就关了页面，那份货从此锁死。攒上几天，热销款全都显示售罄，
 * 而且这个口子可以被人主动利用——按现有限流，一个 IP 十分钟能锁十单。
 *
 * 只回收虚拟币单，而且只回收客户从没回填过哈希的：
 *   - 填过哈希说明钱可能已经在路上，那种必须留给人看，系统不能替他取消。
 *   - WhatsApp 单不动。那条路本来就有客服在跟，替客服把单取消了只会添乱。
 */
const EXPIRE_AFTER_MS = 24 * 60 * 60 * 1000

/** 回收一轮。返回真正被取消的单数 */
export async function sweepExpiredOrders(now = Date.now()): Promise<number> {
  const stale = await db.order.findMany({
    where: {
      status: 'PENDING',
      paymentMethod: 'crypto',
      cryptoTxid: null,
      createdAt: { lt: new Date(now - EXPIRE_AFTER_MS) },
    },
    select: { id: true, items: { select: { variantId: true, quantity: true } } },
  })

  let cancelled = 0
  for (const order of stale) {
    // 状态当写入条件：万一后台同时有人点了取消，库存只会被还回去一次
    const done = await db.$transaction(async (tx) => {
      const moved = await tx.order.updateMany({
        where: { id: order.id, status: 'PENDING' },
        data: { status: 'CANCELLED' },
      })
      if (!moved.count) return false

      for (const item of order.items) {
        if (!item.variantId) continue
        await tx.productVariant.update({
          where: { id: item.variantId },
          data: { stock: { increment: item.quantity } },
        })
      }
      return true
    })
    if (done) cancelled += 1
  }

  return cancelled
}

/**
 * ponytail: 没有定时任务，就搭在「有人看购物车」这个动作上顺手扫一遍。
 * 天花板是没人逛就不回收——但没人逛的时候锁着库存也不影响谁，等第一个客人来就清了。
 * 要准点回收，把 sweepExpiredOrders() 挂到 systemd timer 上，这里不用改。
 */
const SWEEP_EVERY_MS = 10 * 60 * 1000
let sweptAt = 0

/** 不 await：回收慢或者失败都不该让客人的购物车跟着等 */
export function sweepSoon(now = Date.now()) {
  if (now - sweptAt < SWEEP_EVERY_MS) return
  sweptAt = now
  void sweepExpiredOrders(now).catch(() => {
    sweptAt = 0
  })
}
