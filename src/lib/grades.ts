export const GRADE_KEYS = ['premium', 'exclusive', 'preowned'] as const
export type GradeKey = (typeof GRADE_KEYS)[number]

export const DEFAULT_GRADE: GradeKey = 'premium'

export const GRADES = {
  premium: {
    label: 'Premium',
    blurb: 'Factory match on hardware, leather, and chip.',
    range: 'Priced as listed',
    image: '/grades/premium.webp?v=2',
    points: [
      'Hardware, leather, and the chip are the same as the factory piece.',
      'Materials and finish follow the original spec.',
      'The everyday grade — what the listed price buys.',
    ],
  },
  exclusive: {
    label: 'Exclusive',
    blurb: 'Factory match, including the stitch work.',
    range: 'Listed + $90–$150',
    image: '/grades/exclusive.webp?v=2',
    points: [
      'Everything in Premium, plus stitch work and construction matched to the original.',
      'Seams, edge paint, and hand-finish follow the factory piece.',
      'The closest workshop cut we offer.',
    ],
  },
  preowned: {
    label: 'Authentic pre-owned',
    blurb: 'Sourced second-hand originals.',
    range: 'Contact us',
    image: '/grades/preowned.webp?v=2',
    points: [
      'Genuine bags we buy in — not a workshop replica.',
      'Original hardware, leather, and serials from the house.',
      'Condition varies; the photos are the bag you get.',
    ],
  },
} as const satisfies Record<
  GradeKey,
  {
    label: string
    blurb: string
    range: string
    image: string
    points: readonly string[]
  }
>

const EXCLUSIVE_MIN = 90
const EXCLUSIVE_MAX = 150

function hash(id: string) {
  let value = 2166136261
  for (let i = 0; i < id.length; i++) {
    value ^= id.charCodeAt(i)
    value = Math.imul(value, 16777619)
  }
  return value >>> 0
}

export function isGrade(value: unknown): value is GradeKey {
  return typeof value === 'string' && value in GRADES
}

/** 旧购物车里的 Classic 并进 Premium。不认识的档也落 Premium。 */
export function parseGrade(value: unknown): GradeKey {
  if (value === 'classic') return 'premium'
  return isGrade(value) ? value : DEFAULT_GRADE
}

/** Exclusive = Premium + $90–$150，同一标价永远同一加价。 */
export function exclusiveBumpCents(premiumCents: number) {
  const dollars = EXCLUSIVE_MIN + (hash(String(premiumCents)) % (EXCLUSIVE_MAX - EXCLUSIVE_MIN + 1))
  return dollars * 100
}

/** 列表价是 Premium。Exclusive 加 $90–$150。二手不标价。 */
export function gradePrices(premiumCents: number): Record<GradeKey, number | null> {
  return {
    premium: premiumCents,
    exclusive: premiumCents + exclusiveBumpCents(premiumCents),
    preowned: null,
  }
}

export function priceFor(premiumCents: number, grade: GradeKey): number | null {
  return gradePrices(premiumCents)[grade]
}

export function inquireGrade(grade: GradeKey) {
  return grade === 'preowned'
}

export function lineKey(variantId: string, grade: GradeKey): string {
  return `${variantId}:${grade}`
}

/** 只认站内商品路径，避免 ?from= 被做成跳转到外站 */
export function productReturnPath(from: unknown): string | null {
  if (typeof from !== 'string' || from.length > 200) return null
  let path = from
  try {
    path = decodeURIComponent(from)
  } catch {
    return null
  }
  if (!/^\/p\/[a-zA-Z0-9_-]{1,80}$/.test(path)) return null
  return path
}
