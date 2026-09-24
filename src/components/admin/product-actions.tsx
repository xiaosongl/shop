'use client'

import { useRouter } from 'next/navigation'
import { useState, useTransition } from 'react'
import { deleteProduct, setProductStatus } from '@/lib/admin-actions'

type Props = { id: string; title: string; status: string; afterDelete?: 'stay' | 'list' }

export function ProductRowActions({ id, title, status, afterDelete = 'stay' }: Props) {
  const router = useRouter()
  const [pending, startTransition] = useTransition()
  const [message, setMessage] = useState<string | null>(null)

  function run(action: () => Promise<{ ok: boolean; message?: string }>, gone = false) {
    startTransition(async () => {
      const result = await action()
      if (!result.ok) {
        setMessage(result.message ?? '操作失败')
        return
      }
      setMessage(null)
      if (gone && afterDelete === 'list') router.push('/admin/products')
      else router.refresh()
    })
  }

  return (
    <span className="inline-flex flex-wrap items-center justify-end gap-x-3 gap-y-1">
      {status === 'ACTIVE' ? (
        <button
          type="button"
          disabled={pending}
          onClick={() => run(() => setProductStatus(id, 'ARCHIVED'))}
          className="text-xs text-faint hover:text-ink disabled:opacity-50"
        >
          下架
        </button>
      ) : (
        <button
          type="button"
          disabled={pending}
          onClick={() => run(() => setProductStatus(id, 'ACTIVE'))}
          className="text-xs text-faint hover:text-ink disabled:opacity-50"
        >
          上架
        </button>
      )}
      <button
        type="button"
        disabled={pending}
        onClick={() => {
          if (!confirm(`删除「${title}」？前台立刻看不到，历史订单里的快照还在。`)) return
          run(() => deleteProduct(id), true)
        }}
        className="text-xs text-faint hover:text-sale disabled:opacity-50"
      >
        删除
      </button>
      {message && <span className="basis-full text-right text-xs text-sale">{message}</span>}
    </span>
  )
}
