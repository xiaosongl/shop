/**
 * 站点级配置。全部走环境变量，换域名不用改代码、不用重新构建镜像。
 *
 * 站名和简介不在这里：那两样后台可改，存在 Showcase 的 site 位，
 * 缺省值在 lib/showcase.ts 的 SHOWCASE_FALLBACK 里，一处为准。
 */

export function siteUrl(): string {
  return (process.env.NEXT_PUBLIC_SITE_URL ?? 'http://localhost:3000').replace(/\/$/, '')
}

/** 主域被标红时的退路，展示在防红引导层里 */
export function backupDomains(): string[] {
  return (process.env.BACKUP_DOMAINS ?? '')
    .split(',')
    .map((domain) => domain.trim())
    .filter(Boolean)
}

/** 分享卡片图。绝对地址是硬要求——微信/WhatsApp 不认相对路径 */
export function absoluteUrl(path: string): string {
  return path.startsWith('http') ? path : `${siteUrl()}${path}`
}
