const VIDEO = /\.(mp4|webm|mov|m4v|m3u8)$/i

export function isVideoUrl(value: string) {
  const path = value.trim().split(/[?#]/)[0] ?? ''
  return VIDEO.test(path)
}

/** 图片列表里夹的视频拆出来。一件商品只留第一条。http 升成 https。 */
export function partitionMedia(urls: string[]) {
  const images: string[] = []
  let video: string | null = null
  for (const raw of urls) {
    const url = raw.trim().replace(/^http:\/\//i, 'https://')
    if (!url) continue
    if (isVideoUrl(url)) {
      video ??= url
      continue
    }
    images.push(url)
  }
  return { images, video }
}
