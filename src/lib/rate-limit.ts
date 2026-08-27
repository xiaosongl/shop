import { headers } from 'next/headers'

/**
 * 按「来源 + 动作」计数的固定窗口限流。
 *
 * 挡的不是聪明人，是量：密码爆破、图搜刷 CPU、脚本刷单，这些都靠请求量取胜，
 * 把量卡住，剩下的门槛（密码本身、链上校验）才有意义。
 *
 * ponytail: 计数放在进程内存里。单机单进程的部署（当前就是）够用，
 * 上多实例或 PM2 cluster 后每个进程各算各的，实际额度会被进程数乘上去 ——
 * 那时候把 hit() 换成 Redis 的 INCR + EXPIRE，调用方一行都不用改。
 */

type Window = { hits: number; resetAt: number }

const windows = new Map<string, Window>()

/** 超过这个数就清一遍过期桶。活跃 IP 真有这么多时内存也就几 MB，可以让它涨 */
const SWEEP_AT = 10_000

export type Limit = { hits: number; windowMs: number }

const MINUTE = 60_000

export const LIMITS = {
  /** 后台密码是唯一一把钥匙，这里给的额度最紧 */
  login: { hits: 8, windowMs: 10 * MINUTE },
  /** 一次图搜就是一次 CLIP 推理，且全站推理是串行的，放开了能把整站拖死 */
  imageSearch: { hits: 12, windowMs: MINUTE },
  /** 下单会扣库存，刷单等于把货锁死 */
  order: { hits: 10, windowMs: 10 * MINUTE },
  /**
   * 复查要打链上接口，刷它等于替我们把上游额度烧光。
   * 前台每 20 秒轮一次（3 次/分），这个额度够同一出口 IP 后面十个人同时付款；
   * 运营商 NAT 把一堆真人挤在一个 IP 上时，超额也只是慢一轮，不会报错。
   */
  recheck: { hits: 30, windowMs: MINUTE },
  /** 订单号 + 邮箱都对才给看，限流只是别让人拿它当撞库接口 */
  lookup: { hits: 20, windowMs: 10 * MINUTE },
} satisfies Record<string, Limit>

export type Scope = keyof typeof LIMITS

/** 命中返回 true（放行），超额返回 false */
export function hit(key: string, limit: Limit, now = Date.now()): boolean {
  if (windows.size > SWEEP_AT) {
    for (const [entry, window] of windows) if (window.resetAt <= now) windows.delete(entry)
  }

  const window = windows.get(key)
  if (!window || window.resetAt <= now) {
    windows.set(key, { hits: 1, resetAt: now + limit.windowMs })
    return true
  }

  window.hits += 1
  return window.hits <= limit.hits
}

/**
 * 请求来源。Cloudflare 会自己覆写 cf-connecting-ip，客户端伪造不了；
 * 源站只经 Tunnel 出去，绕过 CF 直连打不通，所以这个头可信。
 *
 * x-forwarded-for 是没挂 CF 时的退路，它可以伪造 —— 换句话说限流是抬高成本，
 * 不是绝对拦截，别把它当成唯一防线。
 *
 * 拿不到请求上下文说明这次调用根本不是从网上进来的（种子脚本、冲烟脚本直接调动作），
 * 那就没有「来源」可限，返回 null 让上面放行。线上每条路径都带请求，走不到这儿。
 */
async function source(): Promise<string | null> {
  try {
    const store = await headers()
    const forwarded = store.get('x-forwarded-for')?.split(',')[0]?.trim()
    return store.get('cf-connecting-ip') || forwarded || 'local'
  } catch {
    return null
  }
}

/** 服务端动作开头调一次；false 表示这次该拒 */
export async function allow(scope: Scope): Promise<boolean> {
  const from = await source()
  return from === null || hit(`${scope}:${from}`, LIMITS[scope])
}

/** 只给测试用：清掉计数，免得用例之间互相影响 */
export function resetLimits() {
  windows.clear()
}
