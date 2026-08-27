import type { Metadata } from 'next'
import Link from 'next/link'
import { notFound } from 'next/navigation'
import { getPolicy, getPolicyLinks } from '@/lib/queries'
import { parsePolicy } from '@/lib/policy'

type Params = { params: Promise<{ slug: string }> }

const updated = new Intl.DateTimeFormat('en-US', {
  year: 'numeric',
  month: 'long',
  day: 'numeric',
})

export async function generateMetadata({ params }: Params): Promise<Metadata> {
  const policy = await getPolicy((await params).slug)
  return policy ? { title: policy.title } : {}
}

export default async function PolicyPage({ params }: Params) {
  const { slug } = await params
  const [policy, links] = await Promise.all([getPolicy(slug), getPolicyLinks()])
  if (!policy) notFound()

  return (
    <div className="mx-auto max-w-3xl px-5 py-14 md:py-20">
      <header className="border-b border-line pb-8">
        <h1 className="text-3xl font-normal tracking-tight md:text-4xl">{policy.title}</h1>
        <p className="mt-4 text-xs text-faint">
          Last updated {updated.format(policy.updatedAt)}
        </p>
      </header>

      {/* 正文是纯文本切出来的块，没有一处 dangerouslySetInnerHTML —— 后台写什么进来都只是字 */}
      <article className="mt-10 space-y-6">
        {parsePolicy(policy.body).map((block, index) => {
          if (block.kind === 'heading') {
            return (
              <h2 key={index} className="pt-4 text-lg tracking-tight md:text-xl">
                {block.text}
              </h2>
            )
          }
          if (block.kind === 'list') {
            return (
              <ul key={index} className="space-y-2.5 pl-5">
                {block.items.map((item, at) => (
                  <li key={at} className="list-disc text-[15px] leading-relaxed text-muted">
                    {item}
                  </li>
                ))}
              </ul>
            )
          }
          return (
            <p key={index} className="text-[15px] leading-relaxed text-muted">
              {block.text}
            </p>
          )
        })}
      </article>

      {links.length > 1 && (
        <nav className="mt-16 border-t border-line pt-8">
          <p className="label-xs text-faint">More</p>
          <ul className="mt-4 flex flex-wrap gap-x-6 gap-y-2">
            {links
              .filter((link) => link.slug !== policy.slug)
              .map((link) => (
                <li key={link.slug}>
                  <Link
                    href={`/policy/${link.slug}`}
                    className="flex min-h-11 items-center text-sm text-muted hover:text-ink"
                  >
                    {link.title}
                  </Link>
                </li>
              ))}
          </ul>
        </nav>
      )}
    </div>
  )
}
