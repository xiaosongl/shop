import Link from 'next/link'
import { getPolicyLinks, getShowcases } from '@/lib/queries'
import { whatsappNumber } from '@/lib/payments'
import { showcaseText } from '@/lib/showcase'

export async function SiteFooter() {
  const [showcases, policies] = await Promise.all([getShowcases(), getPolicyLinks()])
  const whatsapp = whatsappNumber()
  const site = showcaseText(showcases.site, 'site')
  const note = showcaseText(showcases.footer, 'footer').headline

  return (
    <footer className="mt-24 border-t border-line bg-shell">
      <div className="mx-auto max-w-7xl px-5 py-14">
        {/* 品牌块和链接块二八开，链接列再自己分三栏。挤在同一个 grid 里的话，
            五条等宽轨道会把「Track your order」逼到换行 */}
        <div className="grid gap-10 md:grid-cols-[minmax(0,1fr)_minmax(0,1.6fr)]">
          <div>
            <p className="text-base font-medium tracking-[0.18em] uppercase">{site.headline}</p>
            <p className="mt-3 max-w-72 text-sm leading-relaxed text-muted">{site.subhead}</p>
          </div>

          <div className="grid grid-cols-2 gap-8 sm:grid-cols-3">
            <Column title="Shop">
              <Item href="/new">New arrivals</Item>
              <Item href="/brands">Brands</Item>
              <Item href="/grades">Our grades</Item>
            </Column>

            <Column title="Help">
              <Item href="/orders">Track your order</Item>
              {whatsapp && (
                <Item href={`https://wa.me/${whatsapp}`} external>
                  WhatsApp us
                </Item>
              )}
            </Column>

            {policies.length > 0 && (
              <Column title="Legal">
                {policies.map((policy) => (
                  <Item key={policy.slug} href={`/policy/${policy.slug}`}>
                    {policy.title}
                  </Item>
                ))}
              </Column>
            )}
          </div>
        </div>

        <div className="mt-12 flex flex-col gap-3 border-t border-line pt-6 text-xs text-faint md:flex-row md:items-center md:justify-between">
          <p>{`© ${new Date().getFullYear()} ${site.headline}`}</p>
          {note && <p>{note}</p>}
        </div>
      </div>
    </footer>
  )
}

function Column({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div>
      <p className="label-xs text-faint">{title}</p>
      <ul className="mt-3">{children}</ul>
    </div>
  )
}

function Item({
  href,
  external,
  children,
}: {
  href: string
  external?: boolean
  children: React.ReactNode
}) {
  // 页脚链接在手机上排得很密，撑到 44px 才不会点到隔壁那条
  const className = 'flex min-h-11 items-center text-sm text-muted hover:text-ink'

  return (
    <li>
      {external ? (
        <a href={href} target="_blank" rel="noreferrer noopener" className={className}>
          {children}
        </a>
      ) : (
        <Link href={href} className={className}>
          {children}
        </Link>
      )}
    </li>
  )
}
