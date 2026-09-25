/**
 * 「没有数据表可挂」的文案位：站名、客服联系方式、顶部公告、首页主视觉、两个性别入口、页脚备注。
 *
 * 每个位置的图和文案都可空，空就用下面的缺省值 + 自动挑的商品图，
 * 所以后台一次都不进也是一个完整可用的站。联系方式没有缺省：空着就是不显示。
 *
 * 加新位置只要往这里加一个 key 和一条 SHOWCASE_LABELS，
 * 表结构、后台表单、保存逻辑都不用动。
 */
export const SHOWCASE_KEYS = ['site', 'contact', 'banner', 'home', 'women', 'men', 'footer'] as const

export type ShowcaseKey = (typeof SHOWCASE_KEYS)[number]

export type ShowcaseEntry = {
  imageUrl: string | null
  imageBlur: string | null
  headline: string | null
  subhead: string | null
}

export const EMPTY_SHOWCASE: ShowcaseEntry = {
  imageUrl: null,
  imageBlur: null,
  headline: null,
  subhead: null,
}

/**
 * ImageField 和后台 action 共用的字段名。两边都从这里取，
 * 免得改了一边漏另一边——那种错的表现是「上传没反应」，很难查。
 */
export const imageField = (prefix: string) => ({
  file: `${prefix}.image`,
  clear: `${prefix}.clearImage`,
})

/**
 * 每个位置用到哪几个控件，由这张表说了算。省掉表单里一串
 * `key === 'home' ? ... : ...` —— 那种写法每加一个位置都要再改一次分支。
 * subhead / image 不填就表示这个位置没有这一项。
 */
export type ShowcaseMeta = {
  title: string
  hint: string
  headline: string
  /** 盖过「留空显示缺省文案」。联系方式这种没有缺省的字段用它写格式 */
  headlineHint?: string
  subhead?: string
  subheadHint?: string
  /** 短字段用单行输入。缺省是两行文本框 */
  subheadLine?: boolean
  image?: string
}

export const SHOWCASE_LABELS: Record<ShowcaseKey, ShowcaseMeta> = {
  site: {
    title: '站点名称',
    hint: '页头 logo、页脚品牌名、浏览器标签页、分享卡片，全都用它',
    headline: '站点名',
    subhead: '页脚简介',
  },
  contact: {
    title: '联系方式',
    hint: 'WhatsApp 和 Messenger。页脚、商品询价、结算页的本地支付都读这里，两个都留空则不提供本地支付',
    headline: 'WhatsApp 号码',
    headlineHint: '纯数字，带国家码，如 8613800138000。留空则不显示 WhatsApp',
    subhead: 'Messenger',
    subheadHint: '主页用户名或数字 ID，不用带 @。留空则不显示 Messenger',
    subheadLine: true,
  },
  banner: {
    title: '顶部公告条',
    hint: '页头最上面那条黑底白字。清空并保存，整条就不再显示',
    headline: '公告文案',
  },
  home: {
    title: '首页主视觉',
    hint: '进站第一屏的大标题和副标题',
    headline: '主标题',
    subhead: '副标题',
  },
  women: {
    title: '女士入口',
    hint: '首页左边那块图',
    headline: '入口标题',
    image: '留空则自动取该性别下第一张商品图',
  },
  men: {
    title: '男士入口',
    hint: '首页右边那块图',
    headline: '入口标题',
    image: '留空则自动取该性别下第一张商品图',
  },
  footer: {
    title: '页脚底部备注',
    hint: '版权行右边那句，一般写退换货时限和发货地',
    headline: '备注文案',
  },
}

/** 前台缺省文案。后台留空时用这些，改文案不必进后台 */
export const SHOWCASE_FALLBACK: Record<ShowcaseKey, { headline: string; subhead: string }> = {
  site: {
    headline: 'Northsound',
    subhead: 'Considered clothing, shoes, bags and watches. Built to last, priced honestly.',
  },
  // 留空就是关掉，不能清完又冒出一个号码。
  contact: { headline: '', subhead: '' },
  // 出厂文案由种子写进库（见 DEFAULT_BANNER），不写在这里：写在这里的话后台清空又会顶上来。
  banner: { headline: '', subhead: '' },
  home: {
    headline: 'Clothing, shoes, bags and watches from a short list of makers.',
    subhead: 'Pick a side to start. Bags and watches appear under both.',
  },
  women: { headline: 'Women', subhead: '' },
  men: { headline: 'Men', subhead: '' },
  footer: { headline: 'Free returns within 30 days · Ships from Portland, OR', subhead: '' },
}

/**
 * 公告条的出厂文案，由种子写进库而不是当代码兜底 —— 差别在于：
 * 兜底文案清不掉（清空又会顶上来），入库的默认值清掉就没了。
 */
export const DEFAULT_BANNER = 'Complimentary USPS shipping on every order'

/** 后台留空就回退到缺省，两边都空才是真的空。只认文案，调用方不必把图也查出来 */
export function showcaseText(
  entry: Pick<ShowcaseEntry, 'headline' | 'subhead'> | undefined,
  key: ShowcaseKey,
) {
  return {
    headline: entry?.headline || SHOWCASE_FALLBACK[key].headline,
    subhead: entry?.subhead || SHOWCASE_FALLBACK[key].subhead,
  }
}

// 取数在 queries.ts。这个文件要保持零依赖：后台表单是客户端组件，
// 一旦从这里带进 db，better-sqlite3 就会被打进浏览器包。
