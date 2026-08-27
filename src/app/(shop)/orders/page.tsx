import type { Metadata } from 'next'
import { OrderLookup } from '@/components/order-lookup'

export const metadata: Metadata = { title: 'Track your order' }

export default function OrdersPage() {
  return <OrderLookup />
}
