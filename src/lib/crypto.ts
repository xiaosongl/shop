/**
 * 收款币种目录。
 *
 * 这里最要紧的一件事：**币和链是绑在一起的**。USDT 在 Tron 和在 Ethereum 上
 * 是两个完全不同的地址，把 TRC20 的 USDT 打到 ERC20 地址上，钱就没了，找不回来。
 * 所以配置和展示的最小单位一律是「币 + 链」，不存在单独一个 USDT。
 *
 * 目录本身写死在代码里：地址格式、TXID 格式、区块浏览器这些每加一条链都要写代码，
 * 放数据库里让后台自己填也没有意义。后台能配的是每个币的**地址**和**开关**，
 * 存在 CryptoWallet 表。
 */

type Network = {
  label: string
  /** 地址格式。填错等于所有货款打进黑洞，保存前必须过一遍 */
  addressRe: RegExp
  txidRe: RegExp
  txidHint: string
  explorer: (txid: string) => string
}

const NETWORKS = {
  bitcoin: {
    label: 'Bitcoin',
    addressRe: /^(bc1[a-z0-9]{25,62}|[13][a-km-zA-HJ-NP-Z1-9]{25,34})$/,
    txidRe: /^[0-9a-f]{64}$/i,
    txidHint: '64 hex characters',
    explorer: (txid) => `https://mempool.space/tx/${txid}`,
  },
  litecoin: {
    label: 'Litecoin',
    addressRe: /^(ltc1[a-z0-9]{25,62}|[LM][a-km-zA-HJ-NP-Z1-9]{26,33})$/,
    txidRe: /^[0-9a-f]{64}$/i,
    txidHint: '64 hex characters',
    explorer: (txid) => `https://blockchair.com/litecoin/transaction/${txid}`,
  },
  ethereum: {
    label: 'Ethereum · ERC20',
    addressRe: /^0x[0-9a-f]{40}$/i,
    txidRe: /^0x[0-9a-f]{64}$/i,
    txidHint: '0x + 64 hex characters',
    explorer: (txid) => `https://etherscan.io/tx/${txid}`,
  },
  bsc: {
    label: 'BNB Smart Chain · BEP20',
    addressRe: /^0x[0-9a-f]{40}$/i,
    txidRe: /^0x[0-9a-f]{64}$/i,
    txidHint: '0x + 64 hex characters',
    explorer: (txid) => `https://bscscan.com/tx/${txid}`,
  },
  tron: {
    label: 'Tron · TRC20',
    addressRe: /^T[1-9A-HJ-NP-Za-km-z]{33}$/,
    txidRe: /^[0-9a-f]{64}$/i,
    txidHint: '64 hex characters',
    explorer: (txid) => `https://tronscan.org/#/transaction/${txid}`,
  },
  solana: {
    label: 'Solana',
    addressRe: /^[1-9A-HJ-NP-Za-km-z]{32,44}$/,
    txidRe: /^[1-9A-HJ-NP-Za-km-z]{64,90}$/,
    txidHint: 'base58 signature',
    explorer: (txid) => `https://solscan.io/tx/${txid}`,
  },
} as const satisfies Record<string, Network>

type NetworkKey = keyof typeof NETWORKS

type AssetSpec = {
  coin: string
  network: NetworkKey
  /** 报价小数位。稳定币按美元习惯给 2 位，波动币给够精度 */
  decimals: number
  /** CoinGecko id。不填代表锚定 1 美元的稳定币，不查汇率 */
  coingeckoId?: string
  /**
   * 代币合约地址。核验时必须比对它而不是符号——
   * 任何人都能发一个符号也叫 USDT 的币转给你，钱包照样显示 USDT。
   * 原生币（BTC/ETH/LTC）不填。
   */
  contract?: string
}

/**
 * 排在前面的先展示。稳定币放最前——它们不吃汇率波动，
 * 从下单到到账中间不会因为币价跳水而少收钱，对双方都省事。
 */
const SPECS = {
  'usdt-trc20': {
    coin: 'USDT',
    network: 'tron',
    decimals: 2,
    contract: 'TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t',
  },
  'usdt-erc20': {
    coin: 'USDT',
    network: 'ethereum',
    decimals: 2,
    contract: '0xdAC17F958D2ee523a2206206994597C13D831ec7',
  },
  'usdt-bep20': {
    coin: 'USDT',
    network: 'bsc',
    decimals: 2,
    contract: '0x55d398326f99059fF775485246999027B3197955',
  },
  'usdc-erc20': {
    coin: 'USDC',
    network: 'ethereum',
    decimals: 2,
    contract: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48',
  },
  'usdc-sol': {
    coin: 'USDC',
    network: 'solana',
    decimals: 2,
    contract: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v',
  },
  btc: { coin: 'BTC', network: 'bitcoin', decimals: 8, coingeckoId: 'bitcoin' },
  eth: { coin: 'ETH', network: 'ethereum', decimals: 6, coingeckoId: 'ethereum' },
  ltc: { coin: 'LTC', network: 'litecoin', decimals: 6, coingeckoId: 'litecoin' },
} as const satisfies Record<string, AssetSpec>

export type AssetKey = keyof typeof SPECS

export const ASSET_KEYS = Object.keys(SPECS) as AssetKey[]

export function isAssetKey(value: unknown): value is AssetKey {
  return typeof value === 'string' && value in SPECS
}

export type Asset = ReturnType<typeof asset>

export function asset(key: AssetKey) {
  const spec: AssetSpec = SPECS[key]
  const network = NETWORKS[spec.network]
  return {
    key,
    coin: spec.coin,
    decimals: spec.decimals,
    coingeckoId: spec.coingeckoId as string | undefined,
    contract: (spec as AssetSpec).contract,
    /** 稳定币锚定美元，1 枚就是 100 美分，不用查行情 */
    pegged: !spec.coingeckoId,
    networkKey: spec.network,
    networkLabel: network.label,
    txidHint: network.txidHint,
    explorer: network.explorer,
    isAddress: (value: string) => network.addressRe.test(value.trim()),
    isTxid: (value: string) => network.txidRe.test(value.trim()),
  }
}

export const ASSETS = ASSET_KEYS.map(asset)

/**
 * 应付数额。稳定币的 rateCents 恒为 100，于是和波动币共用一个公式：
 * 总价美分 ÷ 单枚美分 = 枚数。
 */
export function amountFor(totalCents: number, rateCents: number, decimals: number): string {
  return (totalCents / rateCents).toFixed(decimals)
}

/**
 * 扫码内容。BTC 用 BIP21 能把金额一起带给钱包，用户不用手抄。
 *
 * ponytail: 代币（USDT/USDC 这些）只编码地址，金额让用户复制。
 * EIP-681 的代币转账 URI 各家钱包支持得七零八落，编出来大概率扫不动，
 * 反而不如一个纯地址稳。要做的话得按钱包逐个试，不值当。
 */
export function paymentUri(key: AssetKey, address: string, amount: string): string {
  return key === 'btc' ? `bitcoin:${address}?amount=${amount}` : address
}
