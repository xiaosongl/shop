'use client'

import Link from 'next/link'
import { useState } from 'react'
import { importProductImages, listFromSource } from '@/lib/admin-actions'
import { Card, PageHeader } from './ui'

type Phase =
  | { at: 'idle' }
  | { at: 'listing' }
  | { at: 'images'; done: number; total: number; title: string }
  | { at: 'done'; id: string; slug: string; title: string; created: boolean; images: number }

export function SourceList() {
  const [url, setUrl] = useState('')
  const [phase, setPhase] = useState<Phase>({ at: 'idle' })
  const [error, setError] = useState('')

  async function submit(event: React.FormEvent) {
    event.preventDefault()
    setError('')
    setPhase({ at: 'listing' })

    const listed = await listFromSource(url)
    if (!listed.ok) {
      setError(listed.message)
      setPhase({ at: 'idle' })
      return
    }

    let added = 0
    if (listed.images.length) {
      setPhase({ at: 'images', done: 0, total: listed.images.length, title: listed.title })
      const form = new FormData()
      form.set('slug', listed.slug)
      form.set('sources', JSON.stringify(listed.images))
      const result = await importProductImages(form)
      added = result.added
      if (!result.ok && result.message) setError(result.message)
    }

    setPhase({
      at: 'done',
      id: listed.id,
      slug: listed.slug,
      title: listed.title,
      created: listed.created,
      images: added,
    })
  }

  const busy = phase.at === 'listing' || phase.at === 'images'

  return (
    <>
      <PageHeader title="货源上架" />

      <Card className="p-6">
        <p className="text-sm leading-relaxed text-muted">
          粘一条共享货源详情链接，例如
          <span className="break-all text-ink"> https://gxhy1688.com/detailIndex?marketCode=gz&code=…</span>
          。标题和介绍会译成英文，图抓回来后直接上架。
        </p>

        <form onSubmit={submit} className="mt-6 flex flex-col gap-3 sm:flex-row">
          <input
            value={url}
            onChange={(event) => setUrl(event.target.value)}
            type="url"
            required
            placeholder="https://gxhy1688.com/detailIndex?marketCode=gz&code=1216777277"
            className="min-w-0 flex-1 border-b border-line bg-transparent pb-2 text-sm outline-none placeholder:text-faint focus:border-ink"
          />
          <button
            type="submit"
            disabled={busy}
            className="shrink-0 bg-ink px-4 py-2 text-sm text-white disabled:opacity-50"
          >
            {busy ? '上架中…' : '一键上架'}
          </button>
        </form>

        {phase.at === 'listing' && <p className="mt-4 text-sm text-faint">正在拉取货源并整理…</p>}
        {phase.at === 'images' && (
          <p className="mt-4 text-sm text-faint">
            配图 {phase.done}/{phase.total} · {phase.title}
          </p>
        )}
        {error && <p className="mt-4 text-sm text-sale">{error}</p>}

        {phase.at === 'done' && (
          <div className="mt-6 border-t border-line pt-5 text-sm">
            <p>
              {phase.created ? '已上架' : '已更新'} <span className="text-ink">{phase.title}</span>
              {phase.images ? `，配了 ${phase.images} 张图` : ''}
            </p>
            <div className="mt-3 flex gap-4">
              <Link href={`/admin/products/${phase.id}`} className="text-ink underline-offset-2 hover:underline">
                去改价格或文案
              </Link>
              <Link href={`/p/${phase.slug}`} className="text-muted hover:text-ink">
                看前台
              </Link>
            </div>
          </div>
        )}
      </Card>
    </>
  )
}
