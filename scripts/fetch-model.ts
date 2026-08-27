// 把图搜要用的 CLIP 视觉模型抓到本地 models/ 下。
// 为什么不让 transformers.js 自己去 huggingface.co 拉：国内直连不通，而且线上也不该在
// 用户请求里现下 87MB。抓到本地之后 vision.ts 用 allowRemoteModels=false 跑，彻底断网也能用。
// 源用 ModelScope 的官方镜像仓，内容和 HF 上的 Xenova/clip-vit-base-patch32 一致。
import { createWriteStream } from 'node:fs'
import { mkdir, rename, stat } from 'node:fs/promises'
import path from 'node:path'
import { Readable } from 'node:stream'
import type { ReadableStream } from 'node:stream/web'
import { pipeline } from 'node:stream/promises'

import { MODEL_DIR, MODEL_FILES, MODEL_ID } from '../src/lib/vision-model'

const MIRROR = 'https://www.modelscope.cn/api/v1/models'

function sourceUrl(file: string) {
  return `${MIRROR}/${MODEL_ID}/repo?Revision=master&FilePath=${encodeURIComponent(file)}`
}

async function sizeOf(file: string) {
  return await stat(file).then(
    (s) => s.size,
    () => -1,
  )
}

async function fetchFile(file: string) {
  const dest = path.join(MODEL_DIR, file)
  const have = await sizeOf(dest)
  if (have > 0) {
    console.log(`  跳过 ${file}（已有 ${(have / 1024 / 1024).toFixed(1)}MB）`)
    return
  }

  await mkdir(path.dirname(dest), { recursive: true })
  const res = await fetch(sourceUrl(file))
  if (!res.ok || !res.body) throw new Error(`下载 ${file} 失败：HTTP ${res.status}`)

  // 先写 .part 再改名，中途断了不会留下一个看着完整其实缺斤少两的文件
  // fetch 给的是 DOM 的 ReadableStream，Readable.fromWeb 要 node:stream/web 那个，类型上得点一下
  const part = `${dest}.part`
  await pipeline(Readable.fromWeb(res.body as ReadableStream<Uint8Array>), createWriteStream(part))
  await rename(part, dest)
  console.log(`  取得 ${file}（${((await sizeOf(dest)) / 1024 / 1024).toFixed(1)}MB）`)
}

console.log(`拉取 ${MODEL_ID} 到 ${MODEL_DIR}`)
for (const file of MODEL_FILES) await fetchFile(file)
console.log('图搜模型就绪')
