import type { Metadata } from 'next'
import { CheckoutForm } from '@/components/checkout-form'
import { localChatReady } from '@/lib/payments'
import { getContacts } from '@/lib/queries'
import { payableAssets } from '@/lib/wallets'

export const metadata: Metadata = { title: 'Checkout' }

export default async function CheckoutPage() {
  const [assets, contacts] = await Promise.all([payableAssets(), getContacts()])

  return (
    <CheckoutForm
      // 地址不下发到前台，用户选的只是「哪个币」，地址在付款页由服务端给
      assets={assets.map(({ key, coin, networkLabel, pegged }) => ({
        key,
        coin,
        networkLabel,
        pegged,
      }))}
      whatsappReady={localChatReady(contacts)}
    />
  )
}
