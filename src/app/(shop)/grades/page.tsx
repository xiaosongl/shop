import type { Metadata } from 'next'
import Image from 'next/image'
import Link from 'next/link'
import { GRADE_KEYS, GRADES, productReturnPath } from '@/lib/grades'

export const metadata: Metadata = {
  title: 'Our grades',
  description: 'Premium, Exclusive, and Authentic pre-owned.',
}

type Props = { searchParams: Promise<{ from?: string }> }

export default async function GradesPage({ searchParams }: Props) {
  const { from } = await searchParams
  const back = productReturnPath(from)

  return (
    <div className="mx-auto max-w-6xl px-4 py-8 sm:px-5 md:py-16">
      <header className="max-w-xl">
        {back && (
          <Link href={back} className="label-xs text-faint hover:text-ink">
            ← Back to this piece
          </Link>
        )}
        <p className={`label-xs text-faint ${back ? 'mt-5' : ''}`}>Quality</p>
        <h1 className="mt-2 text-[1.75rem] leading-tight font-normal tracking-tight sm:text-3xl md:text-5xl">
          Three grades. One model.
        </h1>
        <p className="mt-4 text-[15px] leading-relaxed text-muted">
          Every bag is offered in Premium, Exclusive, and Authentic pre-owned. Same silhouette —
          the cut of the workshop, or a sourced original. Pick the grade on the product page.
        </p>
      </header>

      <div className="mt-8 border-t border-line md:mt-12">
        {GRADE_KEYS.map((key, index) => {
          const grade = GRADES[key]
          return (
            <article
              key={key}
              className="grid gap-5 border-b border-line py-8 md:grid-cols-2 md:items-center md:gap-12 md:py-10 lg:gap-16"
            >
              <div className="overflow-hidden bg-shell">
                <Image
                  src={grade.image}
                  alt={grade.label}
                  width={2720}
                  height={1520}
                  unoptimized
                  priority={index === 0}
                  sizes="(min-width: 768px) 42rem, 100vw"
                  className="h-auto w-full"
                />
              </div>
              <div>
                <h2 className="text-2xl tracking-tight">{grade.label}</h2>
                <p className="mt-1 text-sm text-muted">{grade.range}</p>
                <p className="mt-4 text-[15px] leading-relaxed text-ink">{grade.blurb}</p>
                <ul className="mt-3 space-y-2 text-sm leading-relaxed text-muted">
                  {grade.points.map((point) => (
                    <li key={point}>{point}</li>
                  ))}
                </ul>
              </div>
            </article>
          )
        })}
      </div>

      {back && (
        <Link href={back} className="label-xs mt-2 inline-block border-b border-ink pb-0.5">
          Return to this piece
        </Link>
      )}
    </div>
  )
}
