# 部署指南：Google Cloud + Cloudflare

架构一句话：**GCE 跑 Node，Cloudflare 扛流量、缓存图片、隐藏源站 IP，中间用 Tunnel 连接，不开任何入站端口。**

```
访客 ─▶ Cloudflare（CDN 缓存图片 / WAF 拦爬虫 / TLS）
          │  Tunnel（出站长连接，无入站端口）
          ▼
       GCE 虚拟机 ─ Node 127.0.0.1:3000 ─ SQLite + 本地图片
```

为什么用 Tunnel 而不是直接开 443：源站 IP 永远不暴露，被人拿 IP 直连或 DDoS 的路径直接不存在；证书和续期 Cloudflare 全包；防火墙可以一条入站规则都不开。

---

## 一、开一台 GCE 机器

Google Cloud Console → Compute Engine → 创建实例：

| 项目 | 选择 | 说明 |
| --- | --- | --- |
| 区域 | `us-west1` 或 `us-central1` | 面向北美客户，选美国西部延迟低；图片走 CDN，源站位置影响不大 |
| 机型 | `e2-small`（2 vCPU / 2GB） | SQLite + Next 够用。图片在入库时就压好了，运行时不做转码。图搜的模型常驻约 400MB，2GB 仍有余量，但别降到 1GB 的 `e2-micro` |
| 磁盘 | 20GB 标准永久磁盘 | 系统 8GB + 图片增长空间 |
| 系统 | Debian 12 | 脚本按 Debian/Ubuntu 写的 |
| 防火墙 | **两个都不勾** | Tunnel 是出站连接，不需要放行 HTTP/HTTPS |

创建后记下实例名和区域。

## 二、初始化服务器

```bash
gcloud compute ssh 实例名 --zone 区域

curl -fsSL https://raw.githubusercontent.com/<你的仓库>/main/scripts/setup-server.sh \
  | sudo bash -s -- https://github.com/<你的仓库>.git
```

脚本做完这些：装 Node 22、装 cloudflared、建 `shop` 运行账号、克隆代码到 `/opt/shop`、生成随机的会话密钥、注册 systemd 服务。可以重复跑，不会破坏已有数据。

## 三、填 .env

```bash
sudo nano /opt/shop/.env
```

| 变量 | 填什么 | 不填会怎样 |
| --- | --- | --- |
| `NEXT_PUBLIC_SITE_URL` | `https://你的域名` | 分享卡片的图片地址会指向 localhost，微信和 WhatsApp 都出不了预览图 |
| `ALLOWED_HOSTS` | `你的域名,备用域名` | 不限制，别人拿 IP 或野域名就能镜像你的站 |
| `BACKUP_DOMAINS` | `https://备用1,https://备用2` | 主域被标红时访客没有退路 |
| `NEXT_PUBLIC_WHATSAPP_NUMBER` | 带国家码纯数字，如 `12025550143` | WhatsApp 支付选项不出现 |
| `ADMIN_USERNAME` / `ADMIN_PASSWORD` | **务必改掉** | 默认是 `admin` / `admin123`，等于后台不设防 |
| `ADMIN_SESSION_SECRET` | 已自动生成随机值 | — |

`DATABASE_URL` 保持 `file:./data/shop.db` 不用动。

## 四、首次部署

```bash
sudo -u shop -H /opt/shop/scripts/deploy.sh
```

装依赖 → 跑迁移 → 空库时灌初始数据 → 构建 → 重启 → 探测 200。最后打印「上线成功」就是好了。

## 五、接 Cloudflare Tunnel

先把域名的 NS 指到 Cloudflare（域名注册商后台改，生效要几分钟到几小时）。然后在服务器上：

```bash
cloudflared tunnel login                       # 浏览器授权，选你的域名
cloudflared tunnel create shop
cloudflared tunnel route dns shop 你的域名
```

写配置：

```bash
sudo mkdir -p /etc/cloudflared
sudo nano /etc/cloudflared/config.yml
```

```yaml
tunnel: shop
credentials-file: /root/.cloudflared/<上一步输出的 UUID>.json

ingress:
  - hostname: 你的域名
    service: http://127.0.0.1:3000
  - service: http_status:404
```

先前台跑一次确认通了，再转成后台服务：

```bash
cloudflared tunnel run shop        # 浏览器打开域名验证
# Ctrl-C 停掉，然后
sudo cloudflared service install
sudo systemctl enable --now cloudflared
```

## 六、Cloudflare 上要配的五件事

### 1. 图片缓存（这是 CDN 方案的核心）

Caching → Cache Rules → 新建：

- 条件：`URI Path starts with /products/` **或** `/uploads/`
- 动作：Eligible for cache，Edge TTL **1 year**，Browser TTL 1 year

图片文件名带内容哈希（`a1b2c3d4e5f6-1200.webp`），改图必然换名，所以缓存一年也不会读到旧图。这条规则让图片流量几乎全部命中边缘节点，源站只负责第一次回源。

### 2. 拦爬虫（防收录的第四层）

Security → WAF → 自定义规则：

- 条件：`Known Bots` equals `On`，且 `User Agent` 不含 `WhatsApp|facebookexternalhit|Twitterbot`
- 动作：Block

代码里 `src/proxy.ts` 已经拦了一遍，这条是在边缘就挡掉，连源站都不惊动。放行分享抓取器是因为它们要读 OG 标签出预览图。

### 3. 关掉会破坏页面的优化

Speed → Optimization：**Rocket Loader 关掉**（会打乱 React 的水合顺序）。Auto Minify 对 Next 的产物没意义，开关都行。

### 4. SSL 模式

SSL/TLS → Overview → **Full**。Tunnel 段本来就是加密的，选 Flexible 反而会出重定向环。

### 5. 边缘限速

代码里已经按 IP 限了后台登录、传图搜索、下单、订单查询（`src/lib/rate-limit.ts`），但那是**进程内存里的计数**：请求已经打到源站、占过一次 CPU 才被拒。边缘再加一层，量大时源站根本不会被惊动。

Security → WAF → Rate limiting rules，两条就够：

| 规则 | 条件 | 阈值 | 动作 |
| --- | --- | --- | --- |
| 保后台 | `URI Path starts with /admin` | 20 次 / 分钟 / IP | Block 10 分钟 |
| 保图搜 | `URI Path starts with /search` 且 `Method eq POST` | 20 次 / 分钟 / IP | Managed Challenge |

图搜那条给的是验证码而不是封禁：一次识图要跑一遍 CLIP 推理，是全站最贵的请求，但真客户连着传几张图也很正常，直接封会误伤。

> 上多实例或 PM2 cluster 之后，代码里那层限流会按进程数被稀释（每个进程各算各的），那时候边缘这层就是唯一准数。

## 七、域名防红

微信/QQ 的黑名单是它们自己的，代码改不了，只能从三个方向减少损失。

**代码里已经做好的**：`src/components/browser-guard.tsx` 检测到微信、企业微信、QQ、微博、抖音、支付宝、钉钉的内置浏览器时，弹全屏引导让访客跳到系统浏览器，并展示 `BACKUP_DOMAINS` 里的备用地址。外部浏览器不吃这套黑名单。

**运维要做的**：

1. **备好 3–5 个域名**。便宜的 `.com`/`.net` 就行，全部指向同一个 Tunnel（Cloudflare 里加多条 `tunnel route dns`），全部写进 `ALLOWED_HOSTS` 和 `BACKUP_DOMAINS`。主域被标红，改 `NEXT_PUBLIC_SITE_URL` 换一个继续发，`sudo systemctl restart shop` 一分钟切完。
2. **主域不直接发**。发一个中转短链，中转页再跳主域。被标红的只是短链，主域保住。
3. **发之前查一次**。微信开放平台的域名检测接口，或者自己拉个小号在微信里点一下。
4. **不要在群里高频刷**。举报是标红的主要触发源，私聊定向发比群发安全得多。

## 八、日常运维

```bash
# 看日志
journalctl -u shop -n 100 -f

# 更新代码（本地 Windows 上跑，一条命令搞定）
npm run deploy

# 备份数据库和图片
sudo -u shop sqlite3 /opt/shop/data/shop.db ".backup /tmp/shop-$(date +%F).db"
sudo tar czf /tmp/uploads-$(date +%F).tar.gz -C /opt/shop/public uploads
gsutil cp /tmp/shop-*.db /tmp/uploads-*.tar.gz gs://你的存储桶/

# 重启
sudo systemctl restart shop
```

**必须备份的只有两样**：`/opt/shop/data/shop.db`（订单和商品）和 `/opt/shop/public/uploads/`（后台上传的图）。其余全部能从 git 重建。建议挂个每日 cron 传到 Cloud Storage。

## 九、出问题时

| 现象 | 先查这里 |
| --- | --- |
| 域名打不开，Cloudflare 报 1033 | Tunnel 断了：`systemctl status cloudflared` |
| 打开是 404 但服务在跑 | `ALLOWED_HOSTS` 里没写这个域名，proxy.ts 拒掉了 |
| 图片 404 | `public/uploads` 权限：`sudo chown -R shop:shop /opt/shop/public/uploads` |
| 后台登不进去 | `.env` 的 `ADMIN_SESSION_SECRET` 变了会让已有会话失效，重新登录即可 |
| 部署后还是旧代码 | 本地改动没 push，服务器 `git pull` 拿不到 |
| BTC 金额显示不出来 | 服务器出网被挡，拿不到 CoinGecko 汇率：`curl https://api.coingecko.com/api/v3/ping` |
| 客户填了 TXID 但一直卡在待付款 | 服务器连不上链上接口，见下方「链上核验要能出网」 |
| 客户说「Too many attempts」 | 限流打到了。同一出口 IP（公司/校园 NAT）人多时会这样，额度在 `src/lib/rate-limit.ts` 的 `LIMITS` 里调 |
| 后台提示「尝试次数过多」 | 密码连错 8 次，等 10 分钟，或重启服务清掉计数 |
| 上传图片提示「不支持的图片格式」 | 只收 jpeg/png/webp/avif/gif/tiff。SVG 是故意拒的，先转成 PNG 再传 |
| 传图搜索说「warming up」 | 索引是空的：`cd /opt/shop && npm run embed` |
| 传图搜索报错 500 | 模型没拉下来：`cd /opt/shop && npm run fetch:model`，再 `sudo systemctl restart shop` |

### 链上核验要能出网

客户填的转账哈希由服务器直接去链上查，四项（收款地址、金额、确认数、代币合约）全对才自动转已付款。这几个域名必须能出网，GCE 默认放行，只有你自己加了出站防火墙才需要开：

```bash
for u in https://mempool.space/api/blocks/tip/height \
         https://blockstream.info/api/blocks/tip/height \
         https://litecoinspace.org/api/blocks/tip/height \
         https://api.trongrid.io/wallet/getnowblock \
         https://api.mainnet-beta.solana.com ; do
  printf '%-52s %s\n' "$u" "$(curl -s -o /dev/null -w '%{http_code}' -m 10 "$u")"
done
```

连不上的后果是「查不出来」，不是「误放行」——订单会一直停在待付款等人工确认，不会白发货。以太坊和 BSC 没有免费无密钥的公开接口，那两条链本来就走人工核。

### 图搜的模型放在哪

识图用的是 CLIP 视觉模型，85MB，太大不适合进 git，所以不跟代码走，每台机器各拉一份到 `models/`。`deploy.sh` 里已经带了这一步，已经有文件就跳过，不会每次重下。

```bash
cd /opt/shop
npm run fetch:model   # 从 ModelScope 拉权重，国内外都通
npm run embed         # 给还没建索引的商品图算向量，可反复跑
```

跑起来之后推理全在本机做，不出网、不花钱、也不把客户传的图发给第三方。后台新增商品时会当场算好向量，不用手动补。只有换了模型才需要 `npm run embed -- --reset` 全量重算——新旧向量混在一个索引里比出来的分是没有意义的。
