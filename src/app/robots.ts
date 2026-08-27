import type { MetadataRoute } from 'next'

// 私域站，一个爬虫都不欢迎。这只是四层防收录里最礼貌的一层，
// 另外三层：middleware 拦 UA、next.config 打 X-Robots-Tag、根布局的 meta robots。
export default function robots(): MetadataRoute.Robots {
  return {
    rules: [{ userAgent: '*', disallow: '/' }],
  }
}
