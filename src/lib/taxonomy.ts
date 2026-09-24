// 前台按品牌进，不再按性别分入口。性别仍存在商品上（MEN / WOMEN / UNISEX），
// 后台和旧查询还用得上；包、表这类不分性别的货记成 UNISEX。
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
