'use client'

import { usePathname, useSearchParams } from 'next/navigation'
import { useEffect, useState } from 'react'

/**
 * 移动端筛选抽屉。里面的内容是服务端渲染好的 children 直接塞进来的，
 * 所以筛选项本身仍然是普通链接，这个组件只负责开合。
 */
export function FilterDrawer({ count, children }: { count: number; children: React.ReactNode }) {
  const [open, setOpen] = useState(false)
  const pathname = usePathname()
  const searchParams = useSearchParams()

  // 选了条件跳转后自动关闭
  useEffect(() => setOpen(false), [pathname, searchParams])

  useEffect(() => {
    if (!open) return
    const previous = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      document.body.style.overflow = previous
    }
  }, [open])

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="label-xs flex min-h-11 items-center lg:hidden"
      >
        Filter{count > 0 ? ` (${count})` : ''}
      </button>

      {open && (
        <div className="fixed inset-0 z-50 lg:hidden">
          <button
            type="button"
            aria-label="Close filters"
            onClick={() => setOpen(false)}
            className="absolute inset-0 bg-ink/20"
          />
          <div className="absolute inset-x-0 bottom-0 max-h-[85vh] overflow-y-auto bg-white">
            <div className="sticky top-0 flex items-center justify-between border-b border-line bg-white px-5 py-4">
              <span className="label-xs">Filter</span>
              <button type="button" onClick={() => setOpen(false)} aria-label="Close filters" className="-mr-2 p-2">
                <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden>
                  <path d="M1 1l14 14M15 1L1 15" stroke="currentColor" strokeWidth="1.25" />
                </svg>
              </button>
            </div>
            <div className="px-5 py-7">{children}</div>
          </div>
        </div>
      )}
    </>
  )
}
