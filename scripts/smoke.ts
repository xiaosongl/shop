/**
 * 冒烟检查，分两部分：
 *   A. 前台路由——性别 -> 品牌 -> 类别 -> 商品列表 这条链路真的通（需要 dev server 在跑）
 *   B. 结算逻辑——服务端定价、包装折扣、库存原子扣减、订单查询（直接调用，不走 HTTP）
 *
 * 用例里的 slug 全部从库里现算，改了种子数据也不用回来改脚本。
 * B 部分会真的下一单，跑完自己删掉订单并把库存还回去。
 *
 * 用法：npm run dev 之后 npm run check
 */
import { MAX_QUANTITY, SHIPPING_METHODS, clampQuantity, totalsFor } from '../src/lib/totals'
import { GENDER_SLUGS, genderValues } from '../src/lib/taxonomy'

// 这个脚本不经过 Next，得自己把 .env 读进来。db.ts 在模块顶层就读 DATABASE_URL，
// 而 ESM 的 import 会被提升到所有语句之前，所以这两个模块只能动态引入。
process.loadEnvFile?.()
const { findOrder, placeOrder, resolveCart, submitTxid } = await import('../src/lib/actions')
const { db } = await import('../src/lib/db')

const ADDRESS = {
  email: 'demo@example.com',
  name: 'Smoke Test',
  line1: '1 Test Street',
  city: 'Portland',
  state: 'OR',
  postalCode: '97205',
  country: 'United States',
}

const BASE = process.env.SMOKE_URL ?? 'http://127.0.0.1:3000'

let failed = 0
function check(name: string, ok: boolean, detail = '') {
  if (!ok) failed++
  console.log(`[${ok ? ' ok ' : 'FAIL'}] ${name}${detail ? '  ' + detail : ''}`)
}

type RouteCheck = { path: string; status: number; minProducts?: number }

async function routeChecks(): Promise<RouteCheck[]> {
  const checks: RouteCheck[] = [
    { path: '/', status: 200 },
    { path: '/cart', status: 200 },
    { path: '/checkout', status: 200 },
    { path: '/orders', status: 200 },
    { path: '/search?q=jean', status: 200 },
    { path: '/kids', status: 404 },
    { path: '/order/NS-NOPE', status: 404 },
  ]

  const parents = await db.category.findMany({
    where: { parentId: null },
    select: { slug: true, children: { select: { id: true } } },
  })

  for (const gender of GENDER_SLUGS) {
    const scope = { status: 'ACTIVE', gender: { in: genderValues(gender) } } as const
    checks.push({ path: `/${gender}`, status: 200 })
    checks.push({ path: `/${gender}/not-a-real-brand`, status: 404 })

    // 挑该性别下有货最多的品牌，覆盖尽量多的类别
    const brands = await db.brand.findMany({ select: { id: true, slug: true } })
    let picked: { id: string; slug: string; count: number } | null = null
    for (const brand of brands) {
      const count = await db.product.count({ where: { ...scope, brandId: brand.id } })
      if (count > (picked?.count ?? 0)) picked = { ...brand, count }
    }
    if (!picked) throw new Error(`${gender} 下一个品牌都没有货`)

    checks.push({ path: `/${gender}/${picked.slug}`, status: 200 })

    const carried: string[] = []
    for (const parent of parents) {
      const count = await db.product.count({
        where: {
          ...scope,
          brandId: picked.id,
          categoryId: { in: parent.children.map((child) => child.id) },
        },
      })
      if (count > 0) {
        carried.push(parent.slug)
        checks.push({
          path: `/${gender}/${picked.slug}/${parent.slug}`,
          status: 200,
          minProducts: 1,
        })
      }
    }

    // 该品牌该性别下没有的类别必须 404，不能渲染成一个空列表
    const missing = parents.find((parent) => !carried.includes(parent.slug))
    if (missing) checks.push({ path: `/${gender}/${picked.slug}/${missing.slug}`, status: 404 })
  }

  const product = await db.product.findFirst({ where: { status: 'ACTIVE' }, select: { slug: true } })
  if (product) checks.push({ path: `/p/${product.slug}`, status: 200 })

  return checks
}

async function runRoutes() {
  console.log('— 前台路由 —')
  for (const item of await routeChecks()) {
    const response = await fetch(BASE + item.path)
    const html = response.status === 200 ? await response.text() : ''
    const products = new Set(html.match(/href="\/p\/[a-z0-9-]+"/g) ?? []).size

    const problems: string[] = []
    if (response.status !== item.status) problems.push(`期望 ${item.status} 实际 ${response.status}`)
    if (item.minProducts != null && products < item.minProducts) {
      problems.push(`商品数 ${products} < ${item.minProducts}`)
    }

    check(
      item.path,
      problems.length === 0,
      problems.length ? problems.join('，') : item.minProducts != null ? `${products} 件` : '',
    )
  }
}

async function runCheckout() {
  console.log('\n— 结算逻辑 —')

  // 挑一件贵到能被 $15 折扣完整减掉的，否则折扣会被夹到小计
  const variant = await db.productVariant.findFirst({
    where: { stock: { gte: 2 }, product: { status: 'ACTIVE', priceCents: { gt: 3000 } } },
    select: { id: true, stock: true, product: { select: { priceCents: true } } },
  })
  if (!variant) throw new Error('没有合适的 SKU 可用于测试结算')

  const price = variant.product.priceCents
  const subtotal = price * 2

  // 客户端就算传了假价格，服务端也只按数据库算
  const boxed = await resolveCart(
    [
      { variantId: variant.id, quantity: 2 },
      { variantId: 'does-not-exist', quantity: 1 },
    ],
    'boxed',
  )
  check('失效 SKU 被剔除', boxed.removed.includes('does-not-exist'))
  check('价格取自数据库', boxed.lines[0]?.unitPriceCents === price, `${boxed.lines[0]?.unitPriceCents}`)
  check('带盒不打折', boxed.discountCents === 0 && boxed.totalCents === totalsFor(subtotal, 'boxed').totalCents)

  const discreet = await resolveCart([{ variantId: variant.id, quantity: 2 }], 'discreet')
  check(
    '不带盒减 $15',
    discreet.discountCents === SHIPPING_METHODS.discreet.discountCents &&
      discreet.totalCents === totalsFor(subtotal, 'discreet').totalCents,
    `${boxed.totalCents} -> ${discreet.totalCents}`,
  )

  // 传个不认识的运输方式，应该退回 boxed 而不是崩掉
  const bogus = await resolveCart([{ variantId: variant.id, quantity: 2 }], 'free-lunch')
  check('未知运输方式退回 boxed', bogus.shippingMethod === 'boxed' && bogus.discountCents === 0)

  const greedy = await resolveCart([{ variantId: variant.id, quantity: MAX_QUANTITY }], 'boxed')
  const expected = Math.min(variant.stock, MAX_QUANTITY)
  check('超库存被夹取', greedy.lines[0]?.quantity === expected, `${greedy.lines[0]?.quantity} / 库存 ${variant.stock}`)

  // 同一件加购两次把总数顶过上限，是最普通不过的买法。
  // 这里要是整个数组解析失败，购物车会静默变空，而本地那条坏数据没人清得掉。
  const overflow = await resolveCart(
    [{ variantId: variant.id, quantity: MAX_QUANTITY + 5 }],
    'boxed',
  )
  check('数量超上限不清空整车', overflow.lines.length === 1, `${overflow.lines.length} 行`)
  check('超上限的行夹到上限', overflow.lines[0]?.quantity === expected)
  check('并且告诉前端这行被改过', overflow.clamped.includes(variant.id))

  // 本地存的东西不可信，进程序之前先收敛
  check('数量收敛：超上限', clampQuantity(MAX_QUANTITY + 2) === MAX_QUANTITY)
  check('数量收敛：零和负数归一', clampQuantity(0) === 1 && clampQuantity(-3) === 1)
  check('数量收敛：小数截断', clampQuantity(2.7) === 2)
  check('数量收敛：NaN 归一', clampQuantity(Number.NaN) === 1)

  const form = { ...ADDRESS, shippingMethod: 'discreet', paymentMethod: 'whatsapp' }

  check(
    '非法邮箱被拒',
    await placeOrder([{ variantId: variant.id, quantity: 1 }], { ...form, email: 'nope' }).then(
      (r) => !r.ok && 'fieldErrors' in r && !!r.fieldErrors.email,
    ),
  )
  check(
    '未知支付方式被拒',
    await placeOrder([{ variantId: variant.id, quantity: 1 }], {
      ...form,
      paymentMethod: 'cash',
    }).then((r) => !r.ok),
  )
  check('空购物车被拒', await placeOrder([], form).then((r) => !r.ok))

  const result = await placeOrder([{ variantId: variant.id, quantity: 2 }], form)
  check('下单成功', result.ok, result.ok ? result.number : JSON.stringify(result))
  if (!result.ok) return

  const after = await db.productVariant.findUniqueOrThrow({ where: { id: variant.id } })
  check('库存已扣减', after.stock === variant.stock - 2, `${variant.stock} -> ${after.stock}`)

  const order = await db.order.findUniqueOrThrow({
    where: { number: result.number },
    include: { items: true },
  })
  check('落库为待付款', order.status === 'PENDING')
  check('折扣与运输方式一致', order.discountCents === SHIPPING_METHODS.discreet.discountCents)
  check('落库金额与算法一致', order.totalCents === totalsFor(subtotal, 'discreet').totalCents)
  check('订单快照了成交价', order.items[0]?.unitPriceCents === price)

  const found = await findOrder({ number: result.number, email: form.email })
  check('订单查询命中', found.ok)
  const wrong = await findOrder({ number: result.number, email: 'someone.else@example.com' })
  check('邮箱不符查不到', !wrong.ok)

  // 收尾：把这一单和库存还原，别污染演示数据
  await db.order.delete({ where: { id: order.id } })
  await db.productVariant.update({ where: { id: variant.id }, data: { stock: variant.stock } })
  const restored = await db.productVariant.findUniqueOrThrow({ where: { id: variant.id } })
  check('测试数据已还原', restored.stock === variant.stock)
}

// 格式合法的公开地址，只用来验格式，不是谁的钱包
const SAMPLE = {
  tron: 'TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t',
  evm: '0xdAC17F958D2ee523a2206206994597C13D831ec7',
  solana: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v',
  bitcoin: 'bc1qar0srrr7xfkvy5l643lydnw9re59gtzzwf5mdq',
}

/**
 * 收款地址的跨链校验。这是整套支付里最要命的一条：
 * 把 TRC20 的地址当 ERC20 存下去，之后每一笔货款都进黑洞且不可逆。
 */
async function runAddresses() {
  console.log('\n— 地址校验 —')

  const { asset } = await import('../src/lib/crypto')

  check('Tron 地址认得出', asset('usdt-trc20').isAddress(SAMPLE.tron))
  check('ERC20 地址认得出', asset('usdt-erc20').isAddress(SAMPLE.evm))
  check('Solana 地址认得出', asset('usdc-sol').isAddress(SAMPLE.solana))
  check('BTC 地址认得出', asset('btc').isAddress(SAMPLE.bitcoin))

  // 反过来一律不能过——混填就是丢钱
  check('Tron 地址不能当 ERC20 用', !asset('usdt-erc20').isAddress(SAMPLE.tron))
  check('ERC20 地址不能当 Tron 用', !asset('usdt-trc20').isAddress(SAMPLE.evm))
  check('BTC 地址不能当 ERC20 用', !asset('usdt-erc20').isAddress(SAMPLE.bitcoin))
  check('ERC20 地址不能当 BTC 用', !asset('btc').isAddress(SAMPLE.evm))
  check('缺字符的地址被拒', !asset('usdt-trc20').isAddress(SAMPLE.tron.slice(0, -1)))
  check('空地址被拒', !asset('btc').isAddress(''))

  // TXID 格式同理，EVM 带 0x 前缀，Tron 不带
  check('ERC20 的 TXID 要带 0x', asset('usdt-erc20').isTxid('0x' + 'a'.repeat(64)))
  check('ERC20 不收裸 hex', !asset('usdt-erc20').isTxid('a'.repeat(64)))
  check('Tron 收裸 hex', asset('usdt-trc20').isTxid('a'.repeat(64)))
  check('Tron 不收 0x 前缀', !asset('usdt-trc20').isTxid('0x' + 'a'.repeat(64)))
}

/**
 * 下单走两种币各一遍：
 * 稳定币不查行情，任何时候都该成功；波动币要真取一次汇率，
 * 取不到就跳过而不是失败——但绝不能静默通过，金额算错是真金白银的事。
 */
async function runCrypto() {
  console.log('\n— 加密货币下单 —')

  const { asset } = await import('../src/lib/crypto')

  // 结算页拿 payable[0] 当预选项，所以顺序就是默认值。谁把 crypto 挪回第一位这里就会响。
  const { PAYMENT_METHODS, PAYMENT_METHOD_KEYS } = await import('../src/lib/payments')
  check('默认支付方式是本地支付', PAYMENT_METHOD_KEYS[0] === 'whatsapp', PAYMENT_METHOD_KEYS[0])
  const local = PAYMENT_METHODS.whatsapp.note
  check(
    '本地支付写明了收款方式',
    /credit card/i.test(local) && /PayPal/i.test(local) && /wallet/i.test(local),
  )

  // 先把测试要用的币配上，跑完还原
  const before = await db.cryptoWallet.findMany()
  await db.cryptoWallet.deleteMany()
  await db.cryptoWallet.createMany({
    data: [
      { assetKey: 'usdt-trc20', address: SAMPLE.tron, enabled: true },
      { assetKey: 'btc', address: SAMPLE.bitcoin, enabled: true },
      { assetKey: 'usdc-erc20', address: SAMPLE.evm, enabled: false },
    ],
  })

  const variant = await db.productVariant.findFirstOrThrow({
    where: { stock: { gte: 2 }, product: { status: 'ACTIVE' } },
    select: { id: true, stock: true },
  })

  const order = async (cryptoAsset: string) =>
    placeOrder([{ variantId: variant.id, quantity: 1 }], {
      ...ADDRESS,
      shippingMethod: 'boxed',
      paymentMethod: 'crypto',
      cryptoAsset,
    })

  check('没开的币不能下单', await order('usdc-erc20').then((r) => !r.ok))
  check('目录里没有的币不能下单', await order('doge').then((r) => !r.ok))
  check('不传币种不能下单', await order('').then((r) => !r.ok))

  // ---- 稳定币 ----
  const stable = await order('usdt-trc20')
  check('稳定币下单成功', stable.ok, stable.ok ? stable.number : stable.message)
  if (stable.ok) {
    const row = await db.order.findUniqueOrThrow({ where: { number: stable.number } })
    check('稳定币锁的是 1:1 汇率', row.cryptoRateCents === 100, String(row.cryptoRateCents))
    check(
      '应付数额等于美元总价',
      Number(row.cryptoAmount) * 100 === row.totalCents,
      `${row.cryptoAmount} USDT / $${row.totalCents / 100}`,
    )
    check('记下了是哪条链', row.cryptoAsset === 'usdt-trc20')

    const html = await fetch(`${BASE}/order/${row.number}`).then((r) => r.text())
    check('付款页出二维码', html.includes('data:image/png;base64'))
    check('付款页出 Tron 地址', html.includes(SAMPLE.tron))
    check('付款页警示了链别填错', html.includes('permanently lost'))

    // Tron 收裸 hex，带 0x 的是 EVM 格式，必须拒掉
    const crossChain = await submitTxid(row.number, '0x' + 'a'.repeat(64))
    check('串链的 TXID 被拒', crossChain.state === 'rejected')

    // 这个哈希链上不存在，核验查不到 → 只记录不放行，绝不能当成付过了
    const fake = await submitTxid(row.number, 'a'.repeat(64))
    check('链上查不到时不放行', fake.state === 'pending', fake.state)
    const afterFake = await db.order.findUniqueOrThrow({ where: { id: row.id } })
    check('没核实过的单还挂在待付款', afterFake.status === 'PENDING')
    check('TXID 已记下待人工核', afterFake.cryptoTxid === 'a'.repeat(64))
    check('没盖链上核实的章', afterFake.cryptoVerifiedAt === null)

    await db.order.delete({ where: { id: row.id } })
  }

  // ---- 波动币 ----
  const volatile = await order('btc')
  if (!volatile.ok) {
    console.log(`[skip] BTC 跳过：${volatile.message}`)
  } else {
    const row = await db.order.findUniqueOrThrow({ where: { number: volatile.number } })
    check('波动币锁了实时汇率', (row.cryptoRateCents ?? 0) > 100)
    check(
      '应付 BTC 与美元总价对得上',
      Math.abs(Number(row.cryptoAmount) * row.cryptoRateCents! - row.totalCents) < 1,
      `${row.cryptoAmount} BTC @ $${((row.cryptoRateCents ?? 0) / 100).toLocaleString('en-US')}`,
    )
    check('小数位按币种给足', row.cryptoAmount!.split('.')[1]?.length === asset('btc').decimals)
    await db.order.delete({ where: { id: row.id } })
  }

  await db.productVariant.update({ where: { id: variant.id }, data: { stock: variant.stock } })
  await db.cryptoWallet.deleteMany()
  if (before.length) {
    await db.cryptoWallet.createMany({
      data: before.map(({ assetKey, address, enabled }) => ({ assetKey, address, enabled })),
    })
  }
  const restored = await db.productVariant.findUniqueOrThrow({ where: { id: variant.id } })
  check('测试数据已还原', restored.stock === variant.stock)
}

/**
 * 后台。写操作要 cookies() 上下文，脚本里调不了，
 * 所以走 HTTP：验鉴权边界拦得住、页面渲染得出来，状态机单独纯函数验。
 */
async function runAdmin() {
  console.log('\n— 后台 —')

  const { ADMIN_COOKIE, createSession, credentialsMatch } = await import('../src/lib/admin-auth')
  const {
    ORDER_STATUSES,
    ORDER_STATUS_EN,
    ORDER_STATUS_ZH,
    allowedTransitions,
    requiresTracking,
  } = await import('../src/lib/order-status')

  const user = process.env.ADMIN_USERNAME!
  const pass = process.env.ADMIN_PASSWORD!
  check('正确账号密码通过', credentialsMatch(user, pass))
  check('错密码被拒', !credentialsMatch(user, pass + 'x'))
  check('错账号被拒', !credentialsMatch(user + 'x', pass))
  check('空密码被拒', !credentialsMatch(user, ''))
  // 密码前缀对了也不能过——早年不少实现栽在这上面
  check('密码前缀不算数', !credentialsMatch(user, pass.slice(0, -1)))

  const session = createSession()
  const authed = { headers: { cookie: `${ADMIN_COOKIE}=${session.value}` }, redirect: 'manual' as const }

  const guarded = [
    '/admin',
    '/admin/orders',
    '/admin/products',
    '/admin/brands',
    '/admin/appearance',
    '/admin/payments',
  ]
  for (const path of guarded) {
    const anonymous = await fetch(BASE + path, { redirect: 'manual' })
    check(`${path} 未登录跳转`, anonymous.status === 307, `实际 ${anonymous.status}`)
  }

  // 签名被改一个字符就必须失效，否则会话形同虚设
  const forged = session.value.slice(0, -1) + (session.value.at(-1) === 'A' ? 'B' : 'A')
  const tampered = await fetch(BASE + '/admin', {
    headers: { cookie: `${ADMIN_COOKIE}=${forged}` },
    redirect: 'manual',
  })
  check('篡改签名的 cookie 无效', tampered.status === 307, `实际 ${tampered.status}`)

  check('登录页可访问', (await fetch(BASE + '/admin/login')).status === 200)

  for (const path of guarded) {
    check(`${path} 已登录可访问`, (await fetch(BASE + path, authed)).status === 200)
  }

  const order = await db.order.findFirst({ select: { number: true } })
  if (order) {
    const detail = await fetch(`${BASE}/admin/orders/${order.number}`, authed)
    check('订单详情可访问', detail.status === 200)
  }
  const product = await db.product.findFirst({ select: { id: true } })
  if (product) {
    const edit = await fetch(`${BASE}/admin/products/${product.id}`, authed)
    check('商品编辑页可访问', edit.status === 200)
  }

  check(
    '状态机按 待付款→已付款→待发货→运输中→完成 走',
    allowedTransitions('PENDING').join() === 'PAID,CANCELLED' &&
      allowedTransitions('PAID').join() === 'READY,CANCELLED' &&
      allowedTransitions('READY').join() === 'SHIPPED,CANCELLED' &&
      allowedTransitions('SHIPPED').join() === 'COMPLETED',
  )
  // 货交给 USPS 之后再取消会把库存加回去，可东西已经在路上了
  check('运输中不能再取消', !allowedTransitions('SHIPPED').includes('CANCELLED'))
  check('终态没有出口', !allowedTransitions('COMPLETED').length && !allowedTransitions('CANCELLED').length)
  check('不能跳步', !allowedTransitions('PENDING').includes('SHIPPED'))
  check('只有发货这步要单号', requiresTracking('SHIPPED') && !requiresTracking('PAID'))
  check(
    '每个状态都有中英文名',
    ORDER_STATUSES.every((value) => ORDER_STATUS_ZH[value] && ORDER_STATUS_EN[value]?.label),
  )
}

/**
 * 后台分页。页码来自地址栏，是外部输入，
 * 越界和乱填都得夹回有效范围，不能给一张空表也不能把 skip 算成负数。
 */
async function runPaging() {
  console.log('\n— 后台分页 —')

  const { ADMIN_COOKIE, createSession } = await import('../src/lib/admin-auth')
  const { pageFrom, PAGE_SIZE } = await import('../src/components/admin/ui')

  // 45 条 = 3 页（20 + 20 + 5），够覆盖首页、中间页、末页
  const total = PAGE_SIZE * 2 + 5
  const at = (value: string | undefined) => pageFrom(value, total)

  check('不带页码就是第一页', at(undefined).page === 1 && at(undefined).skip === 0)
  check('总页数算对', at(undefined).pages === 3, String(at(undefined).pages))
  check('第二页 skip 正确', at('2').skip === PAGE_SIZE)
  check('末页 take 不变', at('3').take === PAGE_SIZE)
  // 下面这些都是地址栏能手敲出来的
  check('超出末页夹到末页', at('99').page === 3)
  check('第 0 页夹到第一页', at('0').page === 1)
  check('负数页夹到第一页', at('-5').page === 1 && at('-5').skip === 0)
  check('乱填字母夹到第一页', at('abc').page === 1)
  check('小数取整', at('2.9').page === 2)
  check('超大数不溢出', at('1e999').page === 3)
  check('空数据也有一页', pageFrom(undefined, 0).pages === 1)
  check('空数据 skip 为 0', pageFrom(undefined, 0).skip === 0)
  // 删到最后一页空了的时候，要退到还有内容的那页而不是空页
  check('数据减少后退回末页', pageFrom('3', PAGE_SIZE + 1).page === 2)

  const authed = {
    headers: { cookie: `${ADMIN_COOKIE}=${createSession().value}` },
    redirect: 'manual' as const,
  }
  // 去重：RSC 的 flight 数据会把同一个链接再嵌一遍，直接数 match 会翻倍
  const rows = (html: string) =>
    new Set<string>(html.match(/\/admin\/products\/c[a-z0-9]+/g) ?? [])

  const get = async (path: string) => (await fetch(BASE + path, authed)).text()
  const products = await db.product.count()

  if (products > PAGE_SIZE) {
    const firstHtml = await get('/admin/products')
    const first = rows(firstHtml)
    const second = rows(await get('/admin/products?page=2'))

    check('第一页只出一页的量', first.size === PAGE_SIZE, `${first.size} 个`)
    check('第二页有内容', second.size > 0)
    // 翻页真的换了一批，而不是两页渲染同样的东西
    check('两页商品不重复', ![...second].some((href) => first.has(href)))
    check('总数显示的是全部而不是本页', firstHtml.includes(`共 ${products} 个`))
    check('第一页有下一页按钮', firstHtml.includes('下一页'))
    check('第一页不给出 page=0 的链接', !firstHtml.includes('page=0'))

    // 带筛选翻页时筛选不能丢，否则第二页会变成没筛选的全量
    check('翻页链接带着搜索词', (await get('/admin/products?q=tee')).includes('q=tee'))
    check('越界页码不报错', (await fetch(BASE + '/admin/products?page=999', authed)).status === 200)
    check('乱填页码不报错', (await fetch(BASE + '/admin/products?page=abc', authed)).status === 200)
  }

  // 只有一页时不该显示翻页控件，白占地方
  const brands = await db.brand.count()
  if (brands <= PAGE_SIZE) {
    check('品牌只有一页时不显示翻页', !(await get('/admin/brands')).includes('下一页'))
  }
}

/**
 * 放行判定。这是整套系统里唯一「判错就白送货」的地方，
 * 四条规则每条都要有一个反例守着。
 */
async function runVerification() {
  console.log('\n— 链上核验 —')

  const { judge, toUnits, tronAddressToHex } = await import('../src/lib/chain')

  // Tron 的事件日志给的是 hex 地址，库里存的是 base58，转错了就核不出账
  check(
    '收款地址转 hex 正确',
    tronAddressToHex('TMuA6YqfCeX8EhbfYEg5y7S4DqzSJireY9') ===
      '82dd6b9966724ae2fdc79b416c7588da67ff1b35',
  )
  check(
    'USDT 合约地址转 hex 正确',
    tronAddressToHex('TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t') ===
      'a614f803b6fd780986a42c78ec9c7f77e6ded13c',
  )
  check('两个地址不会撞到一起', tronAddressToHex(SAMPLE.tron) !== tronAddressToHex('TMuA6YqfCeX8EhbfYEg5y7S4DqzSJireY9'))
  check('非法字符返回空', tronAddressToHex('T0OIl') === null)
  check('长度不对返回空', tronAddressToHex('abc') === null)

  // 金额换算：用 BigInt 而不是浮点，否则 0.1+0.2 那套误差会变成对不上账
  check('整数部分换算正确', toUnits('45', 6) === 45_000_000n)
  check('小数部分换算正确', toUnits('45.5', 6) === 45_500_000n)
  check('补零不出错', toUnits('0.000001', 6) === 1n)
  check('八位精度不丢', toUnits('0.00056676', 8) === 56_676n)
  check('多余精度被截断而非四舍五入', toUnits('1.9999999', 2) === 199n)

  const placedAt = Date.now() - 10 * 60_000
  const ok = {
    toUs: true,
    contractOk: true,
    received: 45_000_000n,
    expected: 45_000_000n,
    confirmed: true,
    at: placedAt + 60_000,
    notBefore: placedAt,
  }
  check('五项全过才放行', judge(ok).state === 'paid')

  // 不查收款地址的话，从区块浏览器随便抄一个真实哈希就能白拿货
  check('转给别人的不放行', judge({ ...ok, toUs: false }).state === 'rejected')
  // 山寨币可以随便起名叫 USDT，只能认合约地址
  check('转错代币的不放行', judge({ ...ok, contractOk: false }).state === 'rejected')
  check('少付一个最小单位也不放行', judge({ ...ok, received: 44_999_999n }).state === 'rejected')
  check('多付放行', judge({ ...ok, received: 46_000_000n }).state === 'paid')
  // 0 确认可以被 RBF 替换掉，看到到账就发货等于送
  check('确认数不够只等待，不拒也不放', judge({ ...ok, confirmed: false }).state === 'pending')
  check('应收为 0 不放行', judge({ ...ok, expected: 0n }).state === 'rejected')

  // 所有客户共用一个收款地址，不比时间的话，任何一笔无人认领的历史入账
  // 都能被拿去认领新订单——后台「确认收款」不记 TXID，这种入账会一直积累
  const day = 24 * 60 * 60 * 1000
  check('下单之前的转账不放行', judge({ ...ok, at: placedAt - day }).state === 'rejected')
  check('进块了却没有时间只等待', judge({ ...ok, at: 0 }).state === 'pending')
  // 比特币区块时间戳允许落后真实时间，给两小时余量，别误杀真付款
  check('时钟误差内的转账仍放行', judge({ ...ok, at: placedAt - 60 * 60_000 }).state === 'paid')
  check('超出误差余量就拒', judge({ ...ok, at: placedAt - 3 * 60 * 60_000 }).state === 'rejected')

  // 地址不对时优先报地址，别让用户以为是金额问题
  const wrong = judge({ ...ok, toUs: false, received: 0n })
  check('拒绝时给得出原因', wrong.state === 'rejected' && wrong.message.length > 0)

  // 下面要把真实的收款配置换成测试地址，所以整段必须 try/finally 包住。
  // 中途抛一次异常就跳过还原的话，运营填的收款地址会被测试占位地址永久顶掉，
  // 而备份只存在这个进程的内存里，进程一死就找不回来了。
  const before = await db.cryptoWallet.findMany()
  const variant = await db.productVariant.findFirstOrThrow({
    where: { stock: { gte: 4 }, product: { status: 'ACTIVE' } },
    select: { id: true, stock: true },
  })

  const made: string[] = []
  const make = async () => {
    const result = await placeOrder([{ variantId: variant.id, quantity: 1 }], {
      ...ADDRESS,
      shippingMethod: 'boxed',
      paymentMethod: 'crypto',
      cryptoAsset: 'usdt-trc20',
    })
    if (result.ok) made.push(result.number)
    return result
  }

  try {
    await db.cryptoWallet.deleteMany()
    await db.cryptoWallet.create({
      data: { assetKey: 'usdt-trc20', address: SAMPLE.tron, enabled: true },
    })

    // 一笔转账认领两个订单：付一次款填三个单，人工核对时每单都显示「链上确有此交易」
    const first = await make()
    const second = await make()
    if (first.ok && second.ok) {
      const hash = 'b'.repeat(64)
      const one = await submitTxid(first.number, hash)
      const two = await submitTxid(second.number, hash)
      check('同一 TXID 第一单收下', one.state === 'pending')
      check('同一 TXID 第二单被拒', two.state === 'rejected', two.state)

      const dup = await db.order.count({ where: { cryptoTxid: hash } })
      check('库里只有一单挂着这个 TXID', dup === 1, String(dup))
    }

    // 收款地址必须在下单时快照。核验时现取的话，后台一换地址，所有在途付款
    // 都会被判「没转到我们地址」——而且是 rejected 不是 pending，重核多少次都翻不了案。
    const snap = await make()
    if (snap.ok) {
      const saved = await db.order.findUniqueOrThrow({
        where: { number: snap.number },
        select: { cryptoAddress: true },
      })
      check('下单时快照了收款地址', saved.cryptoAddress === SAMPLE.tron, String(saved.cryptoAddress))

      // 展示和核验必须指向同一个地址：页面给新的、后台按旧快照核，
      // 客户照着页面付了反倒不通过
      const rotated = 'TJRabPrwbZy45sbavfcjinPJC18kjpRTv8'
      await db.cryptoWallet.update({
        where: { assetKey: 'usdt-trc20' },
        data: { address: rotated },
      })
      const page = await fetch(`${BASE}/order/${snap.number}`).then((r) => r.text())
      check('换地址后付款页仍给下单时那个', page.includes(SAMPLE.tron) && !page.includes(rotated))

      await db.cryptoWallet.update({
        where: { assetKey: 'usdt-trc20' },
        data: { address: SAMPLE.tron },
      })
    }

    // 已取消的订单收到钱：哈希必须落库。过去这里直接回「已付款」就返回了，
    // 客户看到的页面写着 Nothing was charged，而钱已经进了钱包，库里零记录。
    const dead = await make()
    if (dead.ok) {
      await db.order.update({ where: { number: dead.number }, data: { status: 'CANCELLED' } })
      const hash = 'c'.repeat(64)
      const said = await submitTxid(dead.number, hash)
      const row = await db.order.findUniqueOrThrow({
        where: { number: dead.number },
        select: { cryptoTxid: true },
      })
      check('已取消订单的转账哈希落了库', row.cryptoTxid === hash, String(row.cryptoTxid))
      check('不谎报已付款', said.state === 'rejected', said.state)
      check(
        '提示里带单号，客户拿得出凭据',
        said.state === 'rejected' && said.message.includes(dead.number),
      )
    }
  } finally {
    await db.order.deleteMany({ where: { number: { in: made } } })
    await db.productVariant.update({ where: { id: variant.id }, data: { stock: variant.stock } })
    await db.cryptoWallet.deleteMany()
    if (before.length) {
      await db.cryptoWallet.createMany({
        data: before.map(({ assetKey, address, enabled }) => ({ assetKey, address, enabled })),
      })
    }
  }
}

/**
 * 发货与查件。单号校验是纯函数，直接调；
 * 页面渲染那半用 HTTP 走一遍——客户看不到单号等于没发货。
 */
async function runFulfilment() {
  console.log('\n— 发货与查件 —')

  const { normalizeTracking, trackingUrl } = await import('../src/lib/order-status')

  check('不填单号被拒', !normalizeTracking('').ok)
  check('纯空白被拒', !normalizeTracking('   ').ok)
  check('带符号被拒', !normalizeTracking('ABC-123/456').ok)
  check('太短被拒', !normalizeTracking('123').ok)
  check('太长被拒', !normalizeTracking('9'.repeat(41)).ok)
  // 运营多半是从 USPS 页面整段复制的，中间带空格
  const pasted = normalizeTracking('9400 1000 0000 0000 0000 00')
  check('复制来的空格被抹掉', pasted.ok && pasted.value === '9400100000000000000000')
  check('查件地址指向 USPS', trackingUrl('94001').includes('tools.usps.com'))

  const variant = await db.productVariant.findFirstOrThrow({
    where: { stock: { gte: 1 }, product: { status: 'ACTIVE' } },
    select: { id: true, stock: true },
  })

  const placed = await placeOrder([{ variantId: variant.id, quantity: 1 }], {
    ...ADDRESS,
    shippingMethod: 'boxed',
    paymentMethod: 'whatsapp',
  })
  if (!placed.ok) {
    console.log(`[skip] 跳过：${placed.message}`)
    return
  }

  const row = await db.order.findUniqueOrThrow({ where: { number: placed.number } })
  check('新单是待付款', row.status === 'PENDING')

  const page = () => fetch(`${BASE}/order/${row.number}`).then((r) => r.text())
  const pending = await page()
  check('待付款时显示进度条', pending.includes('Awaiting payment'))

  // 没付款时主线是「怎么付」，单号让位排在付款说明后面，
  // 否则手机上二维码/WhatsApp 按钮会被挤到折线以下
  check(
    '待付款时付款说明排在单号前',
    pending.indexOf('Local payment') < pending.indexOf('Your order number'),
    `付款@${pending.indexOf('Local payment')} 单号@${pending.indexOf('Your order number')}`,
  )

  // 后台关掉某个币之后，在途的该币种待付款单会取不到收款地址。
  // 页头写着「Send payment below」，下面必须真有个能付款的出口，不能开天窗。
  await db.order.update({
    where: { id: row.id },
    data: { paymentMethod: 'crypto', cryptoAsset: 'not-a-real-coin', cryptoAmount: null },
  })
  const orphan = await page()
  check('币种下架后仍给得出付款方式', orphan.includes('Open WhatsApp'))
  await db.order.update({
    where: { id: row.id },
    data: { paymentMethod: 'whatsapp', cryptoAsset: null },
  })

  // setOrderStatus 要 cookies() 上下文，脚本里调不了，这里直接落库验渲染
  await db.order.update({
    where: { id: row.id },
    data: { status: 'SHIPPED', trackingNumber: '9400100000000000000000' },
  })

  const html = await page()
  check('客户订单页出单号', html.includes('9400100000000000000000'))
  check('客户订单页有 USPS 查件链接', html.includes('tools.usps.com'))
  check('进度走到了运输中', html.includes('In transit'))

  // 付过款之后主线换成「记住单号」，位置提到最上面
  check(
    '付款后单号提到查件信息之前',
    html.indexOf('Your order number') < html.indexOf('USPS tracking'),
    `单号@${html.indexOf('Your order number')} 查件@${html.indexOf('USPS tracking')}`,
  )
  check('五步都画出来了', html.includes('Packing') && html.includes('Delivered'))

  // 查单入口：访客不注册账号，这是他们回到订单的唯一路径
  const lookup = await fetch(`${BASE}/orders`)
  check('查单页可访问', lookup.status === 200)
  const home = await fetch(BASE).then((r) => r.text())
  check('页面上有查单入口', home.includes('/orders'))

  const found = await findOrder({ number: row.number, email: ADDRESS.email })
  check('凭单号和邮箱查得到', found.ok)

  await db.order.delete({ where: { id: row.id } })
  await db.productVariant.update({ where: { id: variant.id }, data: { stock: variant.stock } })
  const restored = await db.productVariant.findUniqueOrThrow({ where: { id: variant.id } })
  check('测试数据已还原', restored.stock === variant.stock)
}

/**
 * 后台建的商品要立刻能卖。没有 variant 的商品在详情页会渲染出一个
 * 点了没反应的加购按钮——不测就发现不了，所以这段专门盯规格同步。
 */
async function runVariants() {
  console.log('\n— 规格同步 —')

  const { syncVariants, skuFor } = await import('../src/lib/variants')

  const [brand, category] = await Promise.all([
    db.brand.findFirstOrThrow({ select: { id: true } }),
    db.category.findFirstOrThrow({ where: { parentId: { not: null } }, select: { id: true } }),
  ])

  const slug = 'smoke-variant-probe'
  const product = await db.product.create({
    data: {
      slug,
      title: 'Smoke Variant Probe',
      description: 'temp',
      priceCents: 1000,
      status: 'DRAFT',
      brandId: brand.id,
      categoryId: category.id,
    },
    select: { id: true },
  })

  const load = () =>
    db.productVariant.findMany({ where: { productId: product.id }, orderBy: { sku: 'asc' } })

  // 什么都不填也必须有一个可下单的 SKU
  await syncVariants(product.id, slug, '', '')
  let variants = await load()
  check('无规格时兜底建一个 SKU', variants.length === 1 && variants[0].size === null)

  await syncVariants(product.id, slug, 'Black:#141414, Sand', 'S,M,L')
  variants = await load()
  check('颜色 × 尺码取笛卡尔积', variants.length === 6, `${variants.length} 个`)
  check(
    '色值被记下来',
    variants.find((v) => v.color === 'Black')?.colorHex === '#141414' &&
      variants.find((v) => v.color === 'Sand')?.colorHex === null,
  )
  check('兜底 SKU 已被顶掉', !variants.some((v) => v.color === null))

  // 库存是运营改出来的，再存一次商品不能把它冲掉
  const keep = variants.find((v) => v.sku === skuFor(slug, 'Black', 'M'))!
  await db.productVariant.update({ where: { id: keep.id }, data: { stock: 7 } })
  await syncVariants(product.id, slug, 'Black:#141414, Sand', 'S,M,L,XL')
  variants = await load()
  check('加尺码不动已有库存', variants.find((v) => v.id === keep.id)?.stock === 7)
  check('新尺码已补上', variants.length === 8, `${variants.length} 个`)

  await syncVariants(product.id, slug, 'Black:#141414', 'S,M')
  variants = await load()
  check('删掉的规格被清走', variants.length === 2 && variants.every((v) => v.color === 'Black'))

  // 下过单的规格不能删，删了历史订单的 variantId 就断了
  const sold = variants[0]
  const order = await db.order.create({
    data: {
      number: 'NS-SMOKE-VAR',
      email: 'demo@example.com',
      subtotalCents: 1000,
      shippingCents: 0,
      taxCents: 0,
      totalCents: 1000,
      name: 'x',
      line1: 'x',
      city: 'x',
      state: 'x',
      postalCode: 'x',
      country: 'x',
      items: {
        create: {
          variantId: sold.id,
          productSlug: slug,
          productTitle: 'x',
          brandName: 'x',
          variantLabel: 'x',
          imageUrl: '',
          unitPriceCents: 1000,
          quantity: 1,
        },
      },
    },
    select: { id: true },
  })

  await syncVariants(product.id, slug, 'Sand', 'S')
  variants = await load()
  check('下过单的规格保留', variants.some((v) => v.id === sold.id), `剩 ${variants.length} 个`)

  await db.order.delete({ where: { id: order.id } })
  await db.product.delete({ where: { id: product.id } })
  check('测试商品已清理', (await db.product.count({ where: { slug } })) === 0)
}

/**
 * 首页入口图和品牌封面：后台设了用后台的，没设自动回退到商品图。
 * 回退这条路径尤其要守住——挂了就是首页开天窗，而且是静默的。
 */
async function runShowcase() {
  console.log('\n— 首页装修 —')

  const { getGenderEntries, getGenderBrands } = await import('../src/lib/queries')
  const { SHOWCASE_FALLBACK } = await import('../src/lib/showcase')

  /* home 和 men 这两行后台可能真配过（首页大标题、性别入口图）。下面要借用它们验回退，
     借完必须原样放回去。这里原先收尾写的是 deleteMany，等于每跑一次 npm run check
     就把管理员配的内容吃掉一次——而且吃完「回退到商品图」照样通过，一声不吭。 */
  const BORROWED = ['home', 'men']
  const columns = {
    key: true,
    imageUrl: true,
    imageBlur: true,
    headline: true,
    subhead: true,
  } as const
  const byKey = (rows: { key: string }[]) => [...rows].sort((a, b) => a.key.localeCompare(b.key))
  const saved = byKey(await db.showcase.findMany({ where: { key: { in: BORROWED } }, select: columns }))

  // 先清干净，验没配置时的样子
  await db.showcase.deleteMany({ where: { key: { in: BORROWED } } })
  const before = await getGenderEntries()
  const men = before.find((entry) => entry.slug === 'men')
  check('未配置时入口图回退到商品图', !!men?.image?.url, men?.image?.url ?? '无图')
  check('未配置时标题用内置文案', men?.label === 'Men', men?.label)

  const html = await fetch(BASE + '/').then((response) => response.text())
  check('首页显示内置主标题', html.includes(SHOWCASE_FALLBACK.home.headline))

  // 兜底封面必须同性别优先。包和表是 UNISEX、男女范围里都算，随便取第一张
  // 就会在女装的分类块上挂出男模照片——这是纯视觉的坑，不看页面发现不了。
  const { getBrandCategories } = await import('../src/lib/queries')
  const { GENDERS } = await import('../src/lib/taxonomy')
  const wrong: string[] = []
  const brandRows = await db.brand.findMany({ select: { id: true, slug: true } })

  for (const gender of GENDER_SLUGS) {
    const own = GENDERS[gender].value
    for (const row of brandRows) {
      for (const category of await getBrandCategories(row.id, gender)) {
        if (!category.image) continue
        // 这个类别下有没有本性别专属又带图的货？有的话封面就不该来自 UNISEX
        const ownCount = await db.product.count({
          where: {
            status: 'ACTIVE',
            brandId: row.id,
            gender: own,
            category: { parent: { slug: category.slug } },
            images: { some: {} },
          },
        })
        if (ownCount === 0) continue
        const source = await db.product.findFirst({
          where: { images: { some: { url: category.image.url } } },
          select: { gender: true },
        })
        if (source?.gender !== own) wrong.push(`${gender}/${row.slug}/${category.slug}`)
      }
    }
  }
  check('分类封面同性别优先', wrong.length === 0, wrong.slice(0, 4).join(' ') || '全部命中本性别')

  // 再配上，验覆盖
  await db.showcase.create({
    data: {
      key: 'men',
      headline: 'Gentlemen',
      imageUrl: '/uploads/smoke-cover-1200.webp',
      imageBlur: 'data:image/webp;base64,SMOKE',
    },
  })
  await db.showcase.create({ data: { key: 'home', headline: 'Smoke headline', subhead: 'Sub' } })

  const after = await getGenderEntries()
  const custom = after.find((entry) => entry.slug === 'men')
  check('配置后入口图用自定义图', custom?.image?.url === '/uploads/smoke-cover-1200.webp')
  check('配置后标题用自定义文案', custom?.label === 'Gentlemen')
  check(
    '女士入口不受影响',
    after.find((entry) => entry.slug === 'women')?.label === 'Women',
  )

  const custHtml = await fetch(BASE + '/').then((response) => response.text())
  check('首页主标题已换成后台的', custHtml.includes('Smoke headline'))

  // 品牌封面同一套规则
  const brand = await db.brand.findFirstOrThrow({
    // imageBlur 也要一起存，否则「还原」会把后台传图时生成的模糊占位抹成 null
    select: { id: true, slug: true, imageUrl: true, imageBlur: true },
  })
  await db.brand.update({ where: { id: brand.id }, data: { imageUrl: null, imageBlur: null } })
  const auto = (await getGenderBrands('men')).find((item) => item.slug === brand.slug)
  check('品牌未设封面时回退到商品图', !auto || !!auto.image?.url, auto?.image?.url ?? '该品牌男装无货')

  await db.brand.update({
    where: { id: brand.id },
    data: { imageUrl: '/uploads/smoke-brand-1200.webp', imageBlur: 'data:image/webp;base64,SMOKE' },
  })
  const picked = (await getGenderBrands('men')).find((item) => item.slug === brand.slug)
  check('品牌设了封面就用封面', !picked || picked.image?.url === '/uploads/smoke-brand-1200.webp')

  // 收尾还原
  await db.brand.update({
    where: { id: brand.id },
    data: { imageUrl: brand.imageUrl, imageBlur: brand.imageBlur },
  })
  await db.showcase.deleteMany({ where: { key: { in: BORROWED } } })
  for (const row of saved) await db.showcase.create({ data: row })

  /* 逐字段比对，不能只看「标题变回 Men」——后台没配过时那句话本来就成立，
     等于把数据删光也能通过，正是这条检查以前放过去的那个 bug */
  const back = byKey(await db.showcase.findMany({ where: { key: { in: BORROWED } }, select: columns }))
  check(
    '借用的展示位已原样放回',
    JSON.stringify(back) === JSON.stringify(saved),
    saved.length ? `${saved.map((row) => row.key).join('/')} 已复原` : '本来就没配置',
  )
}

/**
 * 首页那几条横向商品栏。首页原本只有两个性别入口，手机上一屏就到底，
 * 这几条是撑住信息密度的东西，空了或者错位都是静默的。
 */
async function runHomeRails() {
  console.log('\n— 首页商品栏 —')

  const { getHomeRails } = await import('../src/lib/queries')
  const { picks, sale } = await getHomeRails()

  check('精选栏有货', picks.length > 0, `${picks.length} 件`)
  check('精选栏不超过一屏的量', picks.length <= 12, `${picks.length} 件`)
  check('精选栏没有重复商品', new Set(picks.map((p) => p.id)).size === picks.length)

  // 后台标的精选要排在补位的新品前面，否则人工挑选就白做了
  const marked = await db.product.count({ where: { status: 'ACTIVE', featured: true } })
  const leading = picks.slice(0, marked).map((p) => p.id)
  const featuredIds = new Set(
    (await db.product.findMany({ where: { status: 'ACTIVE', featured: true }, select: { id: true } })).map(
      (p) => p.id,
    ),
  )
  check('精选打头、新品补位', leading.every((id) => featuredIds.has(id)), `前 ${marked} 件`)

  // compareAtCents 非空不等于在打折，标价可能被改到比原价还高
  check(
    '折扣栏只收真正降价的',
    sale.every((p) => p.compareAtCents !== null && p.compareAtCents > p.priceCents),
    `${sale.length} 件`,
  )

  const home = await (await fetch(BASE + '/')).text()
  check('首页渲染出商品栏', home.includes('>Featured<'), 'Featured')
  check('首页渲染出品牌栏', home.includes('>Brands<'), 'Brands')

  // 吸附对齐的是 padding box：给了 px-5 却漏掉 scroll-pl-5，首张卡会被吸到
  // 屏幕最左边，跟上面的标题差 20px。差得不多，肉眼很容易放过去。
  const rail = home.match(/class="[^"]*snap-mandatory[^"]*overflow-x-auto[^"]*"/)?.[0] ?? ''
  check('横向栏留了吸附内边距', rail.includes('px-5') && rail.includes('scroll-pl-5'), rail.slice(0, 90))

  // 桌面端卡片宽度必须能整除容器：写死宽度（比如 w-64）时最后一张会被右边缘
  // 切成半张，鼠标又没有横滑手势、滚动条还是藏的，看着就是渲染坏了。
  // 每屏张数同时也是「翻一页 = 容器宽度」成立的前提，箭头才落得回整张卡上。
  const item = home.match(/class="w-\[42vw\][^"]*"/)?.[0] ?? ''
  for (const [breakpoint, perView] of [
    ['md', 3],
    ['lg', 4],
    ['xl', 5],
  ] as const) {
    check(
      `${breakpoint} 每屏 ${perView} 张且整除`,
      item.includes(`${breakpoint}:w-[calc((100%_-_${perView - 1}_*_1.5rem)/${perView})]`),
      item.slice(0, 120),
    )
  }
  check('手机端仍留出下一张的一角', item.includes('w-[42vw]'))

  // 超过一屏的栏要给得出翻页的出口
  check('桌面端有翻页箭头', home.includes('aria-label="Next featured"'))
  check('翻页箭头不占手机端的位置', /class="hidden gap-1\.5 self-center md:flex"/.test(home))

  // /[性别]/[品牌] 在该性别无货时是 404。首页的品牌栏和顶部导航都在拼这种链接，
  // 一个字段拼错、或者忘了按性别过滤，就会在首页留下一片死链。
  const links = [...new Set([...home.matchAll(/href="(\/(?:women|men)\/[a-z0-9-]+)"/g)].map((m) => m[1]))]
  check('首页有品牌链接可查', links.length > 0, `${links.length} 条`)
  const dead: string[] = []
  for (const href of links) {
    if ((await fetch(BASE + href)).status !== 200) dead.push(href)
  }
  check('首页品牌链接没有死链', dead.length === 0, dead.join(' ') || `${links.length} 条全通`)

  // 上面那条只能覆盖当前有的品牌。真正的坑是新建一个还没上货的品牌，
  // 导航照列不误，点进去 404——所以直接造一个出来验。
  const { getBrands } = await import('../src/lib/queries')
  const empty = await db.brand.create({
    data: { slug: 'smoke-empty-brand', name: 'Smoke Empty', description: '', position: 999 },
  })
  const listed = await getBrands()
  check(
    '没上货的品牌不进导航',
    !listed.some((brand) => brand.slug === empty.slug),
    listed.map((brand) => brand.slug).join(','),
  )
  check(
    '导航里的品牌都标了有货的性别',
    listed.every((brand) => brand.genders.length > 0),
  )
  await db.brand.delete({ where: { id: empty.id } })
}

/**
 * 本地记住的订单号。访客没有账号，这串号是他们回到订单的唯一凭据，
 * 记错了就只能来问客服，所以过期、去重、上限这几条都得钉住。
 */
async function runOrderMemory() {
  console.log('\n— 本地订单号 —')

  // 这个模块在浏览器里跑，Node 下没有 localStorage，拿 Map 顶一个
  const store = new Map<string, string>()
  Object.defineProperty(globalThis, 'localStorage', {
    configurable: true,
    value: {
      getItem: (key: string) => store.get(key) ?? null,
      setItem: (key: string, value: string) => void store.set(key, String(value)),
      removeItem: (key: string) => void store.delete(key),
    },
  })

  const KEY = 'northsound.orders.v1'
  const DAY = 24 * 60 * 60 * 1000
  const { rememberOrder, readRecentOrders, forgetOrders, ORDER_MEMORY_DAYS } = await import(
    '../src/lib/recent-orders'
  )

  rememberOrder('NS-AAAA000001')
  check('记下的单号读得回来', readRecentOrders()[0]?.number === 'NS-AAAA000001')

  rememberOrder('NS-BBBB000002')
  rememberOrder('NS-AAAA000001')
  const reordered = readRecentOrders()
  check('重复记录不会留两条', reordered.length === 2, `${reordered.length} 条`)
  check('刚打开的排在最前', reordered[0].number === 'NS-AAAA000001', reordered[0].number)

  // 到期这条最要紧：写死一个 16 天前的时间戳，读的时候必须被滤掉
  store.set(
    KEY,
    JSON.stringify([
      { number: 'NS-OLD000000', savedAt: Date.now() - (ORDER_MEMORY_DAYS + 1) * DAY },
      { number: 'NS-NEW000000', savedAt: Date.now() - 1 * DAY },
    ]),
  )
  const pruned = readRecentOrders()
  check('过了 15 天的不再出现', !pruned.some((item) => item.number === 'NS-OLD000000'))
  check('没到期的还在', pruned.some((item) => item.number === 'NS-NEW000000'))
  check('过期的同时被落盘清掉', !(store.get(KEY) ?? '').includes('NS-OLD000000'))

  // 边界：差一点点到期的不能被误杀
  store.set(KEY, JSON.stringify([{ number: 'NS-EDGE00000', savedAt: Date.now() - 14.9 * DAY }]))
  check('差一天到期的仍然保留', readRecentOrders().length === 1)

  forgetOrders()
  for (let i = 0; i < 14; i++) rememberOrder(`NS-BULK0000${i}`)
  check('最多只留 10 条', readRecentOrders().length === 10, `${readRecentOrders().length} 条`)

  store.set(KEY, '{ not json at all')
  check('脏数据不会把页面搞挂', readRecentOrders().length === 0)

  rememberOrder('NS-CCCC000003')
  forgetOrders()
  check('清空之后就没有了', readRecentOrders().length === 0)
}

/**
 * 手机底部导航。五个入口都是硬编码的路径，改动路由时最容易漏掉这里，
 * 而它在每一页都露着——留一条死链等于每页都有一条。
 */
async function runBottomNav() {
  console.log('\n— 手机底部导航 —')

  const home = await (await fetch(BASE + '/')).text()
  const start = home.indexOf('aria-label="Quick navigation"')
  check('底部导航渲染出来了', start > -1)
  if (start < 0) return

  const bar = home.slice(start, home.indexOf('</nav>', start))
  const hrefs = [...bar.matchAll(/href="([^"]+)"/g)].map((match) => match[1])
  check('底部导航是五个入口', hrefs.length === 5, hrefs.join(' '))

  const dead: string[] = []
  for (const href of hrefs) {
    if ((await fetch(BASE + href)).status !== 200) dead.push(href)
  }
  check('底部导航没有死链', dead.length === 0, dead.join(' ') || hrefs.join(' '))

  // 底部栏是 md:hidden，页头那几个入口是 md:flex，两边正好互补。
  // 只改一边就会有某个宽度下购物车出现两次、或者一次都不出现。
  check('底部栏只在手机端出现', bar.includes('md:hidden'))
  const headerCart = (home.match(/<a[^>]*href="\/cart"[^>]*>/g) ?? []).filter(
    (tag) => !bar.includes(tag),
  )
  check(
    '购物车入口不会同屏出现两次',
    headerCart.every((tag) => tag.includes('hidden') && tag.includes('md:flex')),
    headerCart.join(' ') || '页头没有购物车',
  )
}

/**
 * 裸 fr 轨道等于 minmax(auto,1fr)，auto 下限让轨道无法收缩到内容最小宽度以下，
 * 于是一栏撑爆、另一栏被挤成竖缝。Tailwind 内置的 grid-cols-N 都自带
 * minmax(0,1fr)，但任意值不会自动加——详情页就栽在这上面，加条检查别再犯。
 */
async function runLayoutLint() {
  console.log('\n— 布局 —')

  const { readdirSync, readFileSync } = await import('node:fs')
  const { join } = await import('node:path')

  const files: string[] = []
  const walk = (dir: string) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (entry.name === 'generated') continue
      const full = join(dir, entry.name)
      if (entry.isDirectory()) walk(full)
      else if (/\.tsx?$/.test(entry.name)) files.push(full)
    }
  }
  walk('src')

  const offenders: string[] = []
  for (const file of files) {
    for (const [whole, tracks] of readFileSync(file, 'utf8').matchAll(/grid-cols-\[([^\]]*)\]/g)) {
      // 轨道之间用下划线分隔；带 minmax( 的都已经显式给了下限
      const bare = tracks.split('_').filter((t) => t.includes('fr') && !t.includes('minmax('))
      if (bare.length) offenders.push(`${file} ${whole}`)
    }
  }

  check('没有裸 fr 网格轨道', offenders.length === 0, offenders.join(' / '))

  // 女装排在男装前面是刻意定的，全站顺序都跟着 GENDER_SLUGS 走
  check('性别顺序是女前男后', GENDER_SLUGS[0] === 'women', GENDER_SLUGS.join(' '))
  const home = await (await fetch(BASE + '/')).text()
  const womenAt = home.indexOf('href="/women"')
  const menAt = home.indexOf('href="/men"')
  check('首页女士入口排在前', womenAt > -1 && womenAt < menAt, `women@${womenAt} men@${menAt}`)
  // 手机上两格并排才塞得进首屏，竖着排第二个性别永远要下拉
  check('首页入口手机端并排两格', home.includes('grid grid-cols-2'))

  // 商品列表页在手机上是「图左文右」的一行，md 起换回网格。
  // 两套排版共用一个卡片组件，靠 list 开关切，最容易出的错是开关串了台。
  const listing = await (await fetch(BASE + '/search?q=the')).text()
  check('列表页手机端竖排一行一个', listing.includes('flex flex-col divide-y'))
  check('列表页 md 起变三列网格', listing.includes('md:grid-cols-3'))
  check('列表卡片是图左文右', listing.includes('group flex gap-4'))
  check('列表卡片 md 起恢复竖版', listing.includes('md:block'))
  // 图只有 128px 宽，报 50vw 会让 3 倍屏白下载大一档的图
  check('列表图按实际宽度取图', listing.includes('128px'))

  // 详情页底部的「相关商品」是两列小图，套上图左文右会挤成一团。
  // slug 从库里取，别写死——写死的那次就查了个 404 页面，白过。
  const sample = await db.product.findFirstOrThrow({
    where: { status: 'ACTIVE' },
    select: { slug: true },
  })
  const response = await fetch(`${BASE}/p/${sample.slug}`)
  check('详情页能打开', response.status === 200, `实际 ${response.status}`)

  const detail = await response.text()
  check('相关商品仍是两列网格', detail.includes('grid grid-cols-2'))
  check('相关商品没被改成图左文右', !detail.includes('group flex gap-4'))

  // 主图区是一个画框左右翻，不是竖着堆。堆起来的写法是 md:block 关掉横向滚动，
  // 一旦有人改回去，这里的 snap 容器和箭头就都没了。
  check('主图是横向轮播', detail.includes('snap-x snap-mandatory'))
  check('主图没退回竖排堆叠', !/overflow-x-auto[^"]*md:block/.test(detail))
  check('桌面端有左右切换箭头', detail.includes('Previous image') && detail.includes('Next image'))
}

/** 私域投放：不给搜索引擎收录，但分享卡片得照常出图 */
async function runPrivate() {
  console.log('\n— 私域 —')

  const robots = await fetch(BASE + '/robots.txt')
  const robotsText = await robots.text()
  check('robots.txt 全站 Disallow', robotsText.includes('Disallow: /'))

  const home = await fetch(BASE + '/')
  check('响应头带 X-Robots-Tag', home.headers.get('x-robots-tag')?.includes('noindex') === true)

  const html = await home.text()
  check('HTML 里有 noindex', html.includes('noindex'))

  for (const agent of ['Googlebot/2.1', 'Mozilla/5.0 (compatible; Baiduspider/2.0)', 'GPTBot/1.0']) {
    const response = await fetch(BASE + '/', { headers: { 'user-agent': agent } })
    check(`${agent.split('/')[0]} 被 404`, response.status === 404, `实际 ${response.status}`)
  }

  // 微信不带常规 UA 特征也可能进来，绝不能误伤真人
  const wechat = await fetch(BASE + '/', {
    headers: { 'user-agent': 'Mozilla/5.0 (iPhone) MicroMessenger/8.0.49' },
  })
  check('微信内置浏览器放行', wechat.status === 200, `实际 ${wechat.status}`)

  // WhatsApp 抓不到 OG 就没有预览图，私域分享全靠这个
  const product = await db.product.findFirstOrThrow({
    where: { status: 'ACTIVE', images: { some: {} } },
    select: { slug: true },
  })
  const share = await fetch(`${BASE}/p/${product.slug}`, {
    headers: { 'user-agent': 'WhatsApp/2.23' },
  })
  const shareHtml = await share.text()
  check('分享抓取器未被拦', share.status === 200)
  check('商品页有 og:image', shareHtml.includes('og:image'))
  check(
    'og:image 是绝对地址',
    /property="og:image"[^>]*content="https?:\/\//.test(shareHtml) ||
      /content="https?:\/\/[^"]*"[^>]*property="og:image"/.test(shareHtml),
  )
}

/**
 * 图搜。这里盯的是 image-search.ts 里那几个阈值还站不站得住：
 * 同一件货被折腾过还得认出来，不同的货不能误判成同款，垃圾图要老实说没有。
 * 阈值调过之后这一段最先炸。
 */
async function runImageSearch() {
  const { existsSync } = await import('node:fs')
  const { readFile } = await import('node:fs/promises')
  const nodePath = await import('node:path')
  const sharp = (await import('sharp')).default

  const { MODEL_DIR } = await import('../src/lib/vision-model')
  if (!existsSync(MODEL_DIR)) {
    check('图搜模型已下载', false, '缺 models/，先跑 npm run fetch:model')
    return
  }

  const { searchByImage } = await import('../src/lib/image-search')
  const { embedImage, similarity, toBytes, fromBytes, MAX_IMAGE_BYTES } = await import(
    '../src/lib/vision'
  )
  const { lookupByImage } = await import('../src/lib/actions')

  // 向量存进 SQLite 再取出来不能变样，否则整个排序都是错的
  const sample = await embedImage(
    await sharp({ create: { width: 64, height: 64, channels: 3, background: '#8a5a2b' } })
      .png()
      .toBuffer(),
  )
  const round = fromBytes(toBytes(sample))
  check('向量存取往返不失真', !!round && similarity(sample, round) > 0.9999)
  check('长度不对的向量被丢弃', fromBytes(new Uint8Array(16)) === null)

  const picks = await db.product.findMany({
    where: { status: 'ACTIVE', images: { some: { position: 0, NOT: { embedding: null } } } },
    select: { slug: true, images: { where: { position: 0 }, take: 1, select: { url: true } } },
    orderBy: { slug: 'asc' },
    take: 2,
  })
  if (picks.length < 2) {
    check('有建好索引的商品可测', false, '先跑 npm run embed')
    return
  }

  const fileFor = (url: string) =>
    readFile(nodePath.join(process.cwd(), 'public', url.replace('-1200.webp', '-400.webp')))
  const [target, other] = picks
  const source = await fileFor(target.images[0].url)

  // 客户手上的图是转发过的：压过、缩过、裁过边
  const forwarded = await sharp(source)
    .resize(360)
    .extract({ left: 20, top: 30, width: 320, height: 410 })
    .jpeg({ quality: 50 })
    .toBuffer()
  const hit = await searchByImage(forwarded)
  check(
    '转发过的图仍直达原商品',
    hit.kind === 'direct' && hit.slug === target.slug,
    hit.kind === 'direct' ? `${hit.slug} ${hit.score.toFixed(3)}` : hit.kind,
  )

  // 同一张图再走一遍公开入口。下面测的全是「该拒的拒掉」，
  // 少了这条，把 sniff 写成一律拒绝也照样全绿
  const real = new FormData()
  real.set('image', new File([new Uint8Array(forwarded)], 'photo.jpg', { type: 'image/jpeg' }))
  const viaAction = await lookupByImage(real)
  check(
    '正常上传走得通公开入口',
    viaAction.kind === 'direct' && viaAction.slug === target.slug,
    viaAction.kind,
  )

  // 加白边的截屏也是常见形态
  const shot = await sharp(source)
    .resize(300)
    .extend({ top: 50, bottom: 50, left: 16, right: 16, background: '#fff' })
    .jpeg({ quality: 60 })
    .toBuffer()
  const shotHit = await searchByImage(shot)
  check(
    '带白边的截屏也能认出',
    shotHit.kind === 'direct' && shotHit.slug === target.slug,
    shotHit.kind === 'direct' ? shotHit.score.toFixed(3) : shotHit.kind,
  )

  // 另一件商品绝不能被认成第一件，这是"直达"敢自动跳转的前提
  const decoy = await searchByImage(await fileFor(other.images[0].url))
  check(
    '别的商品不会被认成同款',
    !(decoy.kind === 'direct' && decoy.slug === target.slug),
    decoy.kind === 'direct' ? decoy.slug : decoy.kind,
  )

  // 无关图要老实说没有，不能硬凑一个最接近的出来
  const noise = await sharp({
    create: {
      width: 320,
      height: 320,
      channels: 3,
      background: '#000',
      noise: { type: 'gaussian', mean: 128, sigma: 70 },
    },
  })
    .png()
    .toBuffer()
  const junk = await searchByImage(noise)
  check(
    '无关图不硬凑结果',
    junk.kind === 'none' || (junk.kind === 'matches' && junk.loose),
    junk.kind,
  )

  // 公开上传口的信任边界
  const big = new FormData()
  big.set('image', new File([new Uint8Array(MAX_IMAGE_BYTES + 1)], 'big.jpg', { type: 'image/jpeg' }))
  const tooBig = await lookupByImage(big)
  check('超大图被拒', tooBig.kind === 'error')

  const fake = new FormData()
  fake.set('image', new File([new TextEncoder().encode('not an image')], 'x.txt', { type: 'text/plain' }))
  check('非图片被拒', (await lookupByImage(fake)).kind === 'error')

  const bogus = new FormData()
  bogus.set('image', new File([new TextEncoder().encode('%PDF-1.4 fake')], 'x.jpg', { type: 'image/jpeg' }))
  check('伪装成图片的文件不会炸', (await lookupByImage(bogus)).kind === 'error')

  const empty = new FormData()
  check('没选文件时给提示', (await lookupByImage(empty)).kind === 'error')

  // 入口得真的在页面上，否则功能等于没有
  const page = await fetch(BASE + '/search').then((r) => r.text())
  check('搜索页有传图入口', page.includes('Drop a photo'))
  const home = await fetch(BASE + '/').then((r) => r.text())
  check('头部有识图入口', home.includes('Search by photo'))
}

async function runHardening() {
  console.log('\n— 防攻击 —')
  const sharp = (await import('sharp')).default
  const { hit, LIMITS, resetLimits } = await import('../src/lib/rate-limit')
  const { sniffImage, MAX_PIXELS } = await import('../src/lib/images')

  // — 限流计数 —
  resetLimits()
  const limit = { hits: 3, windowMs: 1000 }
  const spend = (key: string, times: number, now?: number) =>
    Array.from({ length: times }, () => hit(key, limit, now))

  check('额度内放行', spend('a', 3).every(Boolean))
  check('超额即拒', hit('a', limit) === false)
  check('超额之后继续拒', hit('a', limit) === false)
  check('换个来源互不影响', hit('b', limit) === true)

  // 窗口翻篇要恢复，否则一个人被限一次就永远进不来
  const start = Date.now()
  spend('c', 3, start)
  check('窗口内仍然拒', hit('c', limit, start + 999) === false)
  check('窗口过后放行', hit('c', limit, start + 1001) === true)

  check('登录额度最紧', LIMITS.login.hits <= 10 && LIMITS.login.windowMs >= 5 * 60_000)
  // 前台每 20 秒轮一次，额度低于 3 次/分钟的话真买家自己就会被卡住
  check('轮询额度容得下真买家', LIMITS.recheck.hits / (LIMITS.recheck.windowMs / 60_000) >= 3)
  resetLimits()

  // — 上传信任边界 —
  const png = await sharp({ create: { width: 40, height: 40, channels: 3, background: '#777' } })
    .png()
    .toBuffer()
  check('正常图片放行', (await sniffImage(png)).ok)

  const jpeg = await sharp(png).jpeg().toBuffer()
  const webp = await sharp(png).webp().toBuffer()
  check('jpeg 放行', (await sniffImage(jpeg)).ok)
  check('webp 放行', (await sniffImage(webp)).ok)

  // 改名的可执行文件：扩展名和 MIME 说自己是图，字节说了算
  const exe = Buffer.concat([Buffer.from('MZ'), Buffer.alloc(512, 0x90)])
  check('伪装成图片的可执行文件被拒', !(await sniffImage(exe)).ok)
  check('纯文本被拒', !(await sniffImage(Buffer.from('<html>hi</html>'))).ok)
  check('空文件被拒', !(await sniffImage(Buffer.alloc(0))).ok)

  // SVG 是 sharp 认得的格式，所以这条拒绝是政策而不是解析失败 —— 得单独钉住
  const svg = Buffer.from(
    '<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"><rect width="10" height="10"/></svg>',
  )
  check('sharp 本来认得这段 SVG', (await sharp(svg).metadata()).format === 'svg')
  check('SVG 被拒', !(await sniffImage(svg)).ok)

  // 解压炸弹的形状：文件很小，摊开很大。得在解码之前就判掉
  const bomb = await sharp({ create: { width: 8000, height: 6000, channels: 3, background: '#fff' } })
    .png()
    .toBuffer()
  const bombMeta = await sharp(bomb).metadata()
  check(
    '炸弹样本确实是小文件大像素',
    bomb.length < 300_000 && bombMeta.width! * bombMeta.height! > MAX_PIXELS,
    `${(bomb.length / 1024).toFixed(0)}KB / ${bombMeta.width}×${bombMeta.height}`,
  )
  check('超像素的图被拒', !(await sniffImage(bomb)).ok)

  // — 安全响应头 —
  const headersOf = async (path: string) => (await fetch(BASE + path)).headers
  const page = await headersOf('/')
  const csp = page.get('content-security-policy') ?? ''

  check('页面带 nosniff', page.get('x-content-type-options') === 'nosniff')
  check('禁止被套 iframe', csp.includes("frame-ancestors 'none'"))
  check('限制表单去向', csp.includes("form-action 'self'"))
  check('禁用插件对象', csp.includes("object-src 'none'"))
  check('锁死 base 标签', csp.includes("base-uri 'self'"))
  check('跨站不漏订单号', (page.get('referrer-policy') ?? '').includes('strict-origin'))

  // CSP 收得太紧会把站打死：这几样是页面真的在用的
  check('放行模糊占位和二维码', csp.includes('img-src') && csp.includes('data:'))
  check('放行上传前的本地预览', csp.includes('blob:'))
  check('放行 Next 的内联水合脚本', csp.includes("script-src 'self' 'unsafe-inline'"))

  // 上传目录是公开静态文件，猜类型这条路必须在那儿也堵上
  const shot = await db.productImage.findFirst({ select: { url: true } })
  if (shot) {
    const asset = await headersOf(shot.url)
    check('图片响应也带 nosniff', asset.get('x-content-type-options') === 'nosniff')
    check('图片类型正确', (asset.get('content-type') ?? '').includes('image/webp'))
  }
}

await runRoutes()
await runCheckout()
await runAddresses()
await runCrypto()
await runVerification()
await runPaging()
await runFulfilment()
await runAdmin()
await runVariants()
await runShowcase()
await runHomeRails()
await runOrderMemory()
await runBottomNav()
async function runSiteText() {
  console.log('\n— 站点文案与政策页 —')

  const { parsePolicy } = await import('../src/lib/policy')
  const { SHOWCASE_FALLBACK, showcaseText } = await import('../src/lib/showcase')

  // 留空回退：后台一次都不进，站上也不该出现空标题
  check('留空回退到缺省', showcaseText(undefined, 'site').headline === SHOWCASE_FALLBACK.site.headline)
  // 后台把「只打了几个空格」存成空串（zod 的 .trim()），这里必须跟着回退，
  // 否则前台会顶着一行看不见的标题
  check(
    '空字符串也算没填',
    showcaseText({ headline: '', subhead: '' }, 'home').headline ===
      SHOWCASE_FALLBACK.home.headline,
  )
  check('填了就用填的', showcaseText({ headline: '自定义', subhead: null }, 'site').headline === '自定义')
  // 公告条是唯一不该有兜底的：有兜底就等于关不掉
  check('公告条没有代码兜底', SHOWCASE_FALLBACK.banner.headline === '')

  // 正文解析
  const blocks = parsePolicy('第一段\n\n## 小标题\n\n- 甲\n- 乙\n\n最后一段')
  check('分段数正确', blocks.length === 4, String(blocks.length))
  check('小标题认得出', blocks[1].kind === 'heading' && blocks[1].text === '小标题')
  check('列表认得出', blocks[2].kind === 'list' && blocks[2].items.join('/') === '甲/乙')
  check('多余空行不产生空段', parsePolicy('甲\n\n\n\n乙').length === 2)
  check('Windows 换行也能分段', parsePolicy('甲\r\n\r\n乙').length === 2)
  check('全空正文得到空数组', parsePolicy('   \n\n  ').length === 0)

  // 前台真的换成了后台的文案
  const custom = { headline: 'Smoke Shop', subhead: 'Smoke tagline here.' }
  const before = await db.showcase.findUnique({ where: { key: 'site' } })
  await db.showcase.upsert({
    where: { key: 'site' },
    update: custom,
    create: { key: 'site', ...custom },
  })

  const home = await (await fetch(BASE + '/')).text()
  check('页头 logo 换成后台的站名', home.includes('>Smoke Shop</a>'), 'Smoke Shop')
  check('页脚品牌名跟着换', home.includes('>Smoke Shop</p>'))
  check('页脚简介跟着换', home.includes('Smoke tagline here.'))
  check('浏览器标题跟着换', home.includes('<title>Smoke Shop</title>'))
  check('版权行跟着换', /©\s*\d{4}\s*Smoke Shop/.test(home))

  // 还原，别把测试数据留在库里
  if (before) {
    await db.showcase.update({
      where: { key: 'site' },
      data: { headline: before.headline, subhead: before.subhead },
    })
  } else {
    await db.showcase.delete({ where: { key: 'site' } })
  }

  // 公告条清空就该整条消失
  const banner = await db.showcase.findUnique({ where: { key: 'banner' } })
  await db.showcase.update({ where: { key: 'banner' }, data: { headline: null } })
  const bare = await (await fetch(BASE + '/')).text()
  check('清空公告条后整条不渲染', !bare.includes('bg-ink py-2 text-center'))
  await db.showcase.update({ where: { key: 'banner' }, data: { headline: banner?.headline ?? null } })
  const restored = await (await fetch(BASE + '/')).text()
  check('填回去又出现', restored.includes('bg-ink py-2 text-center'))

  /* 首页大标题居中，且排在两个性别入口之后：选性别是进站第一件事。
     不去匹配具体的 padding 类名，那个一调排版就失效，找标题所在的 section 才稳 */
  // 锚在 <h1> 这个结构上，不锚具体文案：主标题现在归后台管，
  // 写死内置文案的话运营一改首页这条就开始误报
  const heroAt = restored.indexOf('<h1')
  const tilesAt = restored.indexOf('aspect-3/4')
  check('性别入口排在大标题之前', tilesAt > 0 && heroAt > tilesAt, `入口@${tilesAt} 标题@${heroAt}`)

  const opened = restored.lastIndexOf('<section', heroAt)
  const heroTag = restored.slice(opened, restored.indexOf('>', opened) + 1)
  check('首页主视觉居中', heroTag.includes('text-center'), heroTag.slice(0, 90))

  // 政策页
  const policies = await db.policy.findMany({ where: { published: true }, select: { slug: true, title: true } })
  check('有已发布的政策页', policies.length > 0, `${policies.length} 篇`)
  for (const policy of policies) {
    check(`页脚链到 ${policy.slug}`, restored.includes(`/policy/${policy.slug}`))
  }
  const dead: string[] = []
  for (const policy of policies) {
    if ((await fetch(`${BASE}/policy/${policy.slug}`)).status !== 200) dead.push(policy.slug)
  }
  check('政策页都打得开', dead.length === 0, dead.join(' ') || `${policies.length} 篇全通`)
  check('不存在的政策页 404', (await fetch(BASE + '/policy/nope')).status === 404)

  // 草稿不能露出来：后台还没写完的东西不该被人翻到
  const draft = await db.policy.create({
    data: { slug: 'smoke-draft', title: 'Smoke Draft', body: '还没写完', published: false },
  })
  const withDraft = await (await fetch(BASE + '/')).text()
  check('草稿不进页脚', !withDraft.includes('/policy/smoke-draft'))
  check('草稿页直接 404', (await fetch(BASE + '/policy/smoke-draft')).status === 404)

  /* 正文是后台能写、访客能读的字段。哪天有人把它改成 dangerouslySetInnerHTML，
     就是一个存储型 XSS——写一段真的会执行的东西进去，钉住「只能是字」这条线。 */
  await db.policy.update({
    where: { slug: draft.slug },
    data: {
      published: true,
      title: 'Smoke <img src=x onerror=alert(1)>',
      body: '<script>alert(1)</script>\n\n- <b>粗体</b>不该生效',
    },
  })
  const injected = await (await fetch(`${BASE}/policy/${draft.slug}`)).text()
  check('正文里的 script 被转义', !injected.includes('<script>alert(1)</script>'))
  check('正文里的标签被转义', !injected.includes('<b>粗体</b>'))
  check('标题里的标签被转义', !injected.includes('<img src=x onerror=alert(1)>'))
  check('转义后原文照样看得见', injected.includes('&lt;script&gt;'))

  await db.policy.delete({ where: { slug: draft.slug } })
}

await runImageSearch()
await runSiteText()
await runHardening()
await runLayoutLint()
await runPrivate()
await db.$disconnect()

console.log(failed ? `\n${failed} 项失败` : '\n全部通过')
process.exit(failed ? 1 : 0)
