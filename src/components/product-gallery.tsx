'use client'

import Image from 'next/image'
import { useEffect, useRef, useState, type PointerEvent } from 'react'

type GalleryImage = { url: string; blurDataUrl: string; alt: string }
type Slide =
  | { kind: 'video'; url: string; poster: string }
  | { kind: 'image'; url: string; blurDataUrl: string; alt: string }

/**
 * 叠层淡入淡出，跟商品卡 hover 同一套 duration-500。
 * 以前用横滑 + snap + smooth scroll，三者会打架，切下一张闪一下。
 * 有视频时排在第一张，没有就还是纯图。
 */
export function ProductGallery({
  images,
  videoUrl,
}: {
  images: GalleryImage[]
  videoUrl?: string | null
}) {
  const slides: Slide[] = [
    ...(videoUrl ? [{ kind: 'video' as const, url: videoUrl, poster: images[0]?.url ?? '' }] : []),
    ...images.map((image) => ({ kind: 'image' as const, ...image })),
  ]
  const [active, setActive] = useState(0)
  const [open, setOpen] = useState(false)
  const root = useRef<HTMLDivElement>(null)
  const last = slides.length - 1
  const showingVideo = slides[active]?.kind === 'video'
  const originX = useRef<number | null>(null)
  const dragged = useRef(false)

  const go = (index: number) => setActive(Math.min(Math.max(index, 0), last))

  const onPointerDown = (event: PointerEvent<HTMLDivElement>) => {
    if ((event.target as HTMLElement).closest('video')) return
    originX.current = event.clientX
    dragged.current = false
  }

  const onPointerMove = (event: PointerEvent<HTMLDivElement>) => {
    if (originX.current == null) return
    if (Math.abs(event.clientX - originX.current) <= 8) return
    dragged.current = true
    event.currentTarget.setPointerCapture(event.pointerId)
  }

  const onPointerUp = (event: PointerEvent<HTMLDivElement>) => {
    if (originX.current == null) return
    const dx = event.clientX - originX.current
    originX.current = null
    if (dx < -40) go(active + 1)
    else if (dx > 40) go(active - 1)
  }

  useEffect(() => {
    if (showingVideo) return
    root.current?.querySelector('video')?.pause()
  }, [showingVideo])

  useEffect(() => {
    if (!open) return
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false)
      if (event.key === 'ArrowLeft') go(active - 1)
      if (event.key === 'ArrowRight') go(active + 1)
    }
    const previous = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    window.addEventListener('keydown', onKey)
    return () => {
      document.body.style.overflow = previous
      window.removeEventListener('keydown', onKey)
    }
    // go 读的是当次渲染的 active
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, active, last])

  if (!slides.length) return null

  return (
    <div ref={root} className="relative">
      <div
        role="group"
        aria-label="Product images"
        aria-roledescription="carousel"
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={() => {
          originX.current = null
        }}
        className="relative aspect-3/4 touch-pan-y overflow-hidden bg-shell select-none"
      >
        <Slides slides={slides} active={active} sizes="(min-width: 1320px) 790px, (min-width: 768px) 55vw, 100vw" />
        {!showingVideo && (
          <button
            type="button"
            onClick={() => {
              if (dragged.current) return
              setOpen(true)
            }}
            aria-label="View full size"
            className="absolute inset-0 cursor-zoom-in"
          />
        )}
      </div>

      {slides.length > 1 && (
        <>
          <Arrow side="left" onClick={() => go(active - 1)} disabled={active === 0} />
          <Arrow side="right" onClick={() => go(active + 1)} disabled={active === last} />

          <div className="mt-3 flex justify-center gap-1.5">
            {slides.map((slide, index) => (
              <button
                key={slide.kind === 'video' ? `video:${slide.url}` : slide.url}
                type="button"
                onClick={() => go(index)}
                aria-label={slide.kind === 'video' ? 'Play video' : `View image ${index + 1}`}
                aria-current={index === active}
                className={`h-0.5 w-6 transition-colors ${index === active ? 'bg-ink' : 'bg-line'}`}
              />
            ))}
          </div>
        </>
      )}

      {open && (
        <div
          className="fixed inset-0 z-50 bg-white"
          role="dialog"
          aria-modal="true"
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerCancel={() => {
            originX.current = null
          }}
        >
          <button
            type="button"
            onClick={() => setOpen(false)}
            aria-label="Close"
            className="absolute top-4 right-4 z-10 flex h-11 w-11 items-center justify-center text-ink"
          >
            <svg viewBox="0 0 16 16" fill="none" className="h-4 w-4" aria-hidden>
              <path d="M1 1l14 14M15 1L1 15" stroke="currentColor" strokeWidth="1.25" />
            </svg>
          </button>
          <div className="relative h-full w-full">
            <Slides slides={slides} active={active} sizes="100vw" />
          </div>
          {slides.length > 1 && (
            <>
              <Arrow side="left" always onClick={() => go(active - 1)} disabled={active === 0} />
              <Arrow side="right" always onClick={() => go(active + 1)} disabled={active === last} />
            </>
          )}
        </div>
      )}
    </div>
  )
}

function Slides({ slides, active, sizes }: { slides: Slide[]; active: number; sizes: string }) {
  return slides.map((slide, index) => {
    const shown = index === active
    const fade = `object-contain transition-opacity duration-500 ease-out motion-reduce:transition-none ${
      shown ? 'opacity-100' : 'pointer-events-none opacity-0'
    }`
    if (slide.kind === 'video') {
      return (
        <video
          key={`video:${slide.url}`}
          src={slide.url}
          poster={slide.poster || undefined}
          controls
          playsInline
          preload="metadata"
          className={`absolute inset-0 h-full w-full bg-shell ${fade}`}
        />
      )
    }
    return (
      <Image
        key={slide.url}
        src={slide.url}
        alt={shown ? slide.alt : ''}
        fill
        priority={index < 2}
        loading={index < 2 ? undefined : 'eager'}
        sizes={sizes}
        placeholder="blur"
        blurDataURL={slide.blurDataUrl}
        className={fade}
      />
    )
  })
}

function Arrow({
  side,
  onClick,
  disabled,
  always = false,
}: {
  side: 'left' | 'right'
  onClick: () => void
  disabled: boolean
  always?: boolean
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-label={side === 'left' ? 'Previous image' : 'Next image'}
      className={`absolute top-1/2 z-10 h-10 w-10 -translate-y-1/2 items-center justify-center bg-white/85 text-ink transition-opacity duration-200 hover:bg-white disabled:pointer-events-none disabled:opacity-0 ${
        always ? 'flex' : 'hidden md:flex'
      } ${side === 'left' ? 'left-4' : 'right-4'}`}
    >
      <svg
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.5"
        className="h-4 w-4"
        aria-hidden
      >
        <path d={side === 'left' ? 'M15 5l-7 7 7 7' : 'M9 5l7 7-7 7'} />
      </svg>
    </button>
  )
}
