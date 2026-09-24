'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import type { ReactNode } from 'react'
import { useCart } from '@/lib/cart'

/**
 * 手机端底部导航。免税店那类站点的标配：主要入口钉在拇指够得着的地方，
 * 不用每次滑回顶部去点汉堡菜单。桌面端不出现，那边顶部导航一直在视野里。
 *
 * z-40 跟页头同级：抽屉（导航、筛选）都是 z-50，会正常盖在它上面。
 */
export function BottomNav() {
  const pathname = usePathname()
  const { count, ready, drawerOpen, openCart } = useCart()

  const at = (prefix: string) => pathname === prefix || pathname.startsWith(prefix + '/')

  const items = [
    { href: '/', label: 'Home', Icon: HomeIcon, active: pathname === '/' },
    { href: '/brands', label: 'Shop', Icon: GridIcon, active: at('/brands') },
    { href: '/search', label: 'Search', Icon: SearchIcon, active: at('/search') },
    { href: '/cart', label: 'Cart', Icon: BagIcon, active: drawerOpen || at('/cart'), badge: true },
    // 访客不注册账号，查单就是他们的「我的」
    { href: '/orders', label: 'Orders', Icon: BoxIcon, active: at('/orders') || at('/order') },
  ]

  return (
    <nav
      aria-label="Quick navigation"
      // 底部安全区：iPhone 的小黑条会压掉一截，不垫的话文字贴在横条上
      className="fixed inset-x-0 bottom-0 z-40 border-t border-line bg-white pb-[env(safe-area-inset-bottom)] md:hidden"
    >
      <ul className="flex">
        {items.map(({ href, label, Icon, active, badge }) => (
          <li key={label} className="flex-1">
            {label === 'Cart' ? (
              <button
                type="button"
                onClick={openCart}
                aria-current={active ? 'page' : undefined}
                className={`flex h-14 w-full flex-col items-center justify-center gap-1 transition-colors ${
                  active ? 'text-ink' : 'text-faint'
                }`}
              >
                <TabIcon Icon={Icon} label={label} badge={badge} ready={ready} count={count} />
              </button>
            ) : (
              <Link
                href={href}
                aria-current={active ? 'page' : undefined}
                className={`flex h-14 flex-col items-center justify-center gap-1 transition-colors ${
                  active ? 'text-ink' : 'text-faint'
                }`}
              >
                <TabIcon Icon={Icon} label={label} badge={badge} ready={ready} count={count} />
              </Link>
            )}
          </li>
        ))}
      </ul>
    </nav>
  )
}

function TabIcon({
  Icon,
  label,
  badge,
  ready,
  count,
}: {
  Icon: () => ReactNode
  label: string
  badge?: boolean
  ready: boolean
  count: number
}) {
  return (
    <>
      <span className="relative">
        <Icon />
        {badge && ready && count > 0 && (
          <span className="absolute -top-1 -right-2 min-w-4 rounded-full bg-ink px-1 text-center text-[10px] leading-4 text-white tabular-nums">
            {count > 99 ? '99+' : count}
          </span>
        )}
      </span>
      <span className="text-[10px] tracking-[0.04em]">{label}</span>
    </>
  )
}

// 线条粗细和视觉重量跟页头那个相机图标对齐，别一眼看出是两批画的
function Icon({ children }: { children: React.ReactNode }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      className="h-[19px] w-[19px]"
      aria-hidden
    >
      {children}
    </svg>
  )
}

function HomeIcon() {
  return (
    <Icon>
      <path d="M3.5 9.8 12 3.4l8.5 6.4V20a.8.8 0 0 1-.8.8h-4.6v-6h-6.2v6H4.3a.8.8 0 0 1-.8-.8z" />
    </Icon>
  )
}

function GridIcon() {
  return (
    <Icon>
      <path d="M4 4h6.2v6.2H4zM13.8 4H20v6.2h-6.2zM4 13.8h6.2V20H4zM13.8 13.8H20V20h-6.2z" />
    </Icon>
  )
}

function SearchIcon() {
  return (
    <Icon>
      <circle cx="10.8" cy="10.8" r="6.3" />
      <path d="m15.5 15.5 4.1 4.1" />
    </Icon>
  )
}

function BagIcon() {
  return (
    <Icon>
      <path d="M5.6 7.8h12.8l.9 12.4H4.7zM9 7.8V6.2a3 3 0 0 1 6 0v1.6" />
    </Icon>
  )
}

function BoxIcon() {
  return (
    <Icon>
      <path d="M3.6 7.7 12 3.5l8.4 4.2v8.6L12 20.5l-8.4-4.2z" />
      <path d="M3.6 7.7 12 11.9l8.4-4.2M12 11.9v8.6" />
    </Icon>
  )
}
