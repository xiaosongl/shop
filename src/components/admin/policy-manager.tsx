'use client'

import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useState, useTransition } from 'react'
import { deletePolicy, savePolicy } from '@/lib/admin-actions'
import { Card, Field, inputClass, Table } from './ui'

type Policy = {
  slug: string
  title: string
  body: string
  position: number
  published: boolean
  updatedAt: Date
}

const day = new Intl.DateTimeFormat('zh-CN', { month: 'numeric', day: 'numeric' })

export function PolicyManager({ policies }: { policies: Policy[] }) {
  const router = useRouter()
  const [editing, setEditing] = useState<Policy | null>(null)
  const [creating, setCreating] = useState(false)
  const [pending, startTransition] = useTransition()
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [message, setMessage] = useState<string | null>(null)

  function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const formData = new FormData(event.currentTarget)
    setMessage(null)

    startTransition(async () => {
      const result = await savePolicy(editing?.slug ?? null, formData)
      if (!result.ok) {
        setErrors(result.fieldErrors)
        setMessage(result.message ?? null)
        return
      }
      setErrors({})
      setEditing(null)
      setCreating(false)
      router.refresh()
    })
  }

  function remove(policy: Policy) {
    if (!confirm(`删除「${policy.title}」？页脚和它的链接会一起消失。`)) return
    startTransition(async () => {
      const result = await deletePolicy(policy.slug)
      if (!result.ok) setMessage(result.message ?? '删除失败')
      else router.refresh()
    })
  }

  const showForm = creating || editing !== null

  // 政策正文是长文，编辑框挤在表格旁边只剩一条窄缝——这里改成上下排，
  // 表格和输入框都拿满宽。品牌那页的左右分栏适合短表单，不适合这个。
  return (
    <div className="space-y-5">
      {!showForm ? (
        <button
          type="button"
          onClick={() => {
            setErrors({})
            setMessage(null)
            setCreating(true)
          }}
          className="bg-ink px-8 py-3 text-sm text-white transition-opacity hover:opacity-85"
        >
          新建政策页
        </button>
      ) : (
        // key 让切换编辑对象时表单重新挂载，否则 defaultValue 不会跟着变
        <Card key={editing?.slug ?? 'new'} className="max-w-3xl p-5">
          <h2 className="text-xs text-faint">{editing ? `编辑 ${editing.title}` : '新建政策页'}</h2>
          <form onSubmit={onSubmit} className="mt-4 space-y-4">
            <div className="grid gap-4 sm:grid-cols-2">
              <Field name="title" label="标题" error={errors.title}>
                <input
                  id="title"
                  name="title"
                  required
                  defaultValue={editing?.title}
                  className={inputClass}
                />
              </Field>

              <Field name="slug" label="slug" error={errors.slug} hint="前台地址 /policy/这里">
                <input
                  id="slug"
                  name="slug"
                  required
                  defaultValue={editing?.slug}
                  className={inputClass}
                />
              </Field>
            </div>

            <Field
              name="body"
              label="正文"
              error={errors.body}
              hint="空一行分段；「## 」开头是小标题；「- 」开头是列表。写 HTML 不会生效，会原样显示出来"
            >
              <textarea
                id="body"
                name="body"
                rows={20}
                required
                defaultValue={editing?.body}
                className={`${inputClass} font-mono text-xs leading-relaxed`}
              />
            </Field>

            <div className="flex flex-wrap items-end gap-6">
              <Field name="position" label="排序" error={errors.position} hint="数字越小越靠前">
                <input
                  id="position"
                  name="position"
                  type="number"
                  min={0}
                  defaultValue={editing?.position ?? 0}
                  className={`${inputClass} w-28`}
                />
              </Field>

              <label className="flex min-h-11 items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  name="published"
                  defaultChecked={editing?.published ?? true}
                  className="h-4 w-4"
                />
                发布（不勾选则前台看不到，页脚也不出现）
              </label>
            </div>

            {message && <p className="text-xs text-sale">{message}</p>}

            <div className="flex gap-2">
              <button
                type="submit"
                disabled={pending}
                className="bg-ink px-8 py-2.5 text-sm text-white transition-opacity hover:opacity-85 disabled:opacity-50"
              >
                {pending ? '保存中…' : '保存'}
              </button>
              {editing?.published && (
                <Link
                  href={`/policy/${editing.slug}`}
                  target="_blank"
                  className="border border-line px-4 py-2.5 text-sm text-muted hover:text-ink"
                >
                  预览 ↗
                </Link>
              )}
              <button
                type="button"
                onClick={() => {
                  setEditing(null)
                  setCreating(false)
                  setMessage(null)
                }}
                className="border border-line px-4 py-2.5 text-sm text-muted"
              >
                取消
              </button>
            </div>
          </form>
        </Card>
      )}

      <Table head={['标题', '地址', '状态', '排序', '更新', '']}>
        {policies.map((policy) => (
          <tr key={policy.slug} className="hover:bg-shell">
            <td className="px-4 py-3">{policy.title}</td>
            <td className="px-4 py-3 text-muted">/policy/{policy.slug}</td>
            <td className="px-4 py-3">
              {policy.published ? (
                <span className="text-emerald-700">已发布</span>
              ) : (
                <span className="text-faint">草稿</span>
              )}
            </td>
            <td className="px-4 py-3 tabular-nums text-muted">{policy.position}</td>
            <td className="px-4 py-3 text-muted tabular-nums">{day.format(policy.updatedAt)}</td>
            <td className="px-4 py-3 text-right whitespace-nowrap">
              <button
                type="button"
                onClick={() => {
                  setCreating(false)
                  setErrors({})
                  setMessage(null)
                  setEditing(policy)
                }}
                className="text-xs text-faint hover:text-ink"
              >
                编辑
              </button>
              <button
                type="button"
                disabled={pending}
                onClick={() => remove(policy)}
                className="ml-3 text-xs text-faint hover:text-sale disabled:opacity-50"
              >
                删除
              </button>
            </td>
          </tr>
        ))}
      </Table>
    </div>
  )
}
