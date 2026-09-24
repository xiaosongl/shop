import { SourceList } from '@/components/admin/source-list'
import { assertAdminPage } from '@/lib/admin-auth'

export default async function AdminSourceList() {
  await assertAdminPage()
  return <SourceList />
}
