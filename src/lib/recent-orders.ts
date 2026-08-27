const STORAGE_KEY = 'northsound.orders.v1'

/**
 * 15 天。够盖住一次跨境物流的等待期，又不至于让借了手机的人翻出半年前的单。
 * 每次打开订单页都会续期，所以还在关心这单的人不会中途被清掉。
 */
export const ORDER_MEMORY_DAYS = 15
const TTL = ORDER_MEMORY_DAYS * 24 * 60 * 60 * 1000

// 同一台设备上买过很多次的，只留最近这些，别让查单页变成流水账
const MAX = 10

export type RecentOrder = { number: string; savedAt: number }

/**
 * 访客不注册账号，订单号就是他们回到订单的唯一凭据。存在本地是为了
 * 「换个页面回来还找得到」，不是账号体系——清了浏览器数据就没了，
 * 所以确认页仍然要让人自己把号记下来。
 */
function read(): RecentOrder[] {
  try {
    const parsed: unknown = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '[]')
    if (!Array.isArray(parsed)) return []
    const now = Date.now()
    return parsed.filter(
      (item): item is RecentOrder =>
        typeof item === 'object' &&
        item !== null &&
        typeof (item as RecentOrder).number === 'string' &&
        typeof (item as RecentOrder).savedAt === 'number' &&
        // 过期的在读的时候就滤掉，不用等哪次写入来清
        now - (item as RecentOrder).savedAt < TTL,
    )
  } catch {
    // 隐私模式下 localStorage 会直接抛，记不住就记不住，不该让页面挂掉
    return []
  }
}

function write(list: RecentOrder[]) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(list.slice(0, MAX)))
  } catch {
    // 同上：存不下就算了
  }
}

/** 打开订单页时调用。已经存过的会挪到最前并续期 15 天。 */
export function rememberOrder(number: string) {
  const rest = read().filter((item) => item.number !== number)
  write([{ number, savedAt: Date.now() }, ...rest])
}

/** 最近的订单，新的在前。已过期的不会出现。 */
export function readRecentOrders(): RecentOrder[] {
  const list = read().sort((a, b) => b.savedAt - a.savedAt)
  // 读的时候顺手把过期的落盘清掉，否则一直躺在 localStorage 里
  write(list)
  return list
}

export function forgetOrders() {
  try {
    localStorage.removeItem(STORAGE_KEY)
  } catch {
    // 同上
  }
}

/** 这条记录还能留多久，用来告诉用户「到几号为止」 */
export function expiresAt(order: RecentOrder) {
  return new Date(order.savedAt + TTL)
}
