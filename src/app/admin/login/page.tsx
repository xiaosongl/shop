import type { Metadata } from 'next'
import { redirect } from 'next/navigation'
import { LoginForm } from '@/components/admin/login-form'
import { isAuthenticated } from '@/lib/admin-auth'

export const metadata: Metadata = { title: '后台登录', robots: { index: false, follow: false } }

export default async function AdminLoginPage() {
  if (await isAuthenticated()) redirect('/admin')

  return (
    <div className="flex min-h-screen items-center justify-center bg-shell px-5">
      <div className="w-full max-w-sm border border-line bg-white p-8">
        <p className="text-base font-medium tracking-[0.18em] uppercase">Northsound</p>
        <h1 className="mt-1 text-sm text-muted">后台管理</h1>
        <LoginForm />
      </div>
    </div>
  )
}
