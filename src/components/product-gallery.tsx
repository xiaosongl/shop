'use client'

import Image from 'next/image'
import { useRef, useState } from 'react'

type GalleryImage = { url: string; blurDataUrl: string; alt: string }

/**
 * 一个画框，左右翻。移动端靠原生滑动，桌面端靠两侧箭头，底下共用一排指示条。
 * 两端共用同一个 scroll-snap 容器，翻页就是把容器横向滚一屏，不用自己算位移或做动画。
 *
 * 不给图片设高度上限：一设上限 object-cover 就要裁画面，鞋和包很容易被切掉一截。
 * 固定 3:4，图始终是完整的。
 */
export function ProductGallery({ images }: { images: GalleryImage[] }) {
  const scroller = useRef<HTMLDivElement>(null)
  const [active, setActive] = useState(0)
  const last = images.length - 1

  const scrollTo = (index: number) => {
    const node = scroller.current
    if (!node) return
    const target = Math.min(Math.max(index, 0), last)
    node.scrollTo({ left: node.clientWidth * target, behavior: 'smooth' })
  }

  const onScroll = () => {
    const node = scroller.current
    if (!node) return
    const index = Math.round(node.scrollLeft / node.clientWidth)
    if (index !== active) setActive(index)
  }

  return (
    <div className="relative">
      <div
        ref={scroller}
        onScroll={onScroll}
        role="group"
        aria-label="Product images"
        className="no-scrollbar flex snap-x snap-mandatory overflow-x-auto"
      >
        {images.map((image, index) => (
          <div key={image.url} className="relative aspect-3/4 w-full shrink-0 snap-center bg-shell">
            <Image
              src={image.url}
              alt={image.alt}
              fill
              // 第一张是详情页的 LCP，必须优先；后面的交给懒加载
              priority={index === 0}
              sizes="(min-width: 1320px) 790px, (min-width: 768px) 55vw, 100vw"
              placeholder="blur"
              blurDataURL={image.blurDataUrl}
              className="object-cover"
            />
          </div>
        ))}
      </div>

      {images.length > 1 && (
        <>
          {/* 箭头只给桌面：手机上原生滑动更顺手，按钮反而挡图 */}
          <Arrow side="left" onClick={() => scrollTo(active - 1)} disabled={active === 0} />
          <Arrow side="right" onClick={() => scrollTo(active + 1)} disabled={active === last} />

          <div className="mt-3 flex justify-center gap-1.5">
            {images.map((image, index) => (
              <button
                key={image.url}
                type="button"
                onClick={() => scrollTo(index)}
                aria-label={`View image ${index + 1}`}
                aria-current={index === active}
                className={`h-0.5 w-6 transition-colors ${index === active ? 'bg-ink' : 'bg-line'}`}
              />
            ))}
          </div>
        </>
      )}
    </div>
  )
}

function Arrow({
  side,
  onClick,
  disabled,
}: {
  side: 'left' | 'right'
  onClick: () => void
  disabled: boolean
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-label={side === 'left' ? 'Previous image' : 'Next image'}
      className={`absolute top-1/2 hidden h-10 w-10 -translate-y-1/2 items-center justify-center bg-white/85 text-ink transition-opacity duration-200 hover:bg-white disabled:pointer-events-none disabled:opacity-0 md:flex ${
        side === 'left' ? 'left-4' : 'right-4'
      }`}
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
