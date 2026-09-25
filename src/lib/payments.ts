import { ASSETS, type Asset } from './crypto'

// 这个文件会被商品页的客户端组件引用，所以不能碰 db。
// 收款地址在 wallets.ts，WhatsApp / Messenger 存在站点文案的 contact 位，由调用方传进来。

// 顺序即默认：结算页取 payable[0] 当预选项，所以本地支付放在最前面。
export const PAYMENT_METHODS = {
  whatsapp: {
    label: 'Local payment · WhatsApp / Messenger',
    // 得把收款方式写明白：大多数客人不碰虚拟币，看不到"能刷卡"就直接走了
    note: 'Pay by credit card, PayPal, or your usual local wallet. Message us on WhatsApp or Messenger — we send an invoice and confirm the order by hand once payment lands.',
  },
  crypto: {
    label: 'Cryptocurrency',
    note: 'Send the exact amount to the address we show you, then paste your transaction ID. We release the order once the transfer confirms on-chain.',
  },
} as const

export type PaymentMethod = keyof typeof PAYMENT_METHODS

export const PAYMENT_METHOD_KEYS = Object.keys(PAYMENT_METHODS) as PaymentMethod[]

export function isPaymentMethod(value: string): value is PaymentMethod {
  return value in PAYMENT_METHODS
}

export type ChatContacts = { whatsapp: string; messenger: string }

/** 站点文案里的原文。wa.me 只认纯数字；Messenger 去掉用户手滑加上的 @ */
export function readContacts(
  entry?: { headline?: string | null; subhead?: string | null } | null,
): ChatContacts {
  return {
    whatsapp: (entry?.headline ?? '').replace(/\D/g, ''),
    messenger: (entry?.subhead ?? '').replace(/^@/, '').trim(),
  }
}

export function whatsappLink(phone: string, orderNumber: string, amount: string) {
  const text = `Hi, I'd like to pay for order ${orderNumber} (${amount}).`
  return `https://wa.me/${phone}?text=${encodeURIComponent(text)}`
}

export function inquireLink(contacts: ChatContacts, title: string, path: string) {
  const text = `Hi, I'm interested in Pre-owned Authentic: ${title} (${path})`
  const encoded = encodeURIComponent(text)
  if (contacts.whatsapp) return `https://wa.me/${contacts.whatsapp}?text=${encoded}`
  if (contacts.messenger) return `https://m.me/${contacts.messenger}?text=${encoded}`
  return ''
}

export function messengerLink(handle: string, orderNumber: string, amount: string) {
  const text = `Hi, I'd like to pay for order ${orderNumber} (${amount}).`
  return `https://m.me/${handle}?text=${encodeURIComponent(text)}`
}

/** WhatsApp 或 Messenger 配了其中一个，本地支付就能下单 */
export function localChatReady(contacts: ChatContacts) {
  return Boolean(contacts.whatsapp || contacts.messenger)
}

/**
 * 单枚多少美分。
 *
 * 稳定币锚定美元，直接返回 100，一次外部请求都不用发——这也意味着
 * 稳定币不会因为行情接口抽风而下不了单，比 BTC 可靠。
 * 波动币取不到行情就返回 null，宁可让用户换个币种，也不能拿过期汇率收款。
 */
export async function rateCentsFor(item: Asset): Promise<number | null> {
  if (item.pegged) return 100

  const rates = await liveRates()
  return rates?.[item.coingeckoId!] ?? null
}

/** 波动币的行情。一次把目录里要查的都取回来，别一个币打一次接口 */
async function liveRates(): Promise<Record<string, number> | null> {
  const ids = [...new Set(ASSETS.filter((item) => !item.pegged).map((item) => item.coingeckoId!))]

  try {
    const response = await fetch(
      `https://api.coingecko.com/api/v3/simple/price?ids=${ids.join(',')}&vs_currencies=usd`,
      // 缓存 5 分钟，避免每次结算都打一次外部接口
      { next: { revalidate: 300 }, signal: AbortSignal.timeout(5000) },
    )
    if (!response.ok) return null

    const data = (await response.json()) as Record<string, { usd?: unknown } | undefined>

    const out: Record<string, number> = {}
    for (const id of ids) {
      const usd = data[id]?.usd
      if (typeof usd === 'number' && Number.isFinite(usd) && usd > 0) {
        out[id] = Math.round(usd * 100)
      }
    }
    return out
  } catch {
    return null
  }
}
