import sharp from 'sharp'

import { MAX_PIXELS } from './images'
import { EMBED_DIMS, MODEL_ID, MODEL_ROOT } from './vision-model'

// CLIP 自带的预处理走 transformers 里那个 sharp，在 Windows 上会炸 colourspace。
// 预处理本身就是"缩放+中心裁+标准化"三步，参数全在 preprocessor_config.json 里，
// 用项目自己的 sharp 做掉，少一层依赖也少一次解码。改这几个常数等于换模型，别动。
const SIDE = 224
const MEAN = [0.48145466, 0.4578275, 0.40821073]
const STD = [0.26862954, 0.26130258, 0.27577711]

// 公开上传口，字节数只是第一道；真正挡解压炸弹的是 images.ts 里的 MAX_PIXELS
export const MAX_IMAGE_BYTES = 8 * 1024 * 1024

type VisionModel = (input: {
  pixel_values: unknown
}) => Promise<{ image_embeds: { data: Float32Array } }>

let loading: Promise<VisionModel> | null = null

async function model() {
  loading ??= (async () => {
    const { env, CLIPVisionModelWithProjection } = await import('@huggingface/transformers')
    env.localModelPath = MODEL_ROOT
    // 只认本地权重：线上不该在请求里现下 87MB，国内开发机也连不上 huggingface。
    // 缺文件就报错，让人去跑 npm run fetch:model，而不是悄悄退化成联网下载。
    env.allowRemoteModels = false
    return (await CLIPVisionModelWithProjection.from_pretrained(MODEL_ID, {
      dtype: 'q8',
    })) as unknown as VisionModel
  })()
  return loading
}

async function toPixels(input: Buffer) {
  // fit:cover + centre 正好等价于 CLIP 的"短边缩到 224 再中心裁 224"
  const { data } = await sharp(input, { limitInputPixels: MAX_PIXELS })
    .resize(SIDE, SIDE, { fit: 'cover', position: 'centre', kernel: 'cubic' })
    .toColourspace('srgb')
    .removeAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true })

  const plane = SIDE * SIDE
  const pixels = new Float32Array(3 * plane)
  for (let i = 0; i < plane; i++) {
    for (let c = 0; c < 3; c++) {
      pixels[c * plane + i] = (data[i * 3 + c] / 255 - MEAN[c]) / STD[c]
    }
  }
  return pixels
}

// 推理串行跑。ponytail: 一把全局锁，够用到并发上传把 CPU 顶满为止；
// 真到那天再换成 worker 池，别现在就上。
let queue: Promise<unknown> = Promise.resolve()

export async function embedImage(input: Buffer): Promise<Float32Array> {
  const [{ Tensor }, net, pixels] = await Promise.all([
    import('@huggingface/transformers'),
    model(),
    toPixels(input),
  ])

  const run = queue.then(async () => {
    const { image_embeds } = await net({
      pixel_values: new Tensor('float32', pixels, [1, 3, SIDE, SIDE]),
    })
    return image_embeds.data
  })
  queue = run.catch(() => {})

  return unit(await run)
}

// 归一化之后余弦相似度就是点积，查询时省掉两个开方
function unit(raw: Float32Array) {
  let sum = 0
  for (const v of raw) sum += v * v
  const norm = Math.sqrt(sum) || 1
  return Float32Array.from(raw, (v) => v / norm)
}

export function similarity(a: Float32Array, b: Float32Array) {
  let sum = 0
  for (let i = 0; i < a.length; i++) sum += a[i] * b[i]
  return sum
}

// SQLite 存 Bytes。两边都走复制，不共享底层 buffer：
// Node 的 Buffer 常落在共享内存池里，直接包 .buffer 会连上隔壁数据。
export function toBytes(vector: Float32Array): Uint8Array<ArrayBuffer> {
  const bytes = new Uint8Array(vector.byteLength)
  bytes.set(new Uint8Array(vector.buffer, vector.byteOffset, vector.byteLength))
  return bytes
}

export function fromBytes(bytes: Uint8Array): Float32Array | null {
  // 长度不对的当脏数据丢掉：换过模型或者写坏了都可能这样
  if (bytes.byteLength !== EMBED_DIMS * 4) return null
  const vector = new Float32Array(EMBED_DIMS)
  new Uint8Array(vector.buffer).set(bytes)
  return vector
}
