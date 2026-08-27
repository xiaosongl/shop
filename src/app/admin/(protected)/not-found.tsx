import Link from 'next/link'

export default function AdminNotFound() {
  return (
    <div className="py-24 text-center">
      <h1 className="text-lg">没有找到这条记录</h1>
      <p className="mt-2 text-sm text-muted">可能已被删除，或者地址不对。</p>
      <Link href="/admin" className="mt-6 inline-block text-sm underline">
        回到概览
      </Link>
    </div>
  )
}
