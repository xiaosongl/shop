/**
 * 把 data/wego-export/products.csv 导进商店。
 *
 * 相册导出时品牌、类目、状态是占位的（全是 Wego / totes / draft），
 * 直接灌进去前台只有一个品牌，而且草稿不会上架。
 * 这里按标题认出品牌和类目，上架，并配图。
 *
 *   npx tsx scripts/import-wego.ts --images-only --refresh-images
 *
 * --refresh-images 会换掉已经配过的图。上次用的是 320px 缩略图，拉大之后是糊的，
 * 而且每个商品只留了前 4 张。进度记在 data/wego-export/imaged-hd.txt，中断后接着跑。
 *
 * 尺码表、上身图这种帖子不是商品，跳过。
 * 相册没有库存，新建时每件给 8 件，否则全站显示售罄。
 * 重跑是安全的：同一个 slug 会更新而不是再建一条。
 * 配图默认跳过已经有图的商品；要换成清晰大图用 --refresh-images。
 *
 * ponytail: 品牌靠标题里的名字和常见写法（含打码的 Gucc*）匹配，对不上的归到 Other。
 * 没有「裤子」类目，非牛仔的裤子先归 denim。要更准就改 BRANDS / categoryOf。
 */
import { appendFileSync, existsSync, readdirSync, readFileSync, unlinkSync } from 'node:fs'
import path from 'node:path'
import sharp from 'sharp'
import { db } from '../src/lib/db'
import { IMAGE_WIDTHS, processImage } from '../src/lib/images'
import { isVideoUrl } from '../src/lib/media'
import {
  MAX_IMPORT_IMAGES,
  applyPlan,
  buildPlan,
  fetchRemoteImage,
  parseCsv,
  type ImportPlan,
} from '../src/lib/product-import'

const CSV = 'data/wego-export/products.csv'
const IMAGE_DIR = 'data/wego-export/images'
const DONE_FILE = 'data/wego-export/imaged-hd.txt'
const CHUNK = 400
const DEFAULT_STOCK = '1000'
/** 宽于这个数才算清晰图。相册里同一张图存了 320 的缩略图和 1440 的大图，缩略图排在前面 */
const MIN_SOURCE_WIDTH = 800

const BRANDS: { name: string; slug: string; needles: string[] }[] = [
  { name: 'Louis Vuitton', slug: 'louis-vuitton', needles: ['louis vuitton', 'louisvuitton', 'louisvuitt', 'vuitton', 'vuiton', 'onthego', '驴家', '威登', 'lv'] },
  { name: 'Chrome Hearts', slug: 'chrome-hearts', needles: ['chrome hearts', 'chromehearts', '克罗心'] },
  { name: 'Thom Browne', slug: 'thom-browne', needles: ['thom browne', 'thombrowne', 'thombrowe', '汤姆布朗', '汤姆朗', 'tb'] },
  { name: 'Ralph Lauren', slug: 'ralph-lauren', needles: ['ralph lauren', 'ralphlauren', '拉夫劳伦'] },
  { name: 'Bottega Veneta', slug: 'bottega-veneta', needles: ['bottega', '葆蝶家'] },
  { name: 'Alexander McQueen', slug: 'alexander-mcqueen', needles: ['mcqueen', '麦昆'] },
  { name: 'Golden Goose', slug: 'golden-goose', needles: ['golden goose', 'goldengoose'] },
  { name: 'Canada Goose', slug: 'canada-goose', needles: ['canada goose', '加拿大鹅'] },
  { name: 'Stone Island', slug: 'stone-island', needles: ['stone island', '石头岛'] },
  { name: 'Brunello Cucinelli', slug: 'brunello-cucinelli', needles: ['cucinelli'] },
  { name: 'Loro Piana', slug: 'loro-piana', needles: ['loro piana', 'loropiana'] },
  { name: 'Maison Margiela', slug: 'maison-margiela', needles: ['margiela', '马吉拉'] },
  { name: 'Rick Owens', slug: 'rick-owens', needles: ['rick owens', 'rickowens'] },
  { name: 'Balenciaga', slug: 'balenciaga', needles: ['balenciaga', 'balenciga', '巴黎世家', '巴黎家'] },
  { name: 'Saint Laurent', slug: 'saint-laurent', needles: ['saint laurent', '圣罗兰', 'ysl'] },
  { name: 'Dior', slug: 'dior', needles: ['dior', '迪奥', '迪家', 'dio', 'd家'] },
  { name: 'Chanel', slug: 'chanel', needles: ['chanel', 'chane', '香奈儿', '香奈尔'] },
  { name: 'Hermes', slug: 'hermes', needles: ['hermes', '爱马仕', '爱马家'] },
  { name: 'Gucci', slug: 'gucci', needles: ['gucci', 'gucc', 'gcci', '古驰', '古奇', '古齐', '古家', '双g', 'guc'] },
  { name: 'Prada', slug: 'prada', needles: ['prada', 'prad', '普拉达', '普达', '普家', 'pra'] },
  { name: 'Burberry', slug: 'burberry', needles: ['burberry', 'burbery', 'burerry', '巴宝莉', '博柏利', '巴莉'] },
  { name: 'Fendi', slug: 'fendi', needles: ['fendi', 'feni', '芬迪'] },
  { name: 'Loewe', slug: 'loewe', needles: ['loewe', '罗意威', '罗威', '罗家'] },
  { name: 'Celine', slug: 'celine', needles: ['celine', '思琳', '赛琳', '瑟琳'] },
  { name: 'Moncler', slug: 'moncler', needles: ['moncler', '蒙口', '盟可睐', '蒙克莱'] },
  { name: 'Miu Miu', slug: 'miu-miu', needles: ['miu miu', 'miumiu', 'miumi', '缪缪'] },
  { name: 'Valentino', slug: 'valentino', needles: ['valentino', 'valentin', '华伦天奴'] },
  { name: 'Givenchy', slug: 'givenchy', needles: ['givenchy', 'givchy', '纪梵希', '纪希'] },
  { name: 'Versace', slug: 'versace', needles: ['versace', '范思哲'] },
  { name: 'Amiri', slug: 'amiri', needles: ['amiri', '阿米里'] },
  { name: 'Off-White', slug: 'off-white', needles: ['off-white', 'offwhite', 'off white'] },
  { name: 'Palm Angels', slug: 'palm-angels', needles: ['palm angels', '棕榈天使'] },
  { name: 'Fear of God', slug: 'fear-of-god', needles: ['fear of god', 'essentials'] },
  { name: 'Nike', slug: 'nike', needles: ['nike', '耐克'] },
  { name: 'Adidas', slug: 'adidas', needles: ['adidas', '阿迪'] },
  { name: 'Jordan', slug: 'jordan', needles: ['jordan', '乔丹'] },
  { name: 'New Balance', slug: 'new-balance', needles: ['new balance', 'newbalance', '新百伦'] },
  { name: 'Rolex', slug: 'rolex', needles: ['rolex', '劳力士'] },
  { name: 'Cartier', slug: 'cartier', needles: ['cartier', '卡地亚'] },
  { name: 'Omega', slug: 'omega', needles: ['omega', '欧米茄'] },
  { name: 'Richard Mille', slug: 'richard-mille', needles: ['richard mille', '理查德米勒'] },
  { name: 'Descente', slug: 'descente', needles: ['descente', '迪桑特'] },
  { name: 'Goyard', slug: 'goyard', needles: ['goyard', '戈雅'] },
  { name: 'Coach', slug: 'coach', needles: ['coach', '蔻驰'] },
  { name: 'MCM', slug: 'mcm', needles: ['mcm'] },
  { name: 'Kenzo', slug: 'kenzo', needles: ['kenzo', '高田贤三'] },
  { name: 'Moschino', slug: 'moschino', needles: ['moschino'] },
  { name: 'Armani', slug: 'armani', needles: ['armani', '阿玛尼'] },
  { name: 'Zegna', slug: 'zegna', needles: ['zegna', '杰尼亚'] },
  { name: 'Max Mara', slug: 'max-mara', needles: ['max mara', 'maxmara'] },
  { name: "Arc'teryx", slug: 'arcteryx', needles: ['arcteryx', '始祖鸟'] },
  { name: 'The North Face', slug: 'the-north-face', needles: ['north face', '北面'] },
  { name: 'Supreme', slug: 'supreme', needles: ['supreme'] },
  { name: 'Bape', slug: 'bape', needles: ['bape'] },
  { name: 'Stussy', slug: 'stussy', needles: ['stussy'] },
  { name: 'Diesel', slug: 'diesel', needles: ['diesel'] },
  { name: 'Vivienne Westwood', slug: 'vivienne-westwood', needles: ['westwood', '西太后'] },
  { name: 'Comme des Garcons', slug: 'comme-des-garcons', needles: ['comme des garcons', '川久保龄'] },
  { name: 'Issey Miyake', slug: 'issey-miyake', needles: ['issey', '三宅一生'] },
  { name: 'Yohji Yamamoto', slug: 'yohji-yamamoto', needles: ['yohji', '山本耀司'] },
  { name: 'Tiffany', slug: 'tiffany', needles: ['tiffany', '蒂芙尼'] },
  { name: 'Van Cleef & Arpels', slug: 'van-cleef', needles: ['van cleef', 'vancleef', '梵克雅宝'] },
  { name: 'Bulgari', slug: 'bulgari', needles: ['bulgari', '宝格丽'] },
  { name: 'Longchamp', slug: 'longchamp', needles: ['longchamp', '珑骧'] },
  { name: 'Tory Burch', slug: 'tory-burch', needles: ['tory burch'] },
  { name: 'Michael Kors', slug: 'michael-kors', needles: ['michael kors'] },
  { name: 'UGG', slug: 'ugg', needles: ['ugg'] },
  { name: 'Converse', slug: 'converse', needles: ['converse', '匡威'] },
  { name: 'Vans', slug: 'vans', needles: ['vans'] },
  { name: 'Lululemon', slug: 'lululemon', needles: ['lululemon'] },
  { name: 'Ganni', slug: 'ganni', needles: ['ganni'] },
  { name: 'Sandro', slug: 'sandro', needles: ['sandro'] },
  { name: 'Maje', slug: 'maje', needles: ['maje'] },
  { name: 'Lemaire', slug: 'lemaire', needles: ['lemaire'] },
  { name: 'Marni', slug: 'marni', needles: ['marni'] },
  { name: 'Chloe', slug: 'chloe', needles: ['chloe', '蔻依'] },
  { name: 'Uniqlo', slug: 'uniqlo', needles: ['uniqlo', '优衣库'] },
]

const HEADER = [
  'slug',
  'title',
  'description',
  'details',
  'brand',
  'category',
  'gender',
  'status',
  'price',
  'compare_at',
  'featured',
  'colors',
  'sizes',
  'stock',
  'images',
] as const

type Col = (typeof HEADER)[number]

function fold(value: string) {
  return value.toLowerCase().replace(/[’'*]/g, '')
}

function matchBrand(title: string) {
  const text = fold(title)
  const tight = text.replace(/[^a-z0-9\u4e00-\u9fff]+/g, '')
  let best: { name: string; slug: string; len: number } | null = null
  for (const brand of BRANDS) {
    for (const needle of brand.needles) {
      const n = fold(needle)
      // 两三个字母的（lv、tb、ysl）必须单独成词，否则会粘进别的单词。
      // 中文简称没有这个风险，按包含匹配。
      const hit =
        /^[a-z0-9]+$/.test(n) && n.length <= 3
          ? new RegExp(`(^|[^a-z0-9])${n}([^a-z0-9]|$)`).test(text)
          : text.includes(n) || tight.includes(n.replace(/\s+/g, ''))
      if (!hit) continue
      if (!best || n.length > best.len) best = { name: brand.name, slug: brand.slug, len: n.length }
    }
  }
  return best
}

function categoryOf(title: string) {
  const t = title.toLowerCase()
  if (/双肩|backpack/.test(t)) return 'backpacks'
  if (/斜挎|腰包|crossbody/.test(t)) return 'crossbody'
  if (/托特|手提包|手袋|手包|女包|男包|tote/.test(t)) return 'totes'
  if (/靴/.test(t) || /\bboots?\b/.test(t)) return 'boots'
  if (/乐福|loafer/.test(t)) return 'loafers'
  if (/鞋|sneaker|trainer|板鞋|拖鞋|凉鞋/.test(t)) return 'sneakers'
  if (/腕表|手表|机械表|石英/.test(t) || /\bwatch\b/.test(t)) return 'quartz'
  if (/牛仔|denim|jeans/.test(t)) return 'denim'
  if (/针织|毛衣|开衫|羊绒|羊毛衫|knit/.test(t)) return 'knitwear'
  if (/外套|大衣|风衣|羽绒|夹克|皮衣|西装|jacket|coat|blazer/.test(t)) return 'outerwear'
  if (/裤|pants|trouser|shorts|短裤/.test(t)) return 'denim'
  return 'tops'
}

function isJunk(title: string) {
  const t = title.replace(/[^\p{Script=Han}a-zA-Z0-9]/gu, '')
  if (!t) return true
  if (/尺码|尺寸|上身|模特图|效果图|实拍|细节图|详情图/.test(t) && t.length < 16) return true
  if (/原单对版|芯片版|爆款现货|七天无理由|新客户|东莞顶级|配全套包装/.test(t) && t.length < 28) return true
  if (/^(上新|新款|好看|爆款|现货)+$/.test(t)) return true
  return /^p?\d{2,5}$/i.test(t)
}

function csvCell(value: string) {
  return /[",\n\r]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value
}

type Ready = { cells: string[]; brand: string; urls: string[] }

function prepare(text: string) {
  const table = parseCsv(text)
  const header = table[0].map((cell) => cell.trim())
  const at = (name: Col) => header.indexOf(name)
  const ready: Ready[] = []
  let junk = 0
  const brands = new Map<string, number>()
  const cats = new Map<string, number>()

  for (const cells of table.slice(1)) {
    const title = cells[at('title')] ?? ''
    if (isJunk(title)) {
      junk++
      continue
    }
    const brand = matchBrand(title)
    const name = brand?.name ?? 'Other'
    brands.set(name, (brands.get(name) ?? 0) + 1)
    const category = categoryOf(title)
    cats.set(category, (cats.get(category) ?? 0) + 1)
    const next = HEADER.map((key) => cells[at(key)] ?? '')
    next[HEADER.indexOf('brand')] = name
    next[HEADER.indexOf('category')] = category
    next[HEADER.indexOf('status')] = 'active'
    next[HEADER.indexOf('gender')] = 'unisex'
    if (!next[HEADER.indexOf('stock')]) next[HEADER.indexOf('stock')] = DEFAULT_STOCK
    const urls = (cells[at('images')] ?? '')
      .split('|')
      .map((url) => url.trim())
      .filter((url) => /^https?:\/\//i.test(url) && !isVideoUrl(url))
    ready.push({ cells: next, brand: name, urls })
  }

  return { ready, junk, brands, cats }
}

function unmatchedSample(rows: Ready[]) {
  const titles = new Map<string, number>()
  for (const row of rows) {
    if (row.brand !== 'Other') continue
    const title = row.cells[1].replace(/\s+/g, ' ').slice(0, 48)
    titles.set(title, (titles.get(title) ?? 0) + 1)
  }
  return [...titles.entries()].sort((a, b) => b[1] - a[1]).slice(0, 24)
}

function toCsv(rows: Ready[]) {
  const lines = [HEADER.join(',')]
  for (const row of rows) lines.push(row.cells.map(csvCell).join(','))
  return lines.join('\n')
}

/** 只要清晰的那几张。缩略图（大约 320px）和后面的大图是同一批，用了缩略图整页都糊 */
async function localImages() {
  const bySlug = new Map<string, string[]>()
  let names: string[] = []
  try {
    names = readdirSync(IMAGE_DIR)
  } catch {
    return bySlug
  }
  for (const name of names) {
    const full = path.join(IMAGE_DIR, name)
    const meta = await sharp(full).metadata()
    if ((meta.width ?? 0) < MIN_SOURCE_WIDTH) continue
    const slug = name.replace(/-\d+\.[a-z0-9]+$/i, '')
    const list = bySlug.get(slug) ?? []
    list.push(full)
    bySlug.set(slug, list)
  }
  for (const list of bySlug.values()) list.sort()
  return bySlug
}

function forgetRenditions(url: string) {
  const match = url.match(/^\/(uploads|products)\/([a-f0-9]+)-\d+\.webp$/)
  if (!match) return
  for (const width of [...IMAGE_WIDTHS, 'og' as const]) {
    try {
      unlinkSync(path.join('public', match[1], `${match[2]}-${width}.webp`))
    } catch {
      /* 文件已经不在了 */
    }
  }
}

async function writeChunks(rows: Ready[]) {
  let created = 0
  let updated = 0
  const issues: { line: number; message: string }[] = []
  for (let start = 0; start < rows.length; start += CHUNK) {
    const slice = rows.slice(start, start + CHUNK)
    const plan: ImportPlan = await buildPlan(toCsv(slice))
    issues.push(...plan.issues)
    const result = await applyPlan(plan)
    created += result.created
    updated += result.updated
    issues.push(...result.issues)
    console.log(`  已写入 ${Math.min(start + CHUNK, rows.length)} / ${rows.length}`)
  }
  return { created, updated, issues }
}

async function attachImages(rows: Ready[], refresh: boolean) {
  console.log('挑选清晰大图…')
  const local = await localImages()
  const done = new Set<string>()
  if (refresh && existsSync(DONE_FILE)) {
    for (const line of readFileSync(DONE_FILE, 'utf8').split(/\r?\n/)) {
      if (line.trim()) done.add(line.trim())
    }
  }

  let added = 0
  let failed = 0
  let skipped = 0
  let note = Promise.resolve()
  const queue = rows.filter((row) => row.urls.length || local.has(row.cells[0]))
  let cursor = 0

  async function sourcesFor(row: Ready): Promise<Buffer[]> {
    const hd = local.get(row.cells[0]) ?? []
    // 本地大图不少于链接数时直接用，省一次下载。否则链接才是全套图
    if (hd.length && hd.length >= row.urls.length) {
      return hd.slice(0, MAX_IMPORT_IMAGES).map((file) => readFileSync(file))
    }
    const buffers: Buffer[] = []
    for (const url of row.urls.slice(0, MAX_IMPORT_IMAGES)) {
      const fetched = await fetchRemoteImage(url)
      if (!fetched.ok) {
        failed++
        continue
      }
      buffers.push(fetched.buffer)
    }
    return buffers
  }

  async function one() {
    while (cursor < queue.length) {
      const row = queue[cursor++]
      const slug = row.cells[0]
      const title = row.cells[1]
      if (refresh && done.has(slug)) {
        skipped++
        continue
      }

      const product = await db.product.findUnique({
        where: { slug },
        select: { id: true, images: { select: { url: true } } },
      })
      if (!product) continue
      if (!refresh && product.images.length) {
        skipped++
        continue
      }

      const buffers = await sourcesFor(row)
      if (!buffers.length) continue

      if (refresh && product.images.length) {
        for (const image of product.images) forgetRenditions(image.url)
        await db.productImage.deleteMany({ where: { productId: product.id } })
      }
      let position = 0
      for (const buffer of buffers) {
        try {
          const processed = await processImage(buffer, {
            dir: 'uploads',
            crop: 'full',
            withOg: position === 0,
          })
          await db.productImage.create({
            data: { productId: product.id, ...processed, alt: title.slice(0, 200), position },
          })
          position++
          added++
        } catch {
          failed++
        }
      }

      if (refresh && position) {
        const line = `${slug}\n`
        note = note.then(() => {
          appendFileSync(DONE_FILE, line)
        })
        done.add(slug)
      }

      if (cursor % 25 === 0) console.log(`  配图 ${cursor} / ${queue.length}，已写入 ${added} 张`)
    }
  }

  await Promise.all(Array.from({ length: 4 }, () => one()))
  await note
  console.log(`配图完成：写入 ${added} 张，跳过 ${skipped}，失败 ${failed}`)
}

const dry = process.argv.includes('--dry')
const imagesOnly = process.argv.includes('--images-only')
const refreshImages = process.argv.includes('--refresh-images')
const { ready, junk, brands, cats } = prepare(readFileSync(CSV, 'utf8'))
console.log(`可导入 ${ready.length}，跳过 ${junk} 条非商品`)
console.log('--- 品牌 ---')
for (const [name, count] of [...brands.entries()].sort((a, b) => b[1] - a[1]).slice(0, 25)) {
  console.log(String(count).padStart(5), name)
}
console.log('--- 类目 ---')
for (const [name, count] of [...cats.entries()].sort((a, b) => b[1] - a[1])) {
  console.log(String(count).padStart(5), name)
}
if (dry) {
  console.log('--- 没认出品牌的标题 ---')
  for (const [title, count] of unmatchedSample(ready)) console.log(String(count).padStart(4), title)
}

if (dry) {
  await db.$disconnect()
} else {
  if (!imagesOnly) {
    console.log('写入商品…')
    const result = await writeChunks(ready)
    console.log(`新建 ${result.created}，更新 ${result.updated}，问题 ${result.issues.length}`)
    for (const issue of result.issues.slice(0, 12)) console.log(`  第 ${issue.line} 行 ${issue.message}`)
  }
  if (!process.argv.includes('--no-images')) {
    console.log(refreshImages ? '换成清晰大图…' : '配图…')
    await attachImages(ready, refreshImages)
  }
  await db.$disconnect()
}
