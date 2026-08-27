'use client'

import { useState } from 'react'
import { imageField } from '@/lib/showcase'

/**
 * 单张封面图的上传控件。品牌和首页展示位共用。
 *
 * 选完文件立刻用 object URL 出预览——上传要经 sharp 处理几百毫秒，
 * 没有即时反馈的话运营会以为没选上，然后重复点。
 */
export function ImageField({
  name,
  label,
  hint,
  current,
}: {
  name: string
  label: string
  hint?: string
  current?: string | null
}) {
  const [preview, setPreview] = useState<string | null>(null)
  const [cleared, setCleared] = useState(false)

  const field = imageField(name)
  const shown = preview ?? (cleared ? null : (current ?? null))

  return (
    <div>
      <p className="text-xs text-faint">{label}</p>

      <div className="mt-2 flex items-start gap-4">
        <div className="relative aspect-4/5 w-24 shrink-0 overflow-hidden border border-line bg-shell">
          {shown ? (
            // 刚选的文件是 blob: 地址，next/image 走不了，这里用原生 img
            <img src={shown} alt="" className="size-full object-cover" />
          ) : (
            <span className="flex size-full items-center justify-center text-center text-[10px] leading-tight text-faint">
              未设置
              <br />
              用商品图
            </span>
          )}
        </div>

        <div className="min-w-0 flex-1">
          <input
            type="file"
            name={field.file}
            accept="image/*"
            onChange={(event) => {
              const file = event.target.files?.[0]
              setPreview(file ? URL.createObjectURL(file) : null)
              if (file) setCleared(false)
            }}
            className="w-full text-sm file:mr-3 file:border file:border-line file:bg-white file:px-3 file:py-1.5 file:text-sm"
          />
          <p className="mt-2 text-xs leading-relaxed text-faint">
            {hint ?? '建议竖构图，会自动裁成 3:4 并生成多档尺寸'}
          </p>

          {current && (
            <label className="mt-2 flex items-center gap-2 text-xs text-faint">
              <input
                type="checkbox"
                name={field.clear}
                checked={cleared}
                onChange={(event) => {
                  setCleared(event.target.checked)
                  if (event.target.checked) setPreview(null)
                }}
                className="size-3.5 accent-ink"
              />
              移除封面，改回自动用商品图
            </label>
          )}
        </div>
      </div>
    </div>
  )
}
