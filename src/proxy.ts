import { NextResponse, type NextRequest } from 'next/server'

/**
 * 私域投放的第一道门。Next 16 起这个文件从 middleware 改叫 proxy，功能不变。
 *
 * 三件事：
 *   1. 认识的爬虫直接 404，别让它拿到任何可索引的内容
 *   2. 只服务白名单里的域名，防别人拿 IP 或野域名镜像你的站
 *   3. 给页面响应打上 X-Robots-Tag
 *
 * 后台鉴权不放这里——proxy 只适合做乐观检查，真正的会话校验在
 * src/app/admin/(protected)/layout.tsx，那里能用 node:crypto 验 HMAC。
 */

const CRAWLERS = [
  'googlebot',
  'bingbot',
  'baiduspider',
  'yandexbot',
  'duckduckbot',
  'slurp',
  'sogou',
  '360spider',
  'bytespider',
  'petalbot',
  'ahrefsbot',
  'semrushbot',
  'mj12bot',
  'dotbot',
  'gptbot',
  'ccbot',
  'claudebot',
  'perplexitybot',
  'applebot',
  'archive.org_bot',
  'ia_archiver',
]

// 分享卡片要靠这些抓取器拿 OG 标签，它们不会把站放进搜索结果，必须放行
const SHARE_BOTS = ['facebookexternalhit', 'twitterbot', 'whatsapp', 'telegrambot', 'discordbot']

const NO_INDEX = 'noindex, nofollow, noarchive, nosnippet, noimageindex'

/** 逗号分隔的环境变量，留空表示不限制（本地调试时就是这样） */
function allowedHosts(): string[] {
  return (process.env.ALLOWED_HOSTS ?? '')
    .split(',')
    .map((host) => host.trim().toLowerCase())
    .filter(Boolean)
}

export function proxy(request: NextRequest) {
  const agent = request.headers.get('user-agent')?.toLowerCase() ?? ''

  // 空 UA 放行：微信、部分 App 内置 webview 可能不带 UA，
  // 直接拦会把真实客户挡在外面，代价比放进一个爬虫大得多。
  const isShareBot = SHARE_BOTS.some((bot) => agent.includes(bot))
  if (agent && !isShareBot && CRAWLERS.some((crawler) => agent.includes(crawler))) {
    return new NextResponse(null, { status: 404, headers: { 'X-Robots-Tag': NO_INDEX } })
  }

  const allowed = allowedHosts()
  if (allowed.length > 0) {
    const host = (request.headers.get('host') ?? '').toLowerCase().split(':')[0]
    // 允许子域，这样 ALLOWED_HOSTS 写主域就够了
    const ok = allowed.some((entry) => host === entry || host.endsWith(`.${entry}`))
    if (!ok) return new NextResponse(null, { status: 404 })
  }

  const response = NextResponse.next()
  response.headers.set('X-Robots-Tag', NO_INDEX)
  return response
}

export const config = {
  // 静态资源不用过这层，省一次调用；图片的缓存头在 next.config.ts 里单独给
  matcher: ['/((?!_next/static|_next/image|favicon.ico|products/|uploads/).*)'],
}
