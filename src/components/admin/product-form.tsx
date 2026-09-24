'use client'

import Image from 'next/image'
import { useRouter } from 'next/navigation'
import { useState, useTransition } from 'react'
import { deleteProductImage, saveProduct, setVariantStock } from '@/lib/admin-actions'
import { ProductRowActions } from './product-actions'
import { Card, Field, inputClass } from './ui'

type Option = { id: string; name: string }
type CategoryOption = Option & { nameZh: string; parent: { nameZh: string } | null }

export type ProductFormValues = {
  id: string
  title: string
  slug: string
  description: string
  details: string | null
  brandId: string
  categoryId: string
  gender: string
  status: string
  priceCents: number
  compareAtCents: number | null
  featured: boolean
  videoUrl: string | null
  images: { id: string; url: string }[]
  variants: {
    id: string
    sku: string
    size: string | null
    color: string | null
    colorHex: string | null
    stock: number
  }[]
}

export function ProductForm({
  product,
  brands,
  categories,
}: {
  product?: ProductFormValues
  brands: Option[]
  categories: CategoryOption[]
}) {
  const router = useRouter()
  const [pending, startTransition] = useTransition()
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [message, setMessage] = useState<string | null>(null)
  const [saved, setSaved] = useState(false)

  // 规格在库里是拉平的 SKU 行，这里反推回「颜色列表 / 尺码列表」两个输入框
  const colorsValue = [
    ...new Map(
      (product?.variants ?? [])
        .filter((variant) => variant.color)
        .map((variant) => [variant.color!, variant.colorHex]),
    ),
  ]
    .map(([name, hex]) => (hex ? `${name}:${hex}` : name))
    .join(', ')

  const sizesValue = [
    ...new Set((product?.variants ?? []).map((variant) => variant.size).filter(Boolean)),
  ].join(', ')

  function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const formData = new FormData(event.currentTarget)
    setMessage(null)
    setSaved(false)

    startTransition(async () => {
      const result = await saveProduct(product?.id ?? null, formData)
      if (!result.ok) {
        setErrors(result.fieldErrors)
        setMessage(result.message ?? null)
        return
      }
      setErrors({})
      setSaved(true)
      if (product) router.refresh()
      else router.push(`/admin/products/${result.id}`)
    })
  }

  return (
    <form onSubmit={onSubmit} className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_18rem]">
      <div className="space-y-5">
        <Card className="space-y-5 p-5">
          <Field name="title" label="商品名称" error={errors.title}>
            <input id="title" name="title" required defaultValue={product?.title} className={inputClass} />
          </Field>

          <Field
            name="slug"
            label="URL slug"
            error={errors.slug}
            hint="前台地址 /p/这里，只能用小写字母、数字和短横线"
          >
            <input id="slug" name="slug" required defaultValue={product?.slug} className={inputClass} />
          </Field>

          <Field name="description" label="商品描述" error={errors.description}>
            <textarea
              id="description"
              name="description"
              required
              rows={4}
              defaultValue={product?.description}
              className={inputClass}
            />
          </Field>

          <Field
            name="videoUrl"
            label="视频链接"
            error={errors.videoUrl}
            hint="选填。https 的 mp4 / webm 直链，详情页排在图片前面播放。留空则没有视频"
          >
            <input
              id="videoUrl"
              name="videoUrl"
              defaultValue={product?.videoUrl ?? ''}
              className={inputClass}
            />
          </Field>

          <Field name="details" label="细节参数" error={errors.details} hint="一行一条，显示在详情页折叠区">
            <textarea
              id="details"
              name="details"
              rows={4}
              defaultValue={product?.details ?? ''}
              className={inputClass}
            />
          </Field>
        </Card>

        <Card className="p-5">
          <h2 className="text-xs text-faint">图片</h2>

          {product && product.images.length > 0 && (
            <div className="mt-4 flex flex-wrap gap-3">
              {product.images.map((image, index) => (
                <div key={image.id} className="relative">
                  <div className="relative aspect-[4/5] w-24 overflow-hidden bg-shell">
                    <Image src={image.url} alt="" fill sizes="96px" className="object-cover" />
                  </div>
                  {index === 0 && (
                    <span className="absolute top-1 left-1 bg-ink px-1.5 py-0.5 text-[10px] text-white">
                      主图
                    </span>
                  )}
                  <button
                    type="button"
                    onClick={() => {
                      if (!confirm('删除这张图？')) return
                      startTransition(async () => {
                        await deleteProductImage(image.id)
                        router.refresh()
                      })
                    }}
                    className="mt-1.5 w-full text-xs text-faint hover:text-sale"
                  >
                    删除
                  </button>
                </div>
              ))}
            </div>
          )}

          <div className="mt-4">
            <input
              type="file"
              name="images"
              multiple
              accept="image/*"
              className="w-full text-sm file:mr-3 file:border file:border-line file:bg-white file:px-3 file:py-1.5 file:text-sm"
            />
            <p className="mt-2 text-xs text-faint">
              上传后自动生成 400/800/1200/1600 四档 WebP、模糊占位和分享卡片图。单张不超过 12MB。
            </p>
          </div>
        </Card>

        <Card className="space-y-5 p-5">
          <h2 className="text-xs text-faint">规格</h2>

          <Field
            name="colors"
            label="颜色"
            error={errors.colors}
            hint="逗号分隔，可跟色值：Black:#141414, Sand:#d9cfc2。留空表示单色"
          >
            <input id="colors" name="colors" defaultValue={colorsValue} className={inputClass} />
          </Field>

          <Field
            name="sizes"
            label="尺码"
            error={errors.sizes}
            hint="逗号分隔：S,M,L,XL。包和表这类留空即可"
          >
            <input id="sizes" name="sizes" defaultValue={sizesValue} className={inputClass} />
          </Field>

          <p className="text-xs text-faint">
            保存后按「颜色 × 尺码」生成 SKU。已有 SKU 的库存不受影响；删掉的规格只有在没被下过单时才会移除。
          </p>

          {product && product.variants.length > 0 && (
            <div className="border-t border-line pt-5">
              <p className="text-xs text-faint">库存（改完点别处即保存）</p>
              <div className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                {product.variants.map((variant) => (
                  <StockRow key={variant.id} variant={variant} />
                ))}
              </div>
            </div>
          )}
        </Card>
      </div>

      <div className="space-y-5">
        <Card className="space-y-5 p-5">
          <Field name="status" label="状态">
            <select id="status" name="status" defaultValue={product?.status ?? 'DRAFT'} className={inputClass}>
              <option value="DRAFT">草稿（前台不显示）</option>
              <option value="ACTIVE">在售</option>
              <option value="ARCHIVED">下架（前台不显示）</option>
            </select>
          </Field>

          <Field name="brandId" label="品牌" error={errors.brandId}>
            <select id="brandId" name="brandId" required defaultValue={product?.brandId ?? ''} className={inputClass}>
              <option value="" disabled>
                请选择
              </option>
              {brands.map((brand) => (
                <option key={brand.id} value={brand.id}>
                  {brand.name}
                </option>
              ))}
            </select>
          </Field>

          <Field name="categoryId" label="类别" error={errors.categoryId}>
            <select
              id="categoryId"
              name="categoryId"
              required
              defaultValue={product?.categoryId ?? ''}
              className={inputClass}
            >
              <option value="" disabled>
                请选择
              </option>
              {categories.map((category) => (
                <option key={category.id} value={category.id}>
                  {category.parent ? `${category.parent.nameZh} / ` : ''}
                  {category.nameZh}
                </option>
              ))}
            </select>
          </Field>

          <Field name="gender" label="性别归属" hint="通用的会同时出现在男女两个入口">
            <select id="gender" name="gender" defaultValue={product?.gender ?? 'UNISEX'} className={inputClass}>
              <option value="MEN">男</option>
              <option value="WOMEN">女</option>
              <option value="UNISEX">通用</option>
            </select>
          </Field>
        </Card>

        <Card className="space-y-5 p-5">
          <Field
            name="priceCents"
            label="售价（美分）· Premium"
            error={errors.priceCents}
            hint="导入和前台的 Premium 价。Exclusive 自动加 $90–$150；Authentic pre-owned 同这个价。"
          >
            <input
              id="priceCents"
              name="priceCents"
              type="number"
              min={0}
              required
              defaultValue={product?.priceCents}
              className={inputClass}
            />
          </Field>

          <Field name="compareAtCents" label="划线原价（美分）" error={errors.compareAtCents} hint="留空表示不打折">
            <input
              id="compareAtCents"
              name="compareAtCents"
              type="number"
              min={0}
              defaultValue={product?.compareAtCents ?? ''}
              className={inputClass}
            />
          </Field>

          <label className="flex items-center gap-2.5 text-sm">
            <input
              type="checkbox"
              name="featured"
              defaultChecked={product?.featured}
              className="size-4 accent-ink"
            />
            设为主推
          </label>
        </Card>

        <div className="sticky bottom-0 space-y-2 bg-shell py-2">
          {message && <p className="text-xs text-sale">{message}</p>}
          {saved && <p className="text-xs text-emerald-700">已保存</p>}
          <button
            type="submit"
            disabled={pending}
            className="w-full bg-ink py-3 text-sm text-white transition-opacity hover:opacity-85 disabled:opacity-50"
          >
            {pending ? '保存中…' : '保存'}
          </button>
          {product && (
            <div className="flex justify-end pt-1">
              <ProductRowActions
                id={product.id}
                title={product.title}
                status={product.status}
                afterDelete="list"
              />
            </div>
          )}
        </div>
      </div>
    </form>
  )
}

function StockRow({
  variant,
}: {
  variant: { id: string; sku: string; size: string | null; color: string | null; stock: number }
}) {
  const [value, setValue] = useState(String(variant.stock))
  const [state, setState] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle')

  // 库存改动单独提交，不跟商品表单一起走——改一个尺码的数字不该要求整个表单都合法
  function save() {
    if (value === String(variant.stock) && state === 'idle') return
    setState('saving')
    setVariantStock(variant.id, value).then((result) => {
      setState(result.ok ? 'saved' : 'error')
    })
  }

  return (
    <label className="flex items-center justify-between gap-3 border border-line px-3 py-2">
      <span className="min-w-0 text-sm">
        <span className="block truncate">
          {[variant.color, variant.size].filter(Boolean).join(' / ') || '单一规格'}
        </span>
        <span className="block text-xs text-faint">
          {state === 'saving' ? '保存中…' : state === 'saved' ? '已保存' : state === 'error' ? '保存失败' : variant.sku}
        </span>
      </span>
      <input
        type="number"
        min={0}
        value={value}
        onChange={(event) => setValue(event.target.value)}
        onBlur={save}
        className="w-16 shrink-0 border border-line px-2 py-1 text-right text-sm tabular-nums outline-none focus:border-ink"
      />
    </label>
  )
}
