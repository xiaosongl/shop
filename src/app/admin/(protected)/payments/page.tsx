import { WalletForm } from '@/components/admin/wallet-form'
import { PageHeader } from '@/components/admin/ui'
import { walletSettings } from '@/lib/wallets'

export default async function AdminPayments() {
  const wallets = await walletSettings()

  return (
    <>
      <PageHeader title="收款配置" />
      <p className="mb-6 max-w-2xl text-sm leading-relaxed text-muted">
        填了地址并打开开关的币种，才会出现在前台结算页。稳定币按 1 美元锚定报价，
        不受行情波动影响；BTC、ETH、LTC 在用户下单那一刻锁定汇率。
      </p>
      {/* 目录项上挂着校验函数，函数过不了 server/client 边界，这里只挑纯数据 */}
      <WalletForm
        wallets={wallets.map(({ key, coin, networkLabel, pegged, address, enabled }) => ({
          key,
          coin,
          networkLabel,
          pegged,
          address,
          enabled,
        }))}
      />
    </>
  )
}
