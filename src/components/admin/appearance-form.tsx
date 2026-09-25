'use client'

import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useState, useTransition } from 'react'
import { saveShowcase } from '@/lib/admin-actions'
import {
  SHOWCASE_FALLBACK,
  SHOWCASE_KEYS,
  SHOWCASE_LABELS,
  type ShowcaseEntry,
  type ShowcaseKey,
} from '@/lib/showcase'
import { FilterInput } from './filter-input'
import { ImageField } from './image-field'
import { Card, Field, inputClass } from './ui'

export function AppearanceForm({ showcases }: { showcases: Record<ShowcaseKey, ShowcaseEntry> }) {
  const router = useRouter()
  const [pending, startTransition] = useTransition()
  const [message, setMessage] = useState<string | null>(null)
  const [saved, setSaved] = useState(false)
  const [query, setQuery] = useState('')
  const needle = query.trim().toLowerCase()

  function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const formData = new FormData(event.currentTarget)
    setMessage(null)
    setSaved(false)

    startTransition(async () => {
      const result = await saveShowcase(formData)
      if (!result.ok) {
        setMessage(result.message)
        return
      }
      setSaved(true)
      router.refresh()
    })
  }

  return (
    <form onSubmit={onSubmit} className="max-w-3xl space-y-5">
      <FilterInput value={query} onChange={setQuery} placeholder="搜索文案位置" />
      {needle &&
        !SHOWCASE_KEYS.some((key) => {
          const meta = SHOWCASE_LABELS[key]
          return meta.title.toLowerCase().includes(needle) || meta.hint.toLowerCase().includes(needle)
        }) && <p className="text-sm text-faint">没有匹配的文案位置</p>}
      {SHOWCASE_KEYS.map((key) => {
        const entry = showcases[key]
        const fallback = SHOWCASE_FALLBACK[key]
        const meta = SHOWCASE_LABELS[key]
        const hit =
          !needle ||
          meta.title.toLowerCase().includes(needle) ||
          meta.hint.toLowerCase().includes(needle)

        return (
          <Card key={key} className={hit ? 'space-y-5 p-5' : 'hidden'}>
            <div>
              <h2 className="text-sm">{meta.title}</h2>
              <p className="mt-0.5 text-xs text-faint">{meta.hint}</p>
            </div>

            <Field
              name={`${key}.headline`}
              label={meta.headline}
              hint={
                meta.headlineHint ??
                (fallback.headline ? `留空显示「${fallback.headline}」` : undefined)
              }
            >
              <input
                id={`${key}.headline`}
                name={`${key}.headline`}
                defaultValue={entry.headline ?? ''}
                placeholder={fallback.headline}
                className={inputClass}
              />
            </Field>

            {meta.subhead && (
              <Field
                name={`${key}.subhead`}
                label={meta.subhead}
                hint={
                  meta.subheadHint ??
                  (fallback.subhead ? `留空显示「${fallback.subhead}」` : undefined)
                }
              >
                {meta.subheadLine ? (
                  <input
                    id={`${key}.subhead`}
                    name={`${key}.subhead`}
                    defaultValue={entry.subhead ?? ''}
                    className={inputClass}
                  />
                ) : (
                  <textarea
                    id={`${key}.subhead`}
                    name={`${key}.subhead`}
                    rows={2}
                    defaultValue={entry.subhead ?? ''}
                    placeholder={fallback.subhead}
                    className={inputClass}
                  />
                )}
              </Field>
            )}

            {meta.image && (
              <ImageField name={key} label="入口图" hint={meta.image} current={entry.imageUrl} />
            )}
          </Card>
        )
      })}

      <div className="flex items-center gap-4">
        <button
          type="submit"
          disabled={pending}
          className="bg-ink px-8 py-3 text-sm text-white transition-opacity hover:opacity-85 disabled:opacity-50"
        >
          {pending ? '保存中…' : '保存'}
        </button>
        <Link href="/" target="_blank" className="text-sm text-faint hover:text-ink">
          在前台查看 ↗
        </Link>
        {saved && <span className="text-xs text-emerald-700">已保存</span>}
        {message && <span className="text-xs text-sale">{message}</span>}
      </div>
    </form>
  )
}
