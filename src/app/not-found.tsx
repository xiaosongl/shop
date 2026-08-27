import Link from 'next/link'

// 兜底 404：没匹配上任何路由段时走这里，此时店铺布局还没挂上，所以自带样式
export default function NotFound() {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center px-5 text-center">
      <p className="label-xs text-faint">404</p>
      <h1 className="mt-3 text-2xl">This page doesn’t exist</h1>
      <p className="mt-2 text-sm text-muted">The link may be outdated or mistyped.</p>
      <Link
        href="/"
        className="mt-8 bg-ink px-6 py-3 text-sm text-white transition-opacity hover:opacity-85"
      >
        Back to Northsound
      </Link>
    </div>
  )
}
