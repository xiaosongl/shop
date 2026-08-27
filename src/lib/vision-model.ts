import path from 'node:path'

// 只要视觉这一半：图搜是图对图，用不上 CLIP 的文字塔，省下 63MB 和一份分词器。
export const MODEL_ID = 'Xenova/clip-vit-base-patch32'
export const MODEL_ROOT = path.join(process.cwd(), 'models')
export const MODEL_DIR = path.join(MODEL_ROOT, ...MODEL_ID.split('/'))

// q8 量化版：87MB、精度够用。跟 vision.ts 里的 dtype: 'q8' 是一对，改一个要改另一个。
export const MODEL_FILES = [
  'config.json',
  'preprocessor_config.json',
  'onnx/vision_model_quantized.onnx',
]

export const EMBED_DIMS = 512
