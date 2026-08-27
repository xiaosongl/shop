import type { Asset } from './crypto'

/**
 * 链上核验：拿客户填的 TXID 去链上查这笔转账到底成没成。
 *
 * 通过就自动放行订单，所以这里是整个系统里唯一一处「判断错了就白送货」的代码。
 * 每条链的适配都必须把这五件事全查清楚，缺一条就是一个白拿货的口子：
 *
 *   1. 收款地址是我们的 —— 不查的话，随便从区块浏览器抄一个真实哈希就能过
 *   2. 金额不少于应付   —— 少付不放行，多付放行
 *   3. 确认数够          —— 0 确认可被 RBF 替换掉，看到到账就发货等于送
 *   4. 代币合约对得上   —— 山寨币可以随便起名叫 USDT，只能认合约地址
 *   5. 转账晚于下单     —— 所有客户看到的是同一个收款地址，不比时间的话，
 *                          任何一笔无人认领的历史入账都能被拿去认领新订单
 *
 * 第六条「同一个 TXID 不能用两次」由数据库唯一约束负责，不在这里。
 *
 * 接口全部用免费公开端点，不需要注册和密钥。以太坊和 BSC 没有这种端点，
 * 所以那两条链返回 manual 交人工核，不会误放行。
 */

/**
 * 判定原因。文案不写进判定里：同一个结论，客户看的是英文付款页，
 * 运营看的是中文后台，共用一句话必然有一边看不懂。两种语言并排放着，
 * 加原因时不会只写一半。
 */
export const REASON_COPY = {
  badAmount: {
    en: 'The amount on this order looks wrong. Please contact us before sending anything.',
    zh: '订单金额异常，别放行，先联系客户',
  },
  wrongToken: {
    en: 'That transaction sent a different coin than the one this order is priced in.',
    zh: '转的不是我们要收的那个代币',
  },
  wrongAddress: {
    en: 'That transaction did not go to the address shown on this order.',
    zh: '这笔交易没有转到我们的收款地址',
  },
  short: {
    en: 'That transaction is for less than the amount due on this order.',
    zh: '转账金额少于应付金额',
  },
  tooEarly: {
    en: 'That transaction happened before this order was placed, so it cannot belong to it.',
    zh: '这笔转账发生在下单之前，不属于这个订单',
  },
  failed: {
    en: 'That transaction failed on-chain — nothing was transferred.',
    zh: '这笔交易在链上执行失败了',
  },
  badWallet: {
    en: 'Our receiving address is misconfigured. Please contact us before sending anything.',
    zh: '我们自己的收款地址配错了，先去收款配置页改',
  },
  unconfirmed: {
    en: 'Waiting for the network to confirm your transaction.',
    zh: '等待区块确认',
  },
  noTime: {
    en: 'Confirming when your transaction landed on-chain.',
    zh: '正在确认这笔转账的上链时间',
  },
  notFound: {
    en: "We can't see that transaction on-chain yet — we'll keep checking.",
    zh: '链上还查不到这笔交易',
  },
  manual: {
    en: 'Our team verifies this network by hand, usually within a few minutes.',
    zh: '这条链不自动核验，需要人工去链上对一遍',
  },
} as const satisfies Record<string, { en: string; zh: string }>

export type Reason = keyof typeof REASON_COPY

export type Verdict =
  | { state: 'paid' }
  /** 链上还没确认到位，等一会儿再查 */
  | { state: 'pending'; reason: Reason }
  /** 明确对不上，绝不放行 */
  | { state: 'rejected'; reason: Reason }
  /** 这条链不自动核，留给人工 */
  | { state: 'manual'; reason: Reason }

const TIMEOUT = 8000

async function getJson(url: string, init?: RequestInit): Promise<unknown | null> {
  try {
    const response = await fetch(url, {
      ...init,
      cache: 'no-store',
      signal: AbortSignal.timeout(TIMEOUT),
    })
    if (!response.ok) return null
    return await response.json()
  } catch {
    return null
  }
}

/**
 * 十进制字符串转最小单位整数。用 BigInt 而不是浮点：
 * 0.1 + 0.2 那套误差放在钱上就是对不上账。
 */
export function toUnits(amount: string, decimals: number): bigint {
  const [whole, fraction = ''] = amount.trim().split('.')
  const padded = fraction.padEnd(decimals, '0').slice(0, decimals)
  return BigInt((whole || '0') + padded)
}

/** 各条链把自己的响应解析成这几个事实，判断规则只写一份 */
export type Facts = {
  /** 有没有一笔转到我们地址的入账 */
  toUs: boolean
  /** 代币合约对不对。原生币（BTC/LTC）恒为 true */
  contractOk: boolean
  /** 实收，最小单位 */
  received: bigint
  /** 应收，最小单位 */
  expected: bigint
  /** 确认数够不够 */
  confirmed: boolean
  /** 这笔转账上链的时间，毫秒。0 表示没取到 */
  at: number
  /** 订单创建时间，毫秒。早于它的转账不算这一单的 */
  notBefore: number
}

/**
 * 允许交易时间比下单时间早这么多。
 *
 * 纯粹是给时钟误差留余量：比特币的区块时间戳只要求大于前 11 块的中位数，
 * 落后真实时间将近一小时也是合法的。宁可放宽也别误杀真实付款。
 *
 * ponytail: 这道闸把「能被认领的历史入账」从全部历史压缩到下单前两小时以内。
 * 要彻底关死，得给每单派生一个独立收款地址（HD 钱包），或者给每单应付金额
 * 加一个随机零头再按区间比对 —— 都是另一个工程。现在这条挡住的是实际可操作的那种攻击：
 * 盯着地址翻历史入账，捡一笔没人认领的来白拿货。
 */
const CLOCK_SKEW = 2 * 60 * 60 * 1000

/**
 * 放不放行就看这一个函数。五条规则集中在这里，
 * 各链适配只负责把响应翻译成 Facts，翻译错了顶多是查不到，不会误放行。
 */
export function judge(facts: Facts): Verdict {
  // 应收为 0 说明订单数据不对，绝不能因此白送
  if (facts.expected <= 0n) return { state: 'rejected', reason: 'badAmount' }
  if (!facts.contractOk) return { state: 'rejected', reason: 'wrongToken' }
  if (!facts.toUs) return { state: 'rejected', reason: 'wrongAddress' }
  if (facts.received < facts.expected) return { state: 'rejected', reason: 'short' }
  // 金额地址都对，只是还没确认——等，别拒
  if (!facts.confirmed) return { state: 'pending', reason: 'unconfirmed' }
  // 已进块却拿不到时间，就没法判断它属不属于这一单，只能等下一轮
  if (!facts.at) return { state: 'pending', reason: 'noTime' }
  if (facts.at < facts.notBefore - CLOCK_SKEW) return { state: 'rejected', reason: 'tooEarly' }
  return { state: 'paid' }
}

/** 收款地址比对。大小写不敏感——EVM 是校验和大小写，Tron/BTC 本身就区分但存的时候没变过 */
const sameAddress = (a: string, b: string) => a.trim().toLowerCase() === b.trim().toLowerCase()

// ---------- Bitcoin / Litecoin ----------

/**
 * 这三家跑的都是同一套 Esplora 接口，所以一份解析吃三家，顺带互为备份。
 *
 * 试过 blockchair，四次请求就把 IP 拉黑了（HTTP 430），不能用。
 * 这几个都免费、不要密钥、也没有那种额度墙。
 */
const ESPLORA = {
  bitcoin: {
    hosts: ['https://mempool.space/api', 'https://blockstream.info/api'],
    minConfirmations: 1,
  },
  litecoin: {
    // 出块 2.5 分钟，2 个确认约 5 分钟，够挡住短重组
    hosts: ['https://litecoinspace.org/api'],
    minConfirmations: 2,
  },
} as const

async function verifyEsplora(
  chain: keyof typeof ESPLORA,
  address: string,
  expected: string,
  txid: string,
  notBefore: number,
): Promise<Verdict> {
  const { hosts, minConfirmations } = ESPLORA[chain]

  for (const host of hosts) {
    const tx = (await getJson(`${host}/tx/${txid}`)) as {
      vout?: { scriptpubkey_address?: string; value?: number }[]
      status?: { confirmed?: boolean; block_height?: number; block_time?: number }
    } | null
    // 这家查不到就换下一家，都查不到才算「链上没有」
    if (!tx?.vout) continue

    // 一笔交易可以有多个输出打到同一地址，要加总
    const received = tx.vout
      .filter((out) => out.scriptpubkey_address && sameAddress(out.scriptpubkey_address, address))
      .reduce((sum, out) => sum + BigInt(out.value ?? 0), 0n)

    let confirmations = 0
    if (tx.status?.confirmed) {
      const tip = await getJson(`${host}/blocks/tip/height`)
      // 拿不到块高就按 1 算，反正已经进块了
      confirmations = typeof tip === 'number' ? tip - (tx.status.block_height ?? tip) + 1 : 1
    }

    return judge({
      toUs: received > 0n,
      contractOk: true,
      received,
      expected: toUnits(expected, 8),
      confirmed: confirmations >= minConfirmations,
      // Esplora 给的是秒
      at: (tx.status?.block_time ?? 0) * 1000,
      notBefore,
    })
  }

  return { state: 'pending', reason: 'notFound' }
}

// ---------- Tron ----------

const BASE58 = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz'

/**
 * Tron 的 base58 地址转成事件日志里那种 hex。
 * 解出来是 [0x41][20 字节地址][4 字节校验]，取中间 20 字节。
 */
export function tronAddressToHex(input: string): string | null {
  let value = 0n
  for (const char of input.trim()) {
    const index = BASE58.indexOf(char)
    if (index < 0) return null
    value = value * 58n + BigInt(index)
  }
  const hex = value.toString(16)
  // 定长 25 字节，首字节 0x41 保证不会有前导零的歧义
  return hex.length === 50 ? hex.slice(2, 42) : null
}

/**
 * TRC20：查这一笔交易的事件日志。
 *
 * 没走「翻我们地址的入账记录」那条路——那个接口一次最多回 200 条，
 * 收款地址一忙，客户晚点填的单号就翻不到了，会一直卡在待确认。
 * 按 TXID 查是常数大小的响应（不到 1KB），也没有这个天花板。
 */
async function verifyTron(
  address: string,
  expected: string,
  txid: string,
  contract: string,
  notBefore: number,
): Promise<Verdict> {
  const body = (await getJson(`https://api.trongrid.io/v1/transactions/${txid}/events`)) as {
    data?: {
      event_name?: string
      contract_address?: string
      block_timestamp?: number
      result?: { to?: string; value?: string }
    }[]
  } | null

  if (!body?.data?.length) return { state: 'pending', reason: 'notFound' }

  const us = tronAddressToHex(address)
  if (!us) return { state: 'rejected', reason: 'badWallet' }

  // 一笔交易里可能有多个 Transfer（比如经过兑换）。合约和收款方分开判，
  // 这样拒绝时能说准是「转错币」还是「转错地址」。
  // 山寨代币可以随便叫 USDT，所以合约比的是地址不是符号。
  const sameToken = body.data.filter(
    (event) =>
      event.event_name === 'Transfer' &&
      event.contract_address &&
      sameAddress(event.contract_address, contract),
  )
  const mine = sameToken.filter(
    (event) => event.result?.to && sameAddress(event.result.to.replace(/^0x/, ''), us),
  )

  const received = mine.reduce((sum, event) => sum + BigInt(event.result?.value ?? '0'), 0n)
  const minedAt = mine[0]?.block_timestamp ?? 0

  return judge({
    contractOk: sameToken.length > 0,
    toUs: mine.length > 0,
    received,
    // TRC20 的 USDT/USDC 都是 6 位精度
    expected: toUnits(expected, 6),
    // ponytail: 用「出块过了 60 秒」代替数确认数。Tron 固定 3 秒一块、19 块不可逆，
    // 60 秒约 20 块，已过终局点。要精确得再调一次接口拿当前块高。
    confirmed: Date.now() - minedAt >= 60_000,
    // TronGrid 给的就是毫秒
    at: minedAt,
    notBefore,
  })
}

// ---------- Solana ----------

/** Solana：公共 RPC。commitment 直接要 finalized，能返回就说明已经不可逆 */
async function verifySolana(
  address: string,
  expected: string,
  txid: string,
  contract: string,
  notBefore: number,
): Promise<Verdict> {
  const body = (await getJson('https://api.mainnet-beta.solana.com', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      jsonrpc: '2.0',
      id: 1,
      method: 'getTransaction',
      params: [txid, { encoding: 'jsonParsed', commitment: 'finalized', maxSupportedTransactionVersion: 0 }],
    }),
  })) as {
    result?: {
      blockTime?: number
      meta?: {
        err?: unknown
        preTokenBalances?: TokenBalance[]
        postTokenBalances?: TokenBalance[]
      }
    }
  } | null

  const meta = body?.result?.meta
  if (!meta) return { state: 'pending', reason: 'unconfirmed' }
  if (meta.err) return { state: 'rejected', reason: 'failed' }

  // owner + mint 一起匹配，这一步已经把「转给别人」和「转的是别的币」都排除了
  const match = (list: TokenBalance[] = []) =>
    list.find((item) => sameAddress(item.owner ?? '', address) && sameAddress(item.mint ?? '', contract))

  const after = match(meta.postTokenBalances)
  const before = match(meta.preTokenBalances)

  // 余额变动才是这笔交易实际转入的量，直接看 post 会把地址原有余额算进去
  const delta = BigInt(after?.uiTokenAmount?.amount ?? '0') - BigInt(before?.uiTokenAmount?.amount ?? '0')

  return judge({
    toUs: !!after,
    contractOk: !!after,
    received: delta,
    expected: toUnits(expected, after?.uiTokenAmount?.decimals ?? 6),
    // 上面要的就是 finalized，能返回结果就已经不可逆
    confirmed: true,
    // Solana 给的是秒
    at: (body?.result?.blockTime ?? 0) * 1000,
    notBefore,
  })
}

type TokenBalance = {
  owner?: string
  mint?: string
  uiTokenAmount?: { amount?: string; decimals?: number }
}

// ---------- 入口 ----------

/** notBefore 传订单创建时间（毫秒），早于它的转账一律不认 */
export async function verifyPayment(
  item: Asset,
  address: string,
  expected: string,
  txid: string,
  notBefore: number,
): Promise<Verdict> {
  switch (item.networkKey) {
    case 'bitcoin':
    case 'litecoin':
      return verifyEsplora(item.networkKey, address, expected, txid, notBefore)
    case 'tron':
      return item.contract
        ? verifyTron(address, expected, txid, item.contract, notBefore)
        : { state: 'manual', reason: 'manual' }
    case 'solana':
      return item.contract
        ? verifySolana(address, expected, txid, item.contract, notBefore)
        : { state: 'manual', reason: 'manual' }
    default:
      // 以太坊和 BSC 没有免费无密钥的公开端点，交人工——
      // 宁可慢一点，也不能因为查不动就默认放行
      return { state: 'manual', reason: 'manual' }
  }
}

/** 前台用来判断要不要继续轮询 */
export const AUTO_VERIFIED_NETWORKS = ['bitcoin', 'litecoin', 'tron', 'solana']
