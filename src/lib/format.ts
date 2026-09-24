const usdWhole = new Intl.NumberFormat('en-US', {
  style: 'currency',
  currency: 'USD',
  minimumFractionDigits: 0,
  maximumFractionDigits: 0,
})

const usdCents = new Intl.NumberFormat('en-US', {
  style: 'currency',
  currency: 'USD',
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
})

export function formatPrice(cents: number): string {
  return (cents % 100 === 0 ? usdWhole : usdCents).format(cents / 100)
}

/**
 * 批量导入时用来把「表格里写的文件名」和「实际选中的图片」对上。
 *
 * 浏览器要靠它挑出这个商品该带哪几张图，服务端要靠它做最终匹配 ——
 * 两边必须是同一个函数，各写一份一旦漂了，症状是图片悄悄没配上，很难查。
 *
 * 去掉路径前缀是因为厂家常常连文件夹一起写（`图片/bag-1.jpg`），
 * 而 input 给的 File.name 只有文件名本身。
 */
export function fileKey(name: string): string {
  return name.split(/[\\/]/).pop()!.trim().toLowerCase()
}
