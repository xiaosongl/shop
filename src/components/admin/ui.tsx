import Link from 'next/link'
import { ORDER_STATUS_ZH } from '@/lib/order-status'

export function PageHeader({
  title,
  count,
  action,
}: {
  title: string
  count?: string
  action?: React.ReactNode
}) {
  return (
    <div className="mb-6 flex flex-wrap items-baseline justify-between gap-3">
      <h1 className="text-xl">
        {title}
        {count && <span className="ml-3 text-sm text-faint">{count}</span>}
      </h1>
      {action}
    </div>
  )
}

export function Card({ children, className = '' }: { children: React.ReactNode; className?: string }) {
  return <div className={`border border-line bg-white ${className}`}>{children}</div>
}

export function Stat({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <Card className="p-5">
      <p className="text-xs text-faint">{label}</p>
      <p className="mt-2 text-2xl tabular-nums">{value}</p>
      {hint && <p className="mt-1 text-xs text-faint">{hint}</p>}
    </Card>
  )
}

const STATUS_STYLE: Record<string, string> = {
  PENDING: 'bg-amber-100 text-amber-900',
  PAID: 'bg-emerald-100 text-emerald-900',
  READY: 'bg-violet-100 text-violet-900',
  SHIPPED: 'bg-sky-100 text-sky-900',
  COMPLETED: 'bg-neutral-900 text-white',
  CANCELLED: 'bg-neutral-200 text-neutral-600',
  ACTIVE: 'bg-emerald-100 text-emerald-900',
  DRAFT: 'bg-amber-100 text-amber-900',
  ARCHIVED: 'bg-neutral-200 text-neutral-600',
}

export const STATUS_LABEL: Record<string, string> = {
  // 订单状态从状态机那边取，加了新状态不用记得回来补名字
  ...ORDER_STATUS_ZH,
  ACTIVE: '在售',
  DRAFT: '草稿',
  ARCHIVED: '已下架',
  MEN: '男',
  WOMEN: '女',
  UNISEX: '通用',
  boxed: '带盒带发票',
  discreet: '隐私包装',
  crypto: '加密货币',
  whatsapp: 'WhatsApp / Messenger',
}

export function Badge({ value }: { value: string }) {
  return (
    <span className={`inline-block px-2 py-0.5 text-xs ${STATUS_STYLE[value] ?? 'bg-neutral-200'}`}>
      {STATUS_LABEL[value] ?? value}
    </span>
  )
}

export function Table({ head, children }: { head: string[]; children: React.ReactNode }) {
  return (
    <Card className="overflow-x-auto">
      <table className="w-full min-w-[46rem] text-sm">
        <thead>
          <tr className="border-b border-line text-left">
            {head.map((cell) => (
              <th key={cell} className="px-4 py-3 text-xs font-normal text-faint">
                {cell}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-line">{children}</tbody>
      </table>
    </Card>
  )
}

export function Empty({ children }: { children: React.ReactNode }) {
  return <p className="px-4 py-16 text-center text-sm text-faint">{children}</p>
}

export function queryFrom(value: string | undefined) {
  return value?.trim() ?? ''
}

/** 后台列表共用的搜索条。GET 提交，翻页时靠 Pager 把 q 带着走。 */
export function Search({
  action,
  q,
  keep,
  placeholder,
}: {
  action: string
  q: string
  keep?: Record<string, string | undefined>
  placeholder: string
}) {
  const clear = new URLSearchParams()
  for (const [key, value] of Object.entries(keep ?? {})) if (value) clear.set(key, value)
  const clearHref = clear.toString() ? `${action}?${clear}` : action

  return (
    <form method="get" action={action} className="mb-5 flex flex-wrap items-center gap-2">
      {Object.entries(keep ?? {}).map(([key, value]) =>
        value ? <input key={key} type="hidden" name={key} value={value} /> : null,
      )}
      <input
        name="q"
        defaultValue={q}
        placeholder={placeholder}
        className="w-full max-w-sm border border-line bg-white px-3 py-2 text-sm outline-none focus:border-ink"
      />
      <button
        type="submit"
        className="border border-line bg-white px-3 py-2 text-sm text-muted transition-colors hover:border-ink"
      >
        搜索
      </button>
      {q ? (
        <Link href={clearHref} className="text-sm text-faint hover:text-ink">
          清除
        </Link>
      ) : null}
    </form>
  )
}

export const PAGE_SIZE = 20

/**
 * 把地址栏里的 ?page= 变成能直接喂给 Prisma 的 skip/take。
 *
 * 夹在 1..总页数 之间：删到最后一页空了、或者有人手改地址栏，
 * 都退到最后一页而不是给一张空表。
 */
export function pageFrom(value: string | undefined, total: number, size = PAGE_SIZE) {
  const pages = Math.max(1, Math.ceil(total / size))
  // Number(undefined) 和 Number('abc') 都是 NaN，|| 兜回第一页
  const asked = Math.floor(Number(value)) || 1
  const page = Math.min(Math.max(asked, 1), pages)
  return { page, pages, skip: (page - 1) * size, take: size }
}

export function Pager({
  path,
  params,
  page,
  pages,
}: {
  path: string
  /** 当前的筛选条件，翻页时要带着走，否则一翻页筛选就没了 */
  params?: Record<string, string | undefined>
  page: number
  pages: number
}) {
  if (pages <= 1) return null

  const href = (target: number) => {
    const query = new URLSearchParams()
    for (const [key, value] of Object.entries(params ?? {})) if (value) query.set(key, value)
    if (target > 1) query.set('page', String(target))
    const search = query.toString()
    return search ? `${path}?${search}` : path
  }

  return (
    <div className="mt-4 flex items-center justify-between">
      <p className="text-xs text-faint">
        第 {page} / {pages} 页
      </p>
      <div className="flex gap-2">
        <Step href={href(page - 1)} disabled={page <= 1}>
          上一页
        </Step>
        <Step href={href(page + 1)} disabled={page >= pages}>
          下一页
        </Step>
      </div>
    </div>
  )
}

function Step({
  href,
  disabled,
  children,
}: {
  href: string
  disabled: boolean
  children: React.ReactNode
}) {
  const base = 'border border-line px-3 py-1.5 text-sm'
  return disabled ? (
    <span className={`${base} text-faint opacity-50`}>{children}</span>
  ) : (
    <Link href={href} className={`${base} bg-white text-muted transition-colors hover:border-ink`}>
      {children}
    </Link>
  )
}

export function ButtonLink({ href, children }: { href: string; children: React.ReactNode }) {
  return (
    <Link
      href={href}
      className="bg-ink px-4 py-2 text-sm text-white transition-opacity hover:opacity-85"
    >
      {children}
    </Link>
  )
}

export function Field({
  name,
  label,
  error,
  hint,
  children,
}: {
  name: string
  label: string
  error?: string
  hint?: string
  children?: React.ReactNode
}) {
  return (
    <div>
      <label htmlFor={name} className="text-xs text-faint">
        {label}
      </label>
      {children}
      {hint && !error && <p className="mt-1 text-xs text-faint">{hint}</p>}
      {error && <p className="mt-1 text-xs text-sale">{error}</p>}
    </div>
  )
}

export const inputClass =
  'mt-1.5 w-full border border-line bg-white px-3 py-2 text-sm outline-none transition-colors focus:border-ink'
