'use client'

import Image from 'next/image'
import { useRouter } from 'next/navigation'
import { useState, useTransition } from 'react'
import { deleteBrand, saveBrand } from '@/lib/admin-actions'
import { ImageField } from './image-field'
import { Card, Field, inputClass, Table } from './ui'

type Brand = {
  id: string
  name: string
  slug: string
  description: string | null
  position: number
  imageUrl: string | null
  _count: { products: number }
}

export function BrandManager({ brands }: { brands: Brand[] }) {
  const router = useRouter()
  const [editing, setEditing] = useState<Brand | null>(null)
  const [creating, setCreating] = useState(false)
  const [pending, startTransition] = useTransition()
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [message, setMessage] = useState<string | null>(null)

  function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const formData = new FormData(event.currentTarget)
    setMessage(null)

    startTransition(async () => {
      const result = await saveBrand(editing?.id ?? null, formData)
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

  function remove(brand: Brand) {
    if (!confirm(`删除品牌「${brand.name}」？`)) return
    startTransition(async () => {
      const result = await deleteBrand(brand.id)
      if (!result.ok) setMessage(result.message ?? '删除失败')
      else router.refresh()
    })
  }

  const showForm = creating || editing !== null

  return (
    <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_20rem]">
      <Table head={['品牌', 'slug', '商品数', '排序', '']}>
        {brands.map((brand) => (
          <tr key={brand.id} className="hover:bg-shell">
            <td className="px-4 py-3">
              <span className="flex items-center gap-3">
                <span className="relative aspect-4/5 w-9 shrink-0 overflow-hidden bg-shell">
                  {brand.imageUrl && (
                    <Image src={brand.imageUrl} alt="" fill sizes="36px" className="object-cover" />
                  )}
                </span>
                <span className="min-w-0">
                  <span className="block">{brand.name}</span>
                  {!brand.imageUrl && (
                    <span className="block text-xs text-faint">未设封面，前台用商品图顶替</span>
                  )}
                </span>
              </span>
            </td>
            <td className="px-4 py-3 text-muted">{brand.slug}</td>
            <td className="px-4 py-3 tabular-nums">{brand._count.products}</td>
            <td className="px-4 py-3 tabular-nums text-muted">{brand.position}</td>
            <td className="px-4 py-3 text-right whitespace-nowrap">
              <button
                type="button"
                onClick={() => {
                  setCreating(false)
                  setErrors({})
                  setMessage(null)
                  setEditing(brand)
                }}
                className="text-xs text-faint hover:text-ink"
              >
                编辑
              </button>
              <button
                type="button"
                disabled={pending}
                onClick={() => remove(brand)}
                className="ml-3 text-xs text-faint hover:text-sale disabled:opacity-50"
              >
                删除
              </button>
            </td>
          </tr>
        ))}
      </Table>

      <div>
        {!showForm ? (
          <button
            type="button"
            onClick={() => {
              setErrors({})
              setMessage(null)
              setCreating(true)
            }}
            className="w-full bg-ink py-3 text-sm text-white transition-opacity hover:opacity-85"
          >
            新建品牌
          </button>
        ) : (
          // key 让切换编辑对象时表单重新挂载，否则 defaultValue 不会跟着变
          <Card key={editing?.id ?? 'new'} className="p-5">
            <h2 className="text-xs text-faint">{editing ? `编辑 ${editing.name}` : '新建品牌'}</h2>
            <form onSubmit={onSubmit} className="mt-4 space-y-4">
              <Field name="name" label="名称" error={errors.name}>
                <input id="name" name="name" required defaultValue={editing?.name} className={inputClass} />
              </Field>
              <Field name="slug" label="slug" error={errors.slug} hint="前台地址 /men/这里">
                <input id="slug" name="slug" required defaultValue={editing?.slug} className={inputClass} />
              </Field>
              <Field name="description" label="简介" error={errors.description}>
                <textarea
                  id="description"
                  name="description"
                  rows={3}
                  defaultValue={editing?.description ?? ''}
                  className={inputClass}
                />
              </Field>
              <ImageField
                name="brand"
                label="品牌墙封面"
                hint="留空则自动用该品牌下第一张商品图"
                current={editing?.imageUrl}
              />
              <Field name="position" label="排序" error={errors.position} hint="数字越小越靠前">
                <input
                  id="position"
                  name="position"
                  type="number"
                  min={0}
                  defaultValue={editing?.position ?? 0}
                  className={inputClass}
                />
              </Field>

              {message && <p className="text-xs text-sale">{message}</p>}

              <div className="flex gap-2">
                <button
                  type="submit"
                  disabled={pending}
                  className="flex-1 bg-ink py-2.5 text-sm text-white transition-opacity hover:opacity-85 disabled:opacity-50"
                >
                  {pending ? '保存中…' : '保存'}
                </button>
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
      </div>
    </div>
  )
}
