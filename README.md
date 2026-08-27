# Northsound

服装、鞋履、箱包、腕表商城。英文前台（面向北美客户）+ 中文后台，游客下单不需要注册。

- **前台**：性别 → 品牌 → 类别 → 商品列表 → 详情 → 购物车 → 四步结算 → 订单查询
- **支付**：BTC（固定地址 + 二维码，客户回填 TXID，后台人工确认）、WhatsApp 联系客服开票
- **后台**：订单流转、BTC 到账确认、商品与品牌管理、图片上传、库存
- **私域**：全站不给搜索引擎收录，微信/QQ 内置浏览器引导跳转，备用域名

## 本地跑起来（Windows 11）

需要 Node 22+。

```powershell
npm install          # 装依赖，顺带生成 Prisma 客户端
npm run fetch:model  # 拉图搜用的 CLIP 权重（85MB，只需一次）
npm run db:migrate   # 建库
npm run db:seed      # 灌演示数据，会下载并处理商品图，第一次要几分钟
npm run dev
```

打开 http://localhost:3000 。后台在 http://localhost:3000/admin ，默认账号 `admin` / `admin123`（在 `.env` 里改）。

没有 `.env` 的话先 `cp .env.example .env`，本地调试用默认值就能跑。

## 命令

| 命令 | 作用 |
| --- | --- |
| `npm run dev` | 开发服务器 |
| `npm run build` / `npm start` | 生产构建与启动 |
| `npm run check` | 冒烟测试，**需要 dev server 在跑**。覆盖路由、结算、支付、后台鉴权、防收录，共 70+ 项 |
| `npm run db:migrate` | 建表或改表结构 |
| `npm run db:seed` | 写入演示数据 |
| `npm run db:reset` | 清库重来 |
| `npm run db:studio` | 图形化看数据 |
| `npm run fetch:model` | 下载图搜模型到 `models/`，已有则跳过 |
| `npm run embed` | 给商品图建图搜索引，加 `-- --reset` 全量重算 |
| `npm run deploy` | 一键部署到服务器，见 [docs/DEPLOY.md](docs/DEPLOY.md) |

改完代码习惯性跑一次 `npm run check`，比手点快得多。

## 目录

```
prisma/          数据库结构、演示数据
scripts/         冒烟测试、部署脚本
src/app/
  (shop)/        前台，英文
  admin/         后台，中文；(protected)/ 里的页面需要登录
src/components/  UI 组件，admin/ 下的是后台专用
src/lib/         数据查询、服务端动作、定价、图片处理、鉴权
public/products/ 种子数据的商品图（不进 git）
public/uploads/  后台上传的图（不进 git）
data/            SQLite 数据库（不进 git）
```

## 几个关键设计

**图片在入库时就处理完**。`src/lib/images.ts` 用 sharp 生成 400/800/1200/1600 四档 WebP、1200×630 的分享卡片图和 base64 模糊占位，文件名带内容哈希。运行时不做任何转码，源站零 CPU 消耗，CDN 可以放心缓存一年。

**价格永远服务端算**。购物车在 localStorage 里只存 `variantId` 和数量，金额由 `src/lib/actions.ts` 的 `resolveCart` 现查数据库算，客户端改不了。下单时用事务原子扣库存，超卖不了。

**订单状态机只允许四种流转**。`src/lib/order-status.ts`，取消订单会自动退回库存。

**站点文案全在后台**。站名、顶部公告、首页主视觉、性别入口、页脚备注都存在 `Showcase` 表里，键的清单在 `src/lib/showcase.ts`——加一个文案位只要加一行，表结构和后台表单都不用动。除公告条外每个位置留空都回退到代码里的缺省，所以后台一次都不进，站也是完整的。

**政策页正文按纯文本渲染**，不是 HTML。这是后台能写、访客能读的字段，改成 `dangerouslySetInnerHTML` 就等于开了一个存储型 XSS。`src/lib/policy.ts` 只认空行分段、`## ` 小标题、`- ` 列表三种标记，其余交给 React 转义，冒烟里有一条会往正文塞 `<script>` 的用例钉着。

**防收录做了四层**：`robots.ts`、根布局的 meta robots、`next.config.ts` 的 `X-Robots-Tag` 响应头、`src/proxy.ts` 按 UA 拦爬虫。分享抓取器（WhatsApp、Facebook、Twitter）单独放行，否则私域分享出不了预览图。

**后台鉴权在布局里而不是 proxy 里**。proxy 跑在 edge 运行时，用不了 `node:crypto` 验 HMAC 签名，所以放在 `src/app/admin/(protected)/layout.tsx`。

## 上线

见 [docs/DEPLOY.md](docs/DEPLOY.md)：GCE + Cloudflare Tunnel，图片走 CDN，源站 IP 不暴露，含防红方案和日常运维命令。
