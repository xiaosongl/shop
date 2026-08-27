import { PolicyManager } from '@/components/admin/policy-manager'
import { PageHeader } from '@/components/admin/ui'
import { db } from '@/lib/db'

export default async function AdminPolicies() {
  const policies = await db.policy.findMany({
    orderBy: [{ position: 'asc' }, { title: 'asc' }],
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
      <PageHeader title="政策条款" />
      <p className="mb-6 max-w-2xl text-sm leading-relaxed text-muted">
        退款、配送、条款、隐私这些页面。已发布的会自动出现在页脚的 Legal 一栏，
        地址是 /policy/对应的 slug。内容随时可改，改完前台立刻生效。
      </p>
      <PolicyManager policies={policies} />
    </>
  )
}
