// 站点的浏览结构是 品牌 -> 性别 -> 类别 -> 商品列表。
// 性别只对外露出 Men 和 Women 两个入口；数据库里另有 UNISEX，
// 用于包、表这类不分性别的商品，它们在两个入口下都会出现。

// 这里的先后顺序就是全站的展示顺序：首页入口、顶部导航、抽屉里的性别页签、页脚
// 都是按 GENDER_SLUGS 来排的。女装在前是刻意的，别按字母序排回去。
export const GENDERS = {
  women: { label: 'Women', value: 'WOMEN' },
  men: { label: 'Men', value: 'MEN' },
} as const

export type GenderSlug = keyof typeof GENDERS

export const GENDER_SLUGS = Object.keys(GENDERS) as GenderSlug[]

export function isGenderSlug(value: string): value is GenderSlug {
  return value in GENDERS
}

/** 查某个性别时要连 UNISEX 一起查，否则品牌页下的包和表会凭空消失 */
export function genderValues(slug: GenderSlug): string[] {
  return [GENDERS[slug].value, 'UNISEX']
}
