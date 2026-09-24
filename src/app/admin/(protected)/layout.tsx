import type { Metadata } from 'next'
import { redirect } from 'next/navigation'
import { AdminSidebar } from '@/components/admin/sidebar'
import { getAdminRole } from '@/lib/admin-auth'

export const metadata: Metadata = { robots: { index: false, follow: false } }

// 后台数据改完要立刻能看到，不留缓存
export const dynamic = 'force-dynamic'

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  // 鉴权放在布局里，不放 middleware：middleware 跑在 edge 运行时，
  // 用不了 node:crypto 的 HMAC 校验。登录页不在这个布局下，不会打转。
  const role = await getAdminRole()
  if (!role) redirect('/admin/login')

  return (
    <div className="min-h-screen bg-shell md:flex">
      <AdminSidebar role={role} />
      <main className="min-w-0 flex-1 px-5 py-8 md:px-10">{children}</main>
    </div>
  )
}
