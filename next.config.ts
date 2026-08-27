import type { NextConfig } from 'next'

// 私域站点：全站不给搜索引擎收录。响应头这层比 meta 标签硬，图片和接口响应也一起覆盖。
const NO_INDEX = 'noindex, nofollow, noarchive, nosnippet, noimageindex'

const dev = process.env.NODE_ENV !== 'production'

/**
 * 站内没有任何 <script> 标签、dangerouslySetInnerHTML 或 eval，外部地址一律是
 * 服务端去请求（链上接口、汇率）或者纯跳转链接（WhatsApp、USPS），
 * 所以除了自己人以外什么都不用放行。
 *
 * ponytail: script-src 留了 unsafe-inline —— Next 靠内联脚本把 RSC 数据交给浏览器。
 * 收紧的路子是 proxy.ts 里发一个 nonce（Next 会自动带到自家脚本上），代价是
 * 全站转成动态渲染。等真有第三方脚本要接进来时再换，现在这条 CSP 拦得住的是
 * 「把注入的内容往站外送」和「被人套进 iframe」，那才是这个站的实际风险。
 */
const CSP = [
  "default-src 'self'",
  "base-uri 'self'",
  "object-src 'none'",
  "frame-ancestors 'none'",
  "form-action 'self'",
  // data: 给模糊占位和收款二维码，blob: 给上传前的本地预览
  "img-src 'self' data: blob:",
  "font-src 'self' data:",
  "style-src 'self' 'unsafe-inline'",
  `script-src 'self' 'unsafe-inline'${dev ? " 'unsafe-eval'" : ''}`,
  // 开发时要留 websocket 给热更新
  `connect-src 'self'${dev ? ' ws:' : ''}`,
].join('; ')

const SECURITY_HEADERS = [
  { key: 'Content-Security-Policy', value: CSP },
  // public/uploads 是对外的静态目录。出去的一律是 sharp 重编码过的 webp，
  // 但只要浏览器还会按内容猜类型，就有把某段字节当成 HTML 执行的余地，堵死它。
  { key: 'X-Content-Type-Options', value: 'nosniff' },
  // 和 frame-ancestors 说的是同一件事，留着照顾看不懂 CSP 的老浏览器
  { key: 'X-Frame-Options', value: 'DENY' },
  // 订单号本身就是访问凭据，跳去 USPS/WhatsApp 时只带域名，别把整条 URL 漏出去
  { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
  { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=(), payment=()' },
  ...(dev
    ? []
    : [{ key: 'Strict-Transport-Security', value: 'max-age=63072000; includeSubDomains' }]),
]

const nextConfig: NextConfig = {
  // 原生模块不能进 webpack/turbopack 的 server bundle，否则 .node 文件加载不到
  // 图搜的 CLIP 推理走 onnxruntime-node，同理
  serverExternalPackages: ['better-sqlite3', 'sharp', '@huggingface/transformers'],

  // dev 下 Next 只认启动时那个域名，用 127.0.0.1 打开就被当成跨域，
  // /_next/static 的 chunk 全部 403，页面出得来却不会水合。只影响开发。
  allowedDevOrigins: ['127.0.0.1', 'localhost'],

  images: {
    // 图片在入库时就预生成好了四档尺寸，运行时不需要 /_next/image 转码。
    // 这样源站零 CPU 消耗，CDN 缓存的全是静态文件。
    loader: 'custom',
    loaderFile: './src/lib/image-loader.ts',
    deviceSizes: [400, 800, 1200, 1600],
    imageSizes: [200],
  },

  async headers() {
    return [
      {
        source: '/:path*',
        headers: [{ key: 'X-Robots-Tag', value: NO_INDEX }, ...SECURITY_HEADERS],
      },
      {
        // 文件名带内容 hash，改图即换名，所以可以放心 immutable
        source: '/products/:path*',
        headers: [
          { key: 'Cache-Control', value: 'public, max-age=31536000, immutable' },
        ],
      },
      {
        source: '/uploads/:path*',
        headers: [
          { key: 'Cache-Control', value: 'public, max-age=31536000, immutable' },
        ],
      },
    ]
  },
}

export default nextConfig
