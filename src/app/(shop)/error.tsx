'use client'

import Link from 'next/link'

/**
 * 前台的错误边界。不把 error.message 显示给访客——
 * 那里面可能带数据库路径之类的内部信息，digest 足够对着服务端日志排查。
 */
export default function ShopError({
  error,
  reset,
}: {
  error: Error & { digest?: string }
  reset: () => void
}) {
  return (
    <div className="mx-auto flex max-w-md flex-col items-center px-5 py-28 text-center">
      <h1 className="text-2xl">Something went wrong</h1>
      <p className="mt-2 text-sm leading-relaxed text-muted">
        Please try again. If it keeps happening, contact us on WhatsApp and we’ll sort it out.
      </p>
      <div className="mt-8 flex gap-3">
        <button
          type="button"
          onClick={reset}
          className="bg-ink px-6 py-3 text-sm text-white transition-opacity hover:opacity-85"
        >
          Try again
        </button>
        <Link
          href="/"
          className="border border-line px-6 py-3 text-sm transition-colors hover:border-ink"
        >
          Home
        </Link>
      </div>
      {error.digest && <p className="mt-8 text-xs text-faint">Reference {error.digest}</p>}
    </div>
  )
}
