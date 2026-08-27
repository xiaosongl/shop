'use client'

import { useEffect, useRef, useState } from 'react'

/**
 * 首页的横向商品栏，两端两套逻辑。
 *
 * 手机端露出下一张的一角，用手指滑就行。桌面端反过来：半张卡卡在右边缘看着
 * 像图没加载完，而鼠标又没有顺手的横滑手势，滚动条还是藏起来的 —— 等于给了
 * 一屏内容却没给出口。所以桌面端排成整数张，翻页交给箭头。
 *
 * 「一页」直接取容器宽度，成立的前提是 RailItem 的宽度按
 * (100% - 若干个间距) / 每屏张数 算出来、正好铺满一屏。这两处必须一起改。
 */
export function Rail({
  title,
  note,
  children,
}: {
  title: string
  note?: string
  children: React.ReactNode
}) {
  const scroller = useRef<HTMLDivElement>(null)
  // 先按「能滑、在最左、右边还有」渲染：桌面端每栏都超过一屏，这就是稳态，
  // 服务端和水合后的第一帧对得上，箭头不会闪一下才出来
  const [nav, setNav] = useState({ scrollable: true, start: true, end: false })

  useEffect(() => {
    const node = scroller.current
    if (!node) return

    const sync = () => {
      const max = node.scrollWidth - node.clientWidth
      // 留 1px 余量：卡片宽度是算出来的小数，浏览器缩放时 scrollLeft 到不了整数两端
      setNav({
        scrollable: max > 1,
        start: node.scrollLeft <= 1,
        end: node.scrollLeft >= max - 1,
      })
    }

    sync()
    node.addEventListener('scroll', sync, { passive: true })
    // 跨断点时每屏张数会变，总页数跟着变，只听 scroll 是不够的
    const observer = new ResizeObserver(sync)
    observer.observe(node)

    return () => {
      node.removeEventListener('scroll', sync)
      observer.disconnect()
    }
  }, [])

  const page = (direction: 1 | -1) => {
    const node = scroller.current
    node?.scrollBy({ left: direction * node.clientWidth, behavior: 'smooth' })
  }

  return (
    <section className="pt-12 md:pt-16">
      <div className="flex items-baseline justify-between gap-3">
        <h2 className="text-lg tracking-tight md:text-2xl">{title}</h2>

        <div className="flex items-baseline gap-4">
          {note && <span className="label-xs text-faint">{note}</span>}

          {nav.scrollable && (
            <div className="hidden gap-1.5 self-center md:flex">
              <Arrow side="left" title={title} onClick={() => page(-1)} disabled={nav.start} />
              <Arrow side="right" title={title} onClick={() => page(1)} disabled={nav.end} />
            </div>
          )}
        </div>
      </div>

      {/* 手机端负 margin + padding：卡片贴着屏幕边缘滑出去，不在容器内缘生硬切断。
          scroll-pl 必须跟着 px 一起给：吸附对齐的是 padding box，不补这一下
          第一张卡会被吸到 x=0，跟上面的标题差 20px，看着像没对齐 */}
      <div
        ref={scroller}
        className="no-scrollbar -mx-5 mt-5 flex snap-x snap-mandatory scroll-pl-5 gap-3 overflow-x-auto px-5 md:mx-0 md:scroll-pl-0 md:gap-6 md:px-0"
      >
        {children}
      </div>
    </section>
  )
}

/**
 * 手机端按 42vw 给宽度，露出两张半，滑动的余地看得见。
 * 桌面端按每屏张数整除容器宽：md 三张、lg 四张、xl 五张，
 * 三档算下来卡片都在 227px 上下，跨断点看不出跳变。间距是 gap-6 = 1.5rem。
 */
export function RailItem({ children }: { children: React.ReactNode }) {
  return (
    <div className="w-[42vw] shrink-0 snap-start sm:w-44 md:w-[calc((100%_-_2_*_1.5rem)/3)] lg:w-[calc((100%_-_3_*_1.5rem)/4)] xl:w-[calc((100%_-_4_*_1.5rem)/5)]">
      {children}
    </div>
  )
}

function Arrow({
  side,
  title,
  onClick,
  disabled,
}: {
  side: 'left' | 'right'
  title: string
  onClick: () => void
  disabled: boolean
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-label={`${side === 'left' ? 'Previous' : 'Next'} ${title.toLowerCase()}`}
      className="flex h-8 w-8 items-center justify-center border border-line text-ink transition-colors hover:border-ink disabled:pointer-events-none disabled:opacity-25"
    >
      <svg
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.5"
        className="h-3.5 w-3.5"
        aria-hidden
      >
        <path d={side === 'left' ? 'M15 5l-7 7 7 7' : 'M9 5l7 7-7 7'} />
      </svg>
    </button>
  )
}
