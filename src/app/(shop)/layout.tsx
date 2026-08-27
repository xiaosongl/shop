import { BottomNav } from '@/components/bottom-nav'
import { BrowserGuard } from '@/components/browser-guard'
import { SiteFooter } from '@/components/site-footer'
import { SiteHeader } from '@/components/site-header'
import { CartProvider } from '@/lib/cart'
import { backupDomains } from '@/lib/site'

// 前台所有页面都直连 SQLite 取数，本地查询在毫秒级，直接动态渲染最省心：
// 后台改了商品前台立刻生效，也不用在每个写操作后记得调 revalidatePath。
// 真正的流量大头是图片，那部分是带 hash 的静态文件，全部由 CDN 扛。
// ponytail: 如果以后 TTFB 成了瓶颈，再换成 revalidateTag 精细失效。
export const dynamic = 'force-dynamic'

export default function ShopLayout({ children }: { children: React.ReactNode }) {
  return (
    <CartProvider>
      <SiteHeader />
      <main className="min-h-[60vh]">{children}</main>
      <SiteFooter />

      <BottomNav />
      {/* 底部导航是 fixed 的，垫一块等高的占位，否则页脚最后一行永远被压着。
          1px 是导航条自己的上边框，漏掉就正好差一条线的高度 */}
      <div className="h-[calc(3.5rem+1px+env(safe-area-inset-bottom))] md:hidden" />

      {/* 备用域名由服务端读环境变量传进来，省一个 NEXT_PUBLIC_ 变量 */}
      <BrowserGuard backupDomains={backupDomains()} />
    </CartProvider>
  )
}
