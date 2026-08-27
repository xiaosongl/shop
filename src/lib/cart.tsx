'use client'

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react'
import { resolveCart, type ResolvedCart } from './actions'
import type { ShippingMethod } from './totals'

const STORAGE_KEY = 'northsound.cart.v1'

// 只存 SKU 和数量，不存价格。价格一律在服务端按当前数据库重新计算，
// 这样就算有人改了 localStorage 也改不动金额。
export type CartLine = { variantId: string; quantity: number }

type CartApi = {
  lines: CartLine[]
  count: number
  /** 首次从 localStorage 读完之前是 false，用来避免 SSR 和客户端数字对不上 */
  ready: boolean
  add: (variantId: string, quantity?: number) => void
  setQuantity: (variantId: string, quantity: number) => void
  remove: (variantId: string) => void
  clear: () => void
}

const CartContext = createContext<CartApi | null>(null)

function read(): CartLine[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return []
    const parsed: unknown = JSON.parse(raw)
    if (!Array.isArray(parsed)) return []
    return parsed.filter(
      (line): line is CartLine =>
        typeof line === 'object' &&
        line !== null &&
        typeof (line as CartLine).variantId === 'string' &&
        Number.isFinite((line as CartLine).quantity),
    )
  } catch {
    return []
  }
}

export function CartProvider({ children }: { children: React.ReactNode }) {
  const [lines, setLines] = useState<CartLine[]>([])
  const [ready, setReady] = useState(false)

  useEffect(() => {
    setLines(read())
    setReady(true)
  }, [])

  useEffect(() => {
    if (!ready) return
    localStorage.setItem(STORAGE_KEY, JSON.stringify(lines))
  }, [lines, ready])

  // 同一个站点开了多个标签页时保持一致
  useEffect(() => {
    const onStorage = (event: StorageEvent) => {
      if (event.key === STORAGE_KEY) setLines(read())
    }
    window.addEventListener('storage', onStorage)
    return () => window.removeEventListener('storage', onStorage)
  }, [])

  const add = useCallback((variantId: string, quantity = 1) => {
    setLines((current) => {
      const existing = current.find((line) => line.variantId === variantId)
      if (!existing) return [...current, { variantId, quantity }]
      return current.map((line) =>
        line.variantId === variantId ? { ...line, quantity: line.quantity + quantity } : line,
      )
    })
  }, [])

  const setQuantity = useCallback((variantId: string, quantity: number) => {
    setLines((current) =>
      quantity <= 0
        ? current.filter((line) => line.variantId !== variantId)
        : current.map((line) => (line.variantId === variantId ? { ...line, quantity } : line)),
    )
  }, [])

  const remove = useCallback((variantId: string) => {
    setLines((current) => current.filter((line) => line.variantId !== variantId))
  }, [])

  const clear = useCallback(() => setLines([]), [])

  const value = useMemo<CartApi>(
    () => ({
      lines,
      count: lines.reduce((sum, line) => sum + line.quantity, 0),
      ready,
      add,
      setQuantity,
      remove,
      clear,
    }),
    [lines, ready, add, setQuantity, remove, clear],
  )

  return <CartContext value={value}>{children}</CartContext>
}

export function useCart(): CartApi {
  const context = useContext(CartContext)
  if (!context) throw new Error('useCart 必须在 CartProvider 内部使用')
  return context
}

/**
 * 把本地存的 SKU 交给服务端换成带价格的行。购物车页和结算页都用这个，
 * 保证两边看到的价格和库存是同一份。服务端顺带告诉我们哪些行失效了，在这里同步回本地。
 */
export function useResolvedCart(shipping: ShippingMethod = 'boxed') {
  const cart = useCart()
  const [data, setData] = useState<ResolvedCart | null>(null)
  const [loading, setLoading] = useState(true)

  const { ready, remove, setQuantity } = cart
  // 用序列化后的内容当依赖，而不是数组本身，否则每次重渲染都会重新请求一遍
  const key = JSON.stringify(cart.lines)

  useEffect(() => {
    if (!ready) return
    const lines: CartLine[] = JSON.parse(key)
    let cancelled = false

    setLoading(true)
    resolveCart(lines, shipping).then((result) => {
      if (cancelled) return
      setData(result)
      setLoading(false)

      for (const variantId of result.removed) remove(variantId)
      for (const line of result.lines) {
        const local = lines.find((item) => item.variantId === line.variantId)
        if (local && local.quantity !== line.quantity) setQuantity(line.variantId, line.quantity)
      }
    })

    return () => {
      cancelled = true
    }
  }, [ready, key, shipping, remove, setQuantity])

  return { ...cart, data, loading: loading || !ready }
}
