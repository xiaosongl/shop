import { ASSETS, type Asset, asset, isAssetKey } from './crypto'
import { db } from './db'

// 收款配置的读取端。单独一个文件是因为 payments.ts 要被结算页的客户端组件引用，
// 那边一旦顺着 import 带进 db，better-sqlite3 就会被打进浏览器包。

export type PayableAsset = Asset & { address: string }

/**
 * 前台能选的币种：后台开了开关、并且填了地址的才算。
 * 顺序按目录里的排法，稳定币在前。
 */
export async function payableAssets(): Promise<PayableAsset[]> {
  const wallets = await db.cryptoWallet.findMany({
    where: { enabled: true },
    select: { assetKey: true, address: true },
  })

  const byKey = new Map(wallets.map((wallet) => [wallet.assetKey, wallet.address.trim()]))

  return ASSETS.flatMap((item) => {
    const address = byKey.get(item.key)
    // 地址被清空过的行留在表里也不能用，这里一并挡掉
    return address ? [{ ...item, address }] : []
  })
}

/** 单个币的收款地址，付款页和下单校验用。没开或没配就返回 null */
export async function payableAsset(key: unknown): Promise<PayableAsset | null> {
  if (!isAssetKey(key)) return null

  const wallet = await db.cryptoWallet.findUnique({
    where: { assetKey: key },
    select: { address: true, enabled: true },
  })
  if (!wallet?.enabled || !wallet.address.trim()) return null

  return { ...asset(key), address: wallet.address.trim() }
}

/** 后台配置页用：目录全量 + 各自当前的地址和开关 */
export async function walletSettings(): Promise<(Asset & { address: string; enabled: boolean })[]> {
  const wallets = await db.cryptoWallet.findMany({
    select: { assetKey: true, address: true, enabled: true },
  })
  const byKey = new Map(wallets.map((wallet) => [wallet.assetKey, wallet]))

  return ASSETS.map((item) => ({
    ...item,
    address: byKey.get(item.key)?.address ?? '',
    enabled: byKey.get(item.key)?.enabled ?? false,
  }))
}
