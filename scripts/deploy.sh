#!/usr/bin/env bash
#
# 在服务器上更新并重启站点。可重复执行。
#
#   sudo -u shop /opt/shop/scripts/deploy.sh
#
# 不会碰 data/（SQLite 库）和 public/uploads（后台上传的图），
# 这两个目录在 .gitignore 里，deploy 覆盖不到，客户数据和商品图不会丢。
set -euo pipefail

APP_DIR="${APP_DIR:-/opt/shop}"
cd "$APP_DIR"

log() { printf '\n\033[1m==> %s\033[0m\n' "$*"; }

[[ -f .env ]] || { echo "缺少 $APP_DIR/.env，先照 .env.example 填一份"; exit 1; }

log "拉取代码"
git fetch --depth 1 origin
git reset --hard "origin/$(git rev-parse --abbrev-ref HEAD)"

log "安装依赖"
# ci 而不是 install：严格按 lockfile 装，构建结果可复现
npm ci

log "准备图搜模型"
# 权重 85MB，太大不进 git，所以每台机器自己拉一份。已经有了就直接跳过。
npm run fetch:model

# 先记下库存不存在，migrate 会把文件建出来，之后就分不清是不是首次部署了
FIRST_RUN=false
[[ -f data/shop.db ]] || FIRST_RUN=true

log "迁移数据库"
# migrate deploy 只做增量，不会像 migrate dev 那样在冲突时提议重置
npx prisma migrate deploy
npx prisma generate

if [[ "$FIRST_RUN" == true ]]; then
  log "首次部署，写入初始数据"
  npm run db:seed
fi

log "补图搜索引"
# 只处理还没有向量的图。后台传图时是当场算的，这里兜住历史数据和中断重跑。
npm run embed

log "构建"
npm run build

log "重启服务"
# systemctl 要 root，deploy 一般用 shop 账号跑，所以这里带 sudo
sudo systemctl restart shop

log "健康检查"
DOMAIN=$(grep -oP '^ALLOWED_HOSTS="?\K[^",]*' .env || true)
for i in $(seq 1 20); do
  # 带 Host 头是因为 proxy.ts 会按 ALLOWED_HOSTS 拒绝陌生域名
  code=$(curl -s -o /dev/null -w '%{http_code}' \
    ${DOMAIN:+-H "Host: ${DOMAIN}"} http://127.0.0.1:3000/ || true)
  if [[ "$code" == "200" ]]; then
    log "上线成功（第 ${i} 次探测返回 200）"
    exit 0
  fi
  sleep 2
done

echo "健康检查失败，最后一次返回 ${code:-无响应}"
echo "看日志：journalctl -u shop -n 50 --no-pager"
exit 1
