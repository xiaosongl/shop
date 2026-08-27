'use client'

import { useRouter } from 'next/navigation'
import { useEffect, useRef, useState } from 'react'
import { lookupByImage, type ImageSearchState } from '@/lib/actions'
import { ProductCard } from './product-card'

/**
 * 传张图找货：客户从微信收到一张包的照片，直接扔进来就能定位到商品。
 * 认得很准时（同一件商品被压缩、裁切、截屏都还在 0.9 以上）直接跳详情页，
 * 否则按相似度列出来让人自己挑。
 */
export function ImageSearch() {
  const [preview, setPreview] = useState<string | null>(null)
  const [state, setState] = useState<ImageSearchState | null>(null)
  const [busy, setBusy] = useState(false)
  const input = useRef<HTMLInputElement>(null)
  const router = useRouter()

  // 预览用的 object URL 要收回去，不然换几张图就漏几块内存
  useEffect(() => () => void (preview && URL.revokeObjectURL(preview)), [preview])

  async function run(file: File) {
    setBusy(true)
    setState(null)
    setPreview((old) => {
      if (old) URL.revokeObjectURL(old)
      return URL.createObjectURL(file)
    })

    const body = new FormData()
    body.set('image', await shrink(file))
    const result = await lookupByImage(body)

    // 认准了就别让人再点一次
    if (result.kind === 'direct') router.push(`/p/${result.slug}`)
    else setBusy(false)
    setState(result)
  }

  // 从微信/相册复制的图，Ctrl+V 直接搜，省一次存盘再选文件
  useEffect(() => {
    const onPaste = (event: ClipboardEvent) => {
      const file = [...(event.clipboardData?.files ?? [])][0]
      if (file?.type.startsWith('image/')) void run(file)
    }
    window.addEventListener('paste', onPaste)
    return () => window.removeEventListener('paste', onPaste)
  }, [])

  return (
    <section className="mt-10">
      <input
        ref={input}
        type="file"
        accept="image/*"
        className="hidden"
        onChange={(event) => {
          const file = event.target.files?.[0]
          if (file) void run(file)
          // 清掉才能重复选同一张图
          event.target.value = ''
        }}
      />

      <div
        onDragOver={(event) => event.preventDefault()}
        onDrop={(event) => {
          event.preventDefault()
          const file = event.dataTransfer.files[0]
          if (file?.type.startsWith('image/')) void run(file)
        }}
        className="flex flex-col items-center border border-dashed border-line px-6 py-12 text-center"
      >
        {preview ? (
          // 用户自己传的图，尺寸未知，next/image 在这儿没有优势
          // eslint-disable-next-line @next/next/no-img-element
          <img src={preview} alt="" className="mb-5 h-28 w-28 object-cover" />
        ) : (
          <CameraIcon className="mb-4 h-7 w-7 text-faint" />
        )}

        <p className="text-sm text-muted">
          {busy ? 'Looking through the catalogue…' : 'Drop a photo, paste it, or'}
        </p>

        {!busy && (
          <button
            type="button"
            onClick={() => input.current?.click()}
            className="mt-2 border-b border-ink pb-0.5 text-sm transition-opacity hover:opacity-60"
          >
            choose an image
          </button>
        )}
      </div>

      {state && !busy && <Results state={state} />}
    </section>
  )
}

function Results({ state }: { state: ImageSearchState }) {
  if (state.kind === 'error') return <Note>{state.message}</Note>
  if (state.kind === 'none') return <Note>No products look like that photo.</Note>
  if (state.kind === 'unindexed') return <Note>Photo search is not ready yet.</Note>
  if (state.kind === 'direct') return <Note>Found it — taking you there…</Note>

  return (
    <div className="mt-10">
      <p className="text-sm text-muted">
        {state.loose
          ? 'Nothing matches exactly. The closest pieces we carry:'
          : `${state.matches.length} close ${state.matches.length === 1 ? 'match' : 'matches'}`}
      </p>

      <div className="mt-6 grid grid-cols-2 gap-x-4 gap-y-10 md:grid-cols-4">
        {state.matches.map(({ product, score }) => (
          <div key={product.id} className="relative">
            <ProductCard product={product} sizes="(min-width: 768px) 25vw, 50vw" />
            <span className="label-xs pointer-events-none absolute top-3 right-3 bg-white/90 px-2 py-1">
              {Math.round(score * 100)}%
            </span>
          </div>
        ))}
      </div>
    </div>
  )
}

function Note({ children }: { children: React.ReactNode }) {
  return <p className="mt-6 text-sm text-muted">{children}</p>
}

/**
 * 手机直接拍出来的图有四五 MB，先缩到 800px 再传。
 * CLIP 反正只看 224x224，缩了不影响匹配，但在流量上省一大截。
 */
async function shrink(file: File) {
  if (file.size < 500_000) return file
  try {
    const bitmap = await createImageBitmap(file)
    const scale = Math.min(1, 800 / Math.max(bitmap.width, bitmap.height))
    if (scale === 1) return file

    const canvas = document.createElement('canvas')
    canvas.width = Math.round(bitmap.width * scale)
    canvas.height = Math.round(bitmap.height * scale)
    canvas.getContext('2d')?.drawImage(bitmap, 0, 0, canvas.width, canvas.height)
    bitmap.close()

    const blob = await new Promise<Blob | null>((resolve) =>
      canvas.toBlob(resolve, 'image/webp', 0.85),
    )
    return blob ? new File([blob], 'query.webp', { type: 'image/webp' }) : file
  } catch {
    // HEIC 之类浏览器解不开的格式，原样交给服务端，sharp 多半能认
    return file
  }
}

function CameraIcon({ className = 'h-4 w-4' }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" className={className}>
      <path d="M3 8.5A1.5 1.5 0 0 1 4.5 7h2.2l1.1-1.9A1 1 0 0 1 8.7 4.6h6.6a1 1 0 0 1 .9.5L17.3 7h2.2A1.5 1.5 0 0 1 21 8.5v9A1.5 1.5 0 0 1 19.5 19h-15A1.5 1.5 0 0 1 3 17.5z" />
      <circle cx="12" cy="12.8" r="3.4" />
    </svg>
  )
}
