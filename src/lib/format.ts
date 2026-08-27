const usd = new Intl.NumberFormat('en-US', {
  style: 'currency',
  currency: 'USD',
  // 商品价格都是整数美元，小数位只会让排版更碎
  minimumFractionDigits: 0,
  maximumFractionDigits: 2,
})

export function formatPrice(cents: number): string {
  return usd.format(cents / 100)
}
