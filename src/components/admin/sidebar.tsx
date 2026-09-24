'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { logout } from '@/lib/admin-actions'

const LINKS = [
  { href: '/admin', label: '概览', roles: ['admin', 'staff'] },
  { href: '/admin/orders', label: '订单', roles: ['admin', 'staff'] },
  { href: '/admin/products', label: '商品', roles: ['admin', 'staff'] },
  { href: '/admin/brands', label: '品牌', roles: ['admin'] },
  { href: '/admin/appearance', label: '站点文案', roles: ['admin'] },
  { href: '/admin/policies', label: '政策条款', roles: ['admin'] },
  { href: '/admin/payments', label: '收款配置', roles: ['admin'] },
] as const

export function AdminSidebar({ role }: { role: 'admin' | 'staff' }) {
  const pathname = usePathname()
  const links = LINKS.filter((link) => link.roles.includes(role))

  return (
    <aside className="shrink-0 border-line bg-white md:w-52 md:border-r">
      <div className="flex items-center justify-between border-b border-line px-5 py-4 md:block md:py-6">
        <div>
          <p className="text-sm font-medium tracking-[0.18em] uppercase">Northsound</p>
          <p className="mt-0.5 text-xs text-faint">{role === 'staff' ? '员工' : '后台管理'}</p>
        </div>
        <form action={logout} className="md:hidden">
          <button type="submit" className="text-xs text-faint hover:text-ink">
            退出
          </button>
        </form>
      </div>

      <nav className="no-scrollbar flex gap-1 overflow-x-auto px-3 py-3 md:flex-col md:px-3 md:py-4">
        {links.map((link) => {
          const active =
            link.href === '/admin' ? pathname === '/admin' : pathname.startsWith(link.href)
          return (
            <Link
              key={link.href}
              href={link.href}
              aria-current={active ? 'page' : undefined}
              className={`shrink-0 px-3 py-2 text-sm whitespace-nowrap transition-colors ${
                active ? 'bg-ink text-white' : 'text-muted hover:bg-shell hover:text-ink'
              }`}
            >
              {link.label}
            </Link>
          )
        })}
      </nav>

      <form action={logout} className="hidden px-3 md:block">
        <button
          type="submit"
          className="w-full px-3 py-2 text-left text-sm text-faint hover:text-ink"
        >
          退出登录
        </button>
      </form>
    </aside>
  )
}
