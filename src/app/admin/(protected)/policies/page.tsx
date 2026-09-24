import { PolicyManager } from '@/components/admin/policy-manager'
import { PageHeader, Pager, Search, pageFrom, queryFrom } from '@/components/admin/ui'
import { assertAdminPage } from '@/lib/admin-auth'
import { db } from '@/lib/db'

export default async function AdminPolicies({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; page?: string }>
}) {
  await assertAdminPage()
  const { q, page: pageParam } = await searchParams
  const query = queryFrom(q)
  const where = query
    ? { OR: [{ title: { contains: query } }, { slug: { contains: query } }] }
    : {}

  const total = await db.policy.count({ where })
  const { page, pages, skip, take } = pageFrom(pageParam, total)

  const policies = await db.policy.findMany({
    where,
    orderBy: [{ position: 'asc' }, { title: 'asc' }],
    skip,
    take,
    select: {
      slug: true,
      title: true,
      body: true,
      position: true,
      published: true,
      updatedAt: true,
    },
  })

  return (
    <>
      <PageHeader title="政策条款" count={`共 ${total} 篇`} />
      <p className="mb-6 max-w-2xl text-sm leading-relaxed text-muted">
        退款、配送、条款、隐私这些页面。已发布的会自动出现在页脚的 Legal 一栏，
        地址是 /policy/对应的 slug。内容随时可改，改完前台立刻生效。
      </p>
      <Search action="/admin/policies" q={query} placeholder="搜索标题或 slug" />
      <PolicyManager policies={policies} empty={query ? '没有找到政策页' : '还没有政策页'} />
      <Pager path="/admin/policies" params={{ q: query }} page={page} pages={pages} />
    </>
  )
}
