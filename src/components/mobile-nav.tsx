'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { useEffect, useState } from 'react'
import type { BrandLink } from './site-nav'

export function MobileNav({ brands }: { brands: BrandLink[] }) {
  const [open, setOpen] = useState(false)
  const pathname = usePathname()

  // 跳转后自动收起，否则返回时抽屉还开着
  useEffect(() => setOpen(false), [pathname])

  // 抽屉打开时锁掉背景滚动
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
        aria-label="Open menu"
        className="-ml-2 p-2 md:hidden"
      >
        <svg width="18" height="18" viewBox="0 0 18 18" fill="none" aria-hidden>
          <path d="M1 4h16M1 9h16M1 14h16" stroke="currentColor" strokeWidth="1.25" />
        </svg>
      </button>

      {open && (
        <div className="fixed inset-0 z-50 md:hidden">
          <button
            type="button"
            aria-label="Close menu"
            onClick={() => setOpen(false)}
            className="absolute inset-0 bg-ink/20"
          />
          <div className="absolute inset-y-0 left-0 flex w-[85%] max-w-sm flex-col bg-white">
            <div className="flex h-14 items-center justify-between border-b border-line px-5">
              <span className="label-xs">Menu</span>
              <button
                type="button"
                onClick={() => setOpen(false)}
                aria-label="Close menu"
                className="-mr-2 p-2"
              >
                <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden>
                  <path d="M1 1l14 14M15 1L1 15" stroke="currentColor" strokeWidth="1.25" />
                </svg>
              </button>
            </div>

            <nav className="flex-1 overflow-y-auto px-5 py-6">
              <form action="/search">
                <input
                  name="q"
                  type="search"
                  placeholder="Search"
                  className="w-full border-b border-line bg-transparent pb-2 text-sm outline-none placeholder:text-faint focus:border-ink"
                />
              </form>

              <Link href="/search" className="mt-3 mb-8 block text-sm text-muted">
                Search by photo
              </Link>

              <Link href="/new" className="mb-4 block text-sm text-muted">
                New arrivals
              </Link>

              <Link href="/grades" className="mb-6 block text-sm text-muted">
                Our grades
              </Link>

              <Link href="/brands" className="label-xs text-faint">
                All {brands.length} brands
              </Link>

              <ul className="mt-2">
                {brands.map((brand) => (
                  <li key={brand.slug}>
                    <Link href={`/brands/${brand.slug}`} className="flex min-h-11 items-center text-[15px]">
                      {brand.name}
                    </Link>
                  </li>
                ))}
              </ul>
            </nav>

            <Link href="/orders" className="border-t border-line px-5 py-4 text-sm text-muted hover:text-ink">
              Track your order
            </Link>
          </div>
        </div>
      )}
    </>
  )
}
