#!/usr/bin/env bash
#
# 一次性初始化一台全新的 GCE 机器（Debian 12 / Ubuntu 22.04+）。
# 可重复执行：每一步都先检查再动手，跑第二遍不会破坏已有数据。
#
#   curl -fsSL https://raw.githubusercontent.com/<你的仓库>/main/scripts/setup-server.sh | sudo bash -s -- <git 仓库地址>
#
# 跑完之后：填 /opt/shop/.env，然后执行 /opt/shop/scripts/deploy.sh
set -euo pipefail

REPO="${1:-}"
APP_DIR="/opt/shop"
APP_USER="shop"
NODE_MAJOR="22"

log() { printf '\n\033[1m==> %s\033[0m\n' "$*"; }

[[ $EUID -eq 0 ]] || { echo "请用 sudo 运行"; exit 1; }

log "安装系统依赖"
export DEBIAN_FRONTEND=noninteractive
apt-get update -qq
# better-sqlite3 和 sharp 在 linux-x64 上有预编译包，这些是拿不到预编译时的兜底
apt-get install -y -qq curl ca-certificates git python3 make g++ >/dev/null

if ! command -v node >/dev/null || [[ "$(node -v | cut -d. -f1 | tr -d v)" -lt "$NODE_MAJOR" ]]; then
  log "安装 Node.js ${NODE_MAJOR}"
  curl -fsSL "https://deb.nodesource.com/setup_${NODE_MAJOR}.x" | bash - >/dev/null
  apt-get install -y -qq nodejs >/dev/null
fi
log "Node $(node -v) / npm $(npm -v)"

if ! command -v cloudflared >/dev/null; then
  log "安装 cloudflared"
  # 走 Tunnel 就不用开 80/443 入站端口，也不用自己管证书，源站 IP 天然隐藏
  ARCH=$(dpkg --print-architecture)
  curl -fsSL -o /tmp/cloudflared.deb \
    "https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-${ARCH}.deb"
  dpkg -i /tmp/cloudflared.deb >/dev/null
  rm -f /tmp/cloudflared.deb
fi

if ! id "$APP_USER" >/dev/null 2>&1; then
  log "创建运行账号 ${APP_USER}"
  # 不给登录 shell：这个账号只用来跑 Node 进程
  useradd --system --create-home --shell /usr/sbin/nologin "$APP_USER"
fi

if [[ ! -d "$APP_DIR/.git" ]]; then
  [[ -n "$REPO" ]] || { echo "首次安装需要传 git 仓库地址作为参数"; exit 1; }
  log "克隆代码到 ${APP_DIR}"
  git clone --depth 1 "$REPO" "$APP_DIR"
fi

# data/ 存 SQLite，public/uploads 存后台上传的图，两个都不在 git 里，
# 必须先建好并交给运行账号，否则第一次启动就写不进去
mkdir -p "$APP_DIR/data" "$APP_DIR/public/uploads"
chown -R "$APP_USER:$APP_USER" "$APP_DIR"

if [[ ! -f "$APP_DIR/.env" ]]; then
  log "生成 .env 模板"
  cp "$APP_DIR/.env.example" "$APP_DIR/.env"
  # 会话密钥必须一机一个，绝不能用示例值
  SECRET=$(openssl rand -base64 36 | tr -d '\n')
  sed -i "s|^ADMIN_SESSION_SECRET=.*|ADMIN_SESSION_SECRET=\"${SECRET}\"|" "$APP_DIR/.env"
  chown "$APP_USER:$APP_USER" "$APP_DIR/.env"
  chmod 600 "$APP_DIR/.env"
fi

log "写入 systemd 服务"
cat >/etc/systemd/system/shop.service <<EOF
[Unit]
Description=Northsound shop
After=network.target

[Service]
Type=simple
User=${APP_USER}
WorkingDirectory=${APP_DIR}
Environment=NODE_ENV=production
Environment=PORT=3000
# 只监听回环：外部流量一律经 Cloudflare Tunnel 进来，绕不过 CDN 和 WAF
Environment=HOSTNAME=127.0.0.1
EnvironmentFile=${APP_DIR}/.env
ExecStart=/usr/bin/npm run start
Restart=always
RestartSec=3
NoNewPrivileges=true
PrivateTmp=true
ProtectSystem=strict
ReadWritePaths=${APP_DIR}/data ${APP_DIR}/public/uploads ${APP_DIR}/.next

[Install]
WantedBy=multi-user.target
EOF

# deploy.sh 是用 shop 账号跑的，但重启服务要 root。
# 只放开这一条命令，不给这个账号任何别的提权。
cat >/etc/sudoers.d/shop <<'EOF'
shop ALL=(root) NOPASSWD: /usr/bin/systemctl restart shop
EOF
chmod 440 /etc/sudoers.d/shop

systemctl daemon-reload
systemctl enable shop >/dev/null 2>&1 || true

cat <<'DONE'

初始化完成。接下来三步：

  1. 编辑 /opt/shop/.env
       NEXT_PUBLIC_SITE_URL  你的正式域名，带 https://
       ALLOWED_HOSTS         同上，只写域名部分，逗号分隔多个
       BACKUP_DOMAINS        备用域名，主域被标红时展示给访客
       ADMIN_USERNAME / ADMIN_PASSWORD  后台账号，务必改掉

  2. sudo -u shop /opt/shop/scripts/deploy.sh

  3. 上站后进后台：站点文案里填 WhatsApp / Messenger，收款配置里填币种地址。
     加密货币地址存数据库不存 .env，因为每个币+链一个地址、要经常改。
     不填地址前台就没有加密货币选项，这是故意的——宁可不能下单，
     也不能让货款打进一个填错的地址。

  3. 接 Cloudflare Tunnel：
       cloudflared tunnel login
       cloudflared tunnel create shop
       cloudflared tunnel route dns shop 你的域名
       cloudflared tunnel --url http://127.0.0.1:3000 run shop
       cloudflared service install     # 确认没问题后转成后台服务

     详细的 CDN 缓存规则和防红配置见 docs/DEPLOY.md
DONE
