import Link from 'next/link'
import { getBrands, getShowcases } from '@/lib/queries'
import { showcaseText } from '@/lib/showcase'
import { CartLink } from './cart-link'
import { MobileNav } from './mobile-nav'
import { SiteNav } from './site-nav'

export async function SiteHeader() {
  const [brands, showcases] = await Promise.all([getBrands(), getShowcases()])
  const name = showcaseText(showcases.site, 'site').headline
  // 公告条没有代码兜底：后台清空就是要它消失，不能再拿缺省文案顶上去
  const banner = showcases.banner.headline?.trim()

  return (
    <header className="sticky top-0 z-40 bg-white">
      {banner && (
        <div className="bg-ink py-2 text-center text-[11px] tracking-[0.08em] text-white">
          {banner}
        </div>
      )}

      <div className="border-b border-line">
        <div className="relative mx-auto flex h-14 max-w-7xl items-center gap-7 px-5 md:h-16">
          <MobileNav brands={brands} />

          {/* 这一排每个都撑到 44px 高：横向排版不受影响（h-14 的行本来就装得下），
              但手指能点中。纯文字链接的行高只有 20px，在手机上老是点空。
              手机端右边的图标都挪到底部导航去了，剩汉堡一个会显得偏，把字号居中摆 */}
          <Link
            href="/"
            className="absolute left-1/2 flex min-h-11 -translate-x-1/2 items-center whitespace-nowrap text-base font-medium tracking-[0.18em] uppercase md:static md:translate-x-0"
          >
            {name}
          </Link>

          <SiteNav brands={brands} />

          <div className="ml-auto flex items-center gap-5">
            <form action="/search" className="hidden lg:block">
              <input
                name="q"
                type="search"
                placeholder="Search"
                aria-label="Search products"
                className="w-36 border-b border-transparent bg-transparent pb-1 text-sm outline-none transition-[width,border-color] duration-200 placeholder:text-faint focus:w-52 focus:border-line"
              />
            </form>

            {/* 客人手上常常只有一张群里转来的照片，说不出牌子和款名，给他们一条不用打字的路。
                手机端这些入口由底部导航承担，这里往下藏，免得同一个功能在一屏里出现两次 */}
            <Link
              href="/search"
              aria-label="Search by photo"
              // 负 margin 抵掉 padding，视觉间距不变，热区变成 34x44
              className="-mx-1.5 hidden min-h-11 items-center p-2 text-muted transition-colors hover:text-ink md:flex"
            >
              <svg
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.5"
                className="h-[18px] w-[18px]"
              >
                <path d="M3 8.5A1.5 1.5 0 0 1 4.5 7h2.2l1.1-1.9A1 1 0 0 1 8.7 4.6h6.6a1 1 0 0 1 .9.5L17.3 7h2.2A1.5 1.5 0 0 1 21 8.5v9A1.5 1.5 0 0 1 19.5 19h-15A1.5 1.5 0 0 1 3 17.5z" />
                <circle cx="12" cy="12.8" r="3.4" />
              </svg>
            </Link>

            {/* 访客下单不注册账号，查单是他们回到订单的唯一入口，别只藏在页脚 */}
            <Link
              href="/orders"
              className="hidden min-h-11 items-center text-sm text-muted hover:text-ink md:flex"
            >
              Orders
            </Link>

            <CartLink />
          </div>
        </div>
      </div>
    </header>
  )
}
