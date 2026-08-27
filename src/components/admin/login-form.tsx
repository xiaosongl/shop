'use client'

import { useState, useTransition } from 'react'
import { login } from '@/lib/admin-actions'

export function LoginForm() {
  const [pending, startTransition] = useTransition()
  const [error, setError] = useState<string | null>(null)

  function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const form = Object.fromEntries(new FormData(event.currentTarget))
    setError(null)
    startTransition(async () => {
      // 成功时 login 内部会 redirect，这里只可能收到错误
      const result = await login(form)
      if (result?.error) setError(result.error)
    })
  }

  return (
    <form onSubmit={onSubmit} className="mt-8 space-y-5">
      <div>
        <label htmlFor="username" className="text-xs text-faint">
          账号
        </label>
        <input
          id="username"
          name="username"
          required
          autoComplete="username"
          className="mt-1.5 w-full border-b border-line bg-transparent pb-2 text-[15px] outline-none focus:border-ink"
        />
      </div>
      <div>
        <label htmlFor="password" className="text-xs text-faint">
          密码
        </label>
        <input
          id="password"
          name="password"
          type="password"
          required
          autoComplete="current-password"
          className="mt-1.5 w-full border-b border-line bg-transparent pb-2 text-[15px] outline-none focus:border-ink"
        />
      </div>

      {error && <p className="text-sm text-sale">{error}</p>}

      <button
        type="submit"
        disabled={pending}
        className="w-full bg-ink py-3 text-sm text-white transition-opacity hover:opacity-85 disabled:opacity-50"
      >
        {pending ? '登录中…' : '登录'}
      </button>
    </form>
  )
}
