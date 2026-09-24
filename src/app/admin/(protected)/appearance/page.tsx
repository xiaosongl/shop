import { AppearanceForm } from '@/components/admin/appearance-form'
import { PageHeader } from '@/components/admin/ui'
import { assertAdminPage } from '@/lib/admin-auth'
import { getShowcases } from '@/lib/queries'

export default async function AdminAppearance() {
  await assertAdminPage()
  const showcases = await getShowcases()

  return (
    <>
      <PageHeader title="站点文案" />
      <p className="mb-6 max-w-2xl text-sm leading-relaxed text-muted">
        站名、顶部公告、首页主视觉、性别入口、页脚备注都在这里改。除公告条外每一项都可以留空，
        留空时前台用内置文案，图片则自动取该范围下第一张商品图——所以这一页一次都不配置，站也是完整的。
      </p>
      <AppearanceForm showcases={showcases} />
    </>
  )
}
