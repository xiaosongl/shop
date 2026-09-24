'use client'

import { useRouter } from 'next/navigation'
import { useMemo, useRef, useState } from 'react'
import { importProductImages, previewImport, runImport } from '@/lib/admin-actions'
import { fileKey, formatPrice } from '@/lib/format'
import type { ImportPlan, ImportResult } from '@/lib/product-import'
import { FilterInput } from './filter-input'
import { Card, PAGE_SIZE, PageHeader } from './ui'

type Column = { key: string; label: string; hint: string }

type Phase =
  | { at: 'idle' }
  | { at: 'reading' }
  | { at: 'preview'; plan: ImportPlan }
  | { at: 'writing' }
  | { at: 'images'; done: number; total: number; current: string }
  | { at: 'done'; result: ImportResult; images: number; failed: string[] }

export function ImportProducts({
  columns,
  categories,
}: {
  columns: Column[]
  categories: { slug: string; nameZh: string }[]
}) {
  const router = useRouter()
  const [csv, setCsv] = useState('')
  const [name, setName] = useState('')
  const [images, setImages] = useState<Map<string, File>>(new Map())
  const [phase, setPhase] = useState<Phase>({ at: 'idle' })
  const [error, setError] = useState('')
  const fileRef = useRef<HTMLInputElement>(null)
  const imageRef = useRef<HTMLInputElement>(null)

  const template = useMemo(() => {
    const header = columns.map((c) => c.key).join(',')
    const sample = [
      'canvas-weekender',
      'Canvas Weekender',
      '"Waxed canvas holdall with a leather base."',
      'Waxed cotton|Leather trim|48cm',
      'Northwell',
      'bags',
      'unisex',
      'active',
      '189.00',
      '240.00',
      'no',
      'Sand:#d9cfc0, Black:#141414',
      'OS',
      '12',
      'https://example.com/bag-1.jpg|https://example.com/bag-2.jpg',
    ].join(',')
    return `${header}\n${sample}\n`
  }, [columns])

  async function pick(file: File | undefined) {
    if (!file) return
    setError('')
    setPhase({ at: 'reading' })
    const text = await file.text()
    setCsv(text)
    setName(file.name)
    const plan = await previewImport(text)
    setPhase({ at: 'preview', plan })
  }

  async function commit() {
    setError('')
    setPhase({ at: 'writing' })
    const result = await runImport(csv)

    // 配图一个商品一次请求：单次很短，碰不到 Cloudflare 那 100 秒的上限，
    // 中途关掉页面也只是停在这儿，重传同一份表能接着配
    let added = 0
    const failed: string[] = []
    for (const [at, item] of result.pending.entries()) {
      setPhase({ at: 'images', done: at, total: result.pending.length, current: item.title })

      const form = new FormData()
      form.set('slug', item.slug)
      form.set('sources', JSON.stringify(item.images))
      // 只带这个商品用得上的几张，别把整个文件夹每次都传一遍
      for (const source of item.images) {
        const file = images.get(fileKey(source))
        if (file) form.append('files', file)
      }

      const one = await importProductImages(form)
      added += one.added
      if (one.message) failed.push(`${item.title}：${one.message}`)
    }

    setPhase({ at: 'done', result, images: added, failed })
    router.refresh()
  }

  function reset() {
    setCsv('')
    setName('')
    setImages(new Map())
    setError('')
    setPhase({ at: 'idle' })
    if (fileRef.current) fileRef.current.value = ''
    if (imageRef.current) imageRef.current.value = ''
  }

  return (
    <>
      <PageHeader
        title="批量导入商品"
        action={
          <a
            href={`data:text/csv;charset=utf-8,${encodeURIComponent('\ufeff' + template)}`}
            download="商品导入模板.csv"
            className="border border-line px-4 py-2 text-sm transition-colors hover:border-ink"
          >
            下载模板
          </a>
        }
      />

      {phase.at === 'idle' && (
        <>
          <Card className="p-5">
            <p className="text-sm">选一个 CSV 文件</p>
            <p className="mt-1 text-xs text-faint">
              Excel 里「另存为 CSV UTF-8」即可。图片在下一步选，表格里写文件名就行，不用先传到网上。
            </p>
            <input
              ref={fileRef}
              type="file"
              accept=".csv,text/csv"
              onChange={(event) => pick(event.target.files?.[0])}
              className="mt-4 block w-full text-sm file:mr-3 file:border file:border-line file:bg-white file:px-3 file:py-1.5 file:text-sm"
            />
          </Card>

          <Card className="mt-5 overflow-x-auto">
            <table className="w-full min-w-[40rem] text-sm">
              <thead>
                <tr className="border-b border-line text-left">
                  <th className="px-4 py-3 text-xs font-normal text-faint">列名</th>
                  <th className="px-4 py-3 text-xs font-normal text-faint">含义</th>
                  <th className="px-4 py-3 text-xs font-normal text-faint">说明</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {columns.map((column) => (
                  <tr key={column.key}>
                    <td className="px-4 py-2.5 font-mono text-xs">{column.key}</td>
                    <td className="px-4 py-2.5">{column.label}</td>
                    <td className="px-4 py-2.5 text-xs text-faint">{column.hint}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Card>

          <Card className="mt-5 p-5">
            <p className="text-sm">类目只能从下面这些里选</p>
            <p className="mt-1 text-xs text-faint">
              类目是固定的，后台建不了新类目。填 slug 或中文名都认。
            </p>
            <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1.5">
              {categories.map((category) => (
                <span key={category.slug} className="text-xs">
                  <span className="font-mono">{category.slug}</span>
                  <span className="ml-1 text-faint">{category.nameZh}</span>
                </span>
              ))}
            </div>
          </Card>
        </>
      )}

      {phase.at === 'reading' && <Busy>正在读取并校验…</Busy>}
      {phase.at === 'writing' && <Busy>正在写入商品…</Busy>}
      {phase.at === 'images' && (
        <Busy>
          正在配图 {phase.done + 1} / {phase.total} · {phase.current}
        </Busy>
      )}

      {phase.at === 'preview' && (
        <Preview
          plan={phase.plan}
          name={name}
          images={images}
          imageRef={imageRef}
          onImages={(picked) => setImages(new Map(picked.map((file) => [fileKey(file.name), file])))}
          onCancel={reset}
          onCommit={commit}
        />
      )}

      {phase.at === 'done' && (
        <Card className="p-5">
          <p className="text-sm">
              导入完成：新建 {phase.result.created} 个，更新 {phase.result.updated} 个，
              配了 {phase.images} 张图。
          </p>
          {phase.result.brands.length > 0 && (
            <p className="mt-2 text-xs text-faint">
              顺带新建了品牌：{phase.result.brands.join('、')}。名字拼错的话去品牌页改。
            </p>
          )}
          {phase.failed.length > 0 && (
            <div className="mt-3 border border-line bg-shell p-3">
                <p className="text-xs">有 {phase.failed.length} 个商品的图没配全：</p>
              <ul className="mt-1 space-y-0.5">
                {phase.failed.slice(0, 10).map((line) => (
                  <li key={line} className="text-xs text-faint">
                    {line}
                  </li>
                ))}
              </ul>
              <p className="mt-2 text-xs text-faint">
                补齐图片后重传同一份表格即可，已经有图的商品会自动跳过。
              </p>
            </div>
          )}
          <div className="mt-4 flex gap-2">
            <a
              href="/admin/products"
              className="bg-ink px-4 py-2 text-sm text-white transition-opacity hover:opacity-85"
            >
              去看商品列表
            </a>
            <button
              type="button"
              onClick={reset}
              className="border border-line px-4 py-2 text-sm transition-colors hover:border-ink"
            >
              再导一批
            </button>
          </div>
        </Card>
      )}

      {error && <p className="mt-4 text-sm text-sale">{error}</p>}
    </>
  )
}

function Busy({ children }: { children: React.ReactNode }) {
  return (
    <Card className="p-8 text-center">
      <p className="text-sm text-muted">{children}</p>
    </Card>
  )
}

const isUrl = (source: string) => /^https?:\/\//i.test(source)

function Preview({
  plan,
  name,
  images,
  imageRef,
  onImages,
  onCancel,
  onCommit,
}: {
  plan: ImportPlan
  name: string
  images: Map<string, File>
  imageRef: React.RefObject<HTMLInputElement | null>
  onImages: (files: File[]) => void
  onCancel: () => void
  onCommit: () => void
}) {
  const [query, setQuery] = useState('')
  const [page, setPage] = useState(1)
  const needle = query.trim().toLowerCase()
  const filtered = plan.rows.filter(
    (row) =>
      !needle ||
      row.values.title.toLowerCase().includes(needle) ||
      row.values.slug.toLowerCase().includes(needle) ||
      row.brandLabel.toLowerCase().includes(needle),
  )
  const pages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE))
  const current = Math.min(page, pages)
  const visible = filtered.slice((current - 1) * PAGE_SIZE, current * PAGE_SIZE)

  const creates = plan.rows.filter((row) => row.action === 'create').length
  const updates = plan.rows.length - creates
  const withImages = plan.rows.filter((row) => row.images.length).length

  // 表格里没写成网址的都当本地文件名，要人把对应的图一起选上
  const wanted = [...new Set(plan.rows.flatMap((row) => row.images).filter((s) => !isUrl(s)))]
  const missing = wanted.filter((source) => !images.has(fileKey(source)))

  return (
    <>
      <Card className="p-5">
        <p className="text-sm">
          {name}：可导入 {plan.rows.length} 行（新建 {creates}，更新 {updates}）
          {plan.issues.length > 0 && `，${plan.issues.length} 行有问题会被跳过`}
        </p>
        {withImages > 0 && (
          <p className="mt-1 text-xs text-faint">
            其中 {withImages} 个商品要配图，写完商品后会逐个配，别关页面。
          </p>
        )}
        {plan.newBrands.length > 0 && (
          <p className="mt-2 text-xs text-faint">
            会新建品牌：{plan.newBrands.map((brand) => brand.name || brand.slug).join('、')}
          </p>
        )}

        {wanted.length > 0 && (
          <div className="mt-4 border border-line bg-shell p-4">
            <p className="text-sm">
              表格里引用了 {wanted.length} 个本地图片文件，选中它们
              {missing.length === 0 && <span className="ml-2 text-emerald-700">已全部找到</span>}
            </p>
            <p className="mt-1 text-xs text-faint">
              在图片文件夹里全选（Ctrl+A）就行，多选的不会被用到。
            </p>
            <input
              ref={imageRef}
              type="file"
              accept="image/*"
              multiple
              onChange={(event) => onImages([...(event.target.files ?? [])])}
              className="mt-3 block w-full text-sm file:mr-3 file:border file:border-line file:bg-white file:px-3 file:py-1.5 file:text-sm"
            />
            {missing.length > 0 && (
              <p className="mt-2 text-xs text-sale">
                还差 {missing.length} 张：{missing.slice(0, 6).join('、')}
                {missing.length > 6 && ` 等`}
              </p>
            )}
          </div>
        )}

        <div className="mt-4 flex gap-2">
          <button
            type="button"
            onClick={onCommit}
            disabled={!plan.rows.length}
            className="bg-ink px-4 py-2 text-sm text-white transition-opacity hover:opacity-85 disabled:opacity-40"
          >
            确认导入
          </button>
          <button
            type="button"
            onClick={onCancel}
            className="border border-line px-4 py-2 text-sm transition-colors hover:border-ink"
          >
            换个文件
          </button>
        </div>
      </Card>

      {plan.issues.length > 0 && (
        <Card className="mt-5 p-5">
          <p className="text-sm text-sale">这些行会被跳过</p>
          <ul className="mt-2 space-y-1">
            {plan.issues.slice(0, 30).map((issue) => (
              <li key={`${issue.line}-${issue.message}`} className="text-xs text-muted">
                第 {issue.line} 行：{issue.message}
              </li>
            ))}
          </ul>
          {plan.issues.length > 30 && (
            <p className="mt-2 text-xs text-faint">还有 {plan.issues.length - 30} 条没列出来</p>
          )}
        </Card>
      )}

      {plan.rows.length > 0 && (
        <Card className="mt-5 overflow-x-auto">
          <div className="px-4 pt-4">
            <FilterInput
              value={query}
              onChange={(value) => {
                setQuery(value)
                setPage(1)
              }}
              placeholder="搜索预览里的商品、slug 或品牌"
            />
          </div>
          <table className="w-full min-w-[52rem] text-sm">
            <thead>
              <tr className="border-b border-line text-left">
                {['行', '操作', '商品', '品牌', '类目', '价格', '库存', '图'].map((cell) => (
                  <th key={cell} className="px-4 py-3 text-xs font-normal text-faint">
                    {cell}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {visible.map((row) => (
                <tr key={row.line}>
                  <td className="px-4 py-2.5 tabular-nums text-faint">{row.line}</td>
                  <td className="px-4 py-2.5">
                    <span
                      className={`px-2 py-0.5 text-xs ${
                        row.action === 'create'
                          ? 'bg-emerald-100 text-emerald-900'
                          : 'bg-amber-100 text-amber-900'
                      }`}
                    >
                      {row.action === 'create' ? '新建' : '更新'}
                    </span>
                  </td>
                  <td className="px-4 py-2.5">
                    <span className="block">{row.values.title}</span>
                    <span className="block font-mono text-xs text-faint">{row.values.slug}</span>
                  </td>
                  <td className="px-4 py-2.5 text-muted">{row.brandLabel}</td>
                  <td className="px-4 py-2.5 text-muted">{row.categoryLabel}</td>
                  <td className="px-4 py-2.5 tabular-nums">{formatPrice(row.values.priceCents)}</td>
                  <td className="px-4 py-2.5 tabular-nums text-muted">{row.stock ?? '不改'}</td>
                  <td className="px-4 py-2.5 tabular-nums text-muted">
                    {row.images.length}
                    {row.images.some((s) => !isUrl(s)) &&
                      row.images.every((s) => isUrl(s) || images.has(fileKey(s))) && (
                        <span className="ml-1 text-emerald-700">✓</span>
                      )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {pages > 1 && (
            <div className="flex items-center justify-between px-4 py-3">
              <p className="text-xs text-faint">
                第 {current} / {pages} 页 · 共 {filtered.length} 行
              </p>
              <div className="flex gap-2">
                <button
                  type="button"
                  disabled={current <= 1}
                  onClick={() => setPage(current - 1)}
                  className="border border-line px-3 py-1.5 text-sm disabled:text-faint disabled:opacity-50"
                >
                  上一页
                </button>
                <button
                  type="button"
                  disabled={current >= pages}
                  onClick={() => setPage(current + 1)}
                  className="border border-line px-3 py-1.5 text-sm disabled:text-faint disabled:opacity-50"
                >
                  下一页
                </button>
              </div>
            </div>
          )}
          {filtered.length === 0 && (
            <p className="px-4 py-8 text-center text-sm text-faint">没有匹配的预览行</p>
          )}
        </Card>
      )}
    </>
  )
}
