// next/image 的自定义 loader。图片在种子/上传阶段就用 sharp 预生成了四档宽度，
// 文件名形如 /products/<hash>-800.webp，这里只负责把宽度段换成最接近的那一档。
//
// 不匹配这个命名规则的 src（logo、SVG 等）原样返回，走普通静态文件。

const WIDTHS = [400, 800, 1200, 1600]
const SIZED = /-(\d+)\.webp$/

export default function imageLoader({
  src,
  width,
}: {
  src: string
  width: number
}): string {
  if (!SIZED.test(src)) return src
  const best = WIDTHS.find((w) => w >= width) ?? WIDTHS[WIDTHS.length - 1]
  return src.replace(SIZED, `-${best}.webp`)
}
