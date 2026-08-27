import { createHash } from 'node:crypto'
import { access, mkdir } from 'node:fs/promises'
import path from 'node:path'
import sharp from 'sharp'

// 与 next.config.ts 的 deviceSizes 和 src/lib/image-loader.ts 保持一致
export const IMAGE_WIDTHS = [400, 800, 1200, 1600] as const

// 商品图统一 3:4 竖构图，前台用固定比例容器渲染，CLS 恒为 0
const RATIO = 4 / 3
const CANONICAL_WIDTH = 1200
const OG_SIZE = { width: 1200, height: 630 }

// effort 6 编码慢一些但小 5-10%，反正只在入库时跑一次，这个交换很划算。
// og 压得更狠：WhatsApp 的预览图超过 300KB 就直接不显示。
const ENCODE = {
  main: { quality: 78, effort: 6, smartSubsample: true },
  og: { quality: 70, effort: 6 },
} as const

export type ProcessedImage = {
  url: string
  ogUrl: string
  blurDataUrl: string
  width: number
  height: number
}

/**
 * 解出来的像素上限。解压炸弹的重点是「文件小、像素多」：
 * 几百 KB 的 PNG 能摊开成几十 GB，卡住字节数根本拦不住，得卡像素。
 */
export const MAX_PIXELS = 40_000_000

// 只认这几种。少一种格式就少一个解码器的攻击面，够用就行。
const SAFE_FORMATS = new Set(['jpeg', 'png', 'webp', 'avif', 'gif', 'tiff'])

/**
 * 上传的信任边界：以真实字节为准，不信客户端报的 MIME 和扩展名。
 *
 * 改名的可执行文件在这里就解不开。SVG 是明确拒掉的 —— 它不是位图而是一份
 * 能带脚本、能引外部实体的 XML，光栅化得过 librsvg 那一整套解析器，
 * 为了一张用户上传的图不值得把这个面打开。（种子脚本里的占位图是我们自己
 * 生成的 SVG，它不走这道门，直接进 processImage。）
 *
 * 只读文件头，不解码，所以炸弹在解开之前就被判掉了。
 */
export async function sniffImage(
  input: Buffer,
): Promise<{ ok: true } | { ok: false; message: string }> {
  let meta
  try {
    meta = await sharp(input).metadata()
  } catch {
    return { ok: false, message: '这个文件不是能识别的图片' }
  }

  if (!meta.format || !SAFE_FORMATS.has(meta.format)) {
    return { ok: false, message: `不支持的图片格式：${meta.format ?? '无法识别'}` }
  }

  // 动图要把帧数乘进去，否则一张千帧的 webp 单帧看着很小，摊开却很大
  const pixels = (meta.width ?? 0) * (meta.height ?? 0) * (meta.pages ?? 1)
  if (pixels <= 0) return { ok: false, message: '读不出这张图的尺寸' }
  if (pixels > MAX_PIXELS) {
    return { ok: false, message: `图片像素太多（上限 ${MAX_PIXELS / 1_000_000} 百万）` }
  }

  return { ok: true }
}

export type ImageCrop = 'full' | 'detail'

const PUBLIC_DIR = path.join(process.cwd(), 'public')

async function exists(file: string) {
  try {
    await access(file)
    return true
  } catch {
    return false
  }
}

/**
 * 把一张原图处理成整套上线可用的产物：四档宽度的 WebP、分享卡片图、blur 占位。
 *
 * 文件名用内容 hash，所以同一张图重复处理会命中已有文件直接跳过，
 * 种子脚本反复跑不会重复干活；也正因为内容变了文件名就变，
 * next.config.ts 里才敢给这些路径打 immutable 缓存。
 */
export async function processImage(
  input: Buffer,
  opts: {
    dir: 'products' | 'uploads'
    crop?: ImageCrop
    /** 只有商品主图需要分享卡片图，其余跳过省一次编码 */
    withOg?: boolean
  },
): Promise<ProcessedImage> {
  const { dir, crop = 'full', withOg = false } = opts

  // 编码参数进哈希，否则调了质量再跑种子会命中旧文件，改动静默失效
  const key = createHash('sha1')
    .update(input)
    .update(crop)
    .update(JSON.stringify(ENCODE))
    .digest('hex')
    .slice(0, 12)
  const outDir = path.join(PUBLIC_DIR, dir)
  await mkdir(outDir, { recursive: true })

  const source = await prepare(input, crop)

  for (const width of IMAGE_WIDTHS) {
    const file = path.join(outDir, `${key}-${width}.webp`)
    if (await exists(file)) continue
    await sharp(source)
      .resize(width, Math.round(width * RATIO), { fit: 'cover', position: 'attention' })
      .webp(ENCODE.main)
      .toFile(file)
  }

  const ogFile = path.join(outDir, `${key}-og.webp`)
  if (withOg && !(await exists(ogFile))) {
    await sharp(source)
      .resize(OG_SIZE.width, OG_SIZE.height, { fit: 'cover', position: 'attention' })
      .webp(ENCODE.og)
      .toFile(ogFile)
  }

  const blur = await sharp(source)
    .resize(20, Math.round(20 * RATIO), { fit: 'cover' })
    .webp({ quality: 40 })
    .toBuffer()

  // URL 一律手工拼，不用 path.join —— Windows 上它给的是反斜杠，进了 src 属性就是 404
  return {
    url: `/${dir}/${key}-${CANONICAL_WIDTH}.webp`,
    ogUrl: withOg ? `/${dir}/${key}-og.webp` : `/${dir}/${key}-${CANONICAL_WIDTH}.webp`,
    blurDataUrl: `data:image/webp;base64,${blur.toString('base64')}`,
    width: CANONICAL_WIDTH,
    height: Math.round(CANONICAL_WIDTH * RATIO),
  }
}

/**
 * detail 裁出中间偏上的一块再放大，用来当商品卡 hover 的第二张图。
 * 同一张原图出两种构图，比让相邻商品互相借图看起来自然得多。
 */
async function prepare(input: Buffer, crop: ImageCrop): Promise<Buffer> {
  // 后台上传前已经过了 sniffImage，但种子脚本抓的是远端图，没人替它把过关，
  // 所以解码上限在这儿再兜一道
  const open = () => sharp(input, { failOn: 'none', limitInputPixels: MAX_PIXELS }).rotate()

  const base = open()
  if (crop === 'full') return base.toBuffer()

  const { width = 0, height = 0 } = await base.metadata()
  if (width < 100 || height < 100) return open().toBuffer()

  return open()
    .extract({
      left: Math.round(width * 0.18),
      top: Math.round(height * 0.08),
      width: Math.round(width * 0.64),
      height: Math.round(height * 0.7),
    })
    .toBuffer()
}

/**
 * 下载失败时的兜底图。低饱和度渐变，跟站点的黑白灰调子不冲突；
 * 色相由 seed 决定，保证不同商品的占位图不会撞成同一个文件 hash。
 */
export function placeholderSource(seed: string): Buffer {
  const hue = createHash('sha1').update(seed).digest()[0] % 360
  return Buffer.from(
    `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="1600">
      <defs>
        <linearGradient id="g" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stop-color="hsl(${hue},10%,93%)"/>
          <stop offset="100%" stop-color="hsl(${hue},8%,79%)"/>
        </linearGradient>
      </defs>
      <rect width="1200" height="1600" fill="url(#g)"/>
      <circle cx="600" cy="800" r="210" fill="none" stroke="hsl(${hue},6%,64%)" stroke-width="2"/>
    </svg>`,
  )
}
