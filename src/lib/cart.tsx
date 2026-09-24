'use client'

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react'
import { resolveCart, type ResolvedCart } from './actions'
import { parseGrade, lineKey, type GradeKey } from './grades'
import { clampQuantity, type ShippingMethod } from './totals'

const STORAGE_KEY = 'northsound.cart.v1'

// 只存 SKU、等级和数量，不存价格。价格一律在服务端按当前数据库重新计算，
// 这样就算有人改了 localStorage 也改不动金额。
export type CartLine = { variantId: string; grade: GradeKey; quantity: number }

type CartApi = {
  lines: CartLine[]
  count: number
  /** 首次从 localStorage 读完之前是 false，用来避免 SSR 和客户端数字对不上 */
  ready: boolean
  drawerOpen: boolean
  openCart: () => void
  closeCart: () => void
  add: (variantId: string, quantity?: number, grade?: GradeKey, openDrawer?: boolean) => void
  setQuantity: (key: string, quantity: number) => void
  remove: (key: string) => void
  clear: () => void
}

const CartContext = createContext<CartApi | null>(null)

function read(): CartLine[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return []
    const parsed: unknown = JSON.parse(raw)
    if (!Array.isArray(parsed)) return []
    // 逐行收敛，坏行只丢自己。没写等级或旧 Classic 并进 Premium。
    return parsed.flatMap((line): CartLine[] => {
      if (typeof line !== 'object' || line === null) return []
      const { variantId, quantity, grade } = line as Partial<CartLine> & { grade?: unknown }
      if (typeof variantId !== 'string' || !variantId) return []
      if (typeof quantity !== 'number') return []
      return [
        {
          variantId,
          grade: parseGrade(grade),
          quantity: clampQuantity(quantity),
        },
      ]
    })
  } catch {
    return []
  }
}

function sameLine(left: CartLine, variantId: string, grade: GradeKey) {
  return left.variantId === variantId && left.grade === grade
}

export function CartProvider({ children }: { children: React.ReactNode }) {
  const [lines, setLines] = useState<CartLine[]>([])
  const [ready, setReady] = useState(false)
  const [drawerOpen, setDrawerOpen] = useState(false)

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

  const openCart = useCallback(() => setDrawerOpen(true), [])
  const closeCart = useCallback(() => setDrawerOpen(false), [])

  const add = useCallback((variantId: string, quantity = 1, grade: GradeKey = 'premium', openDrawer = true) => {
    if (grade === 'preowned') return
    setLines((current) => {
      const existing = current.find((line) => sameLine(line, variantId, grade))
      if (!existing) return [...current, { variantId, grade, quantity: clampQuantity(quantity) }]
      return current.map((line) =>
        sameLine(line, variantId, grade)
          ? { ...line, quantity: clampQuantity(line.quantity + quantity) }
          : line,
      )
    })
    if (openDrawer) setDrawerOpen(true)
  }, [])

  const setQuantity = useCallback((key: string, quantity: number) => {
    setLines((current) =>
      quantity <= 0
        ? current.filter((line) => lineKey(line.variantId, line.grade) !== key)
        : current.map((line) =>
            lineKey(line.variantId, line.grade) === key
              ? { ...line, quantity: clampQuantity(quantity) }
              : line,
          ),
    )
  }, [])

  const remove = useCallback((key: string) => {
    setLines((current) => current.filter((line) => lineKey(line.variantId, line.grade) !== key))
  }, [])

  const clear = useCallback(() => setLines([]), [])

  const value = useMemo<CartApi>(
    () => ({
      lines,
      count: lines.reduce((sum, line) => sum + line.quantity, 0),
      ready,
      drawerOpen,
      openCart,
      closeCart,
      add,
      setQuantity,
      remove,
      clear,
    }),
    [lines, ready, drawerOpen, openCart, closeCart, add, setQuantity, remove, clear],
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

      for (const removedKey of result.removed) remove(removedKey)
      for (const line of result.lines) {
        const local = lines.find((item) => lineKey(item.variantId, item.grade) === line.key)
        if (local && local.quantity !== line.quantity) setQuantity(line.key, line.quantity)
      }
    })

    return () => {
      cancelled = true
    }
  }, [ready, key, shipping, remove, setQuantity])

  return { ...cart, data, loading: loading || !ready }
}
