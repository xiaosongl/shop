# Windows 一键部署。
#
#   npm run deploy
#
# 干的事：确认本地改动都推上去了 -> ssh 到服务器 -> 跑 scripts/deploy.sh。
# 服务器地址读 .env 里的 DEPLOY_HOST，形如 user@1.2.3.4；
# 用 gcloud 管密钥的话填 gcloud:实例名 或 gcloud:实例名:区域。

$ErrorActionPreference = 'Stop'

$root = Split-Path $PSScriptRoot -Parent
Set-Location $root

function Read-EnvValue([string]$key) {
  if (-not (Test-Path '.env')) { return '' }
  $line = Select-String -Path '.env' -Pattern "^$key=" -Encoding utf8 | Select-Object -First 1
  if (-not $line) { return '' }
  return ($line.Line -replace "^$key=", '').Trim('"', "'", ' ')
}

$deployHost = Read-EnvValue 'DEPLOY_HOST'
$deployPath = Read-EnvValue 'DEPLOY_PATH'
if (-not $deployPath) { $deployPath = '/opt/shop' }

if (-not $deployHost) {
  Write-Host "请先在 .env 里填 DEPLOY_HOST" -ForegroundColor Red
  Write-Host '  普通 ssh：DEPLOY_HOST="ubuntu@34.12.34.56"'
  Write-Host '  gcloud： DEPLOY_HOST="gcloud:shop-vm:us-west1-b"'
  exit 1
}

# 服务器是 git pull 拿代码的，本地没推上去等于白部署
$dirty = git status --porcelain
if ($dirty) {
  Write-Host "工作区有未提交的改动：" -ForegroundColor Yellow
  git status --short
  if ((Read-Host "仍然继续？(y/N)") -ne 'y') { exit 1 }
}

$branch = (git rev-parse --abbrev-ref HEAD).Trim()
$ahead = (git rev-list --count "origin/$branch..HEAD" 2>$null)
if ($ahead -and $ahead -ne '0') {
  Write-Host "有 $ahead 个提交没推送，先 push" -ForegroundColor Yellow
  git push origin $branch
}

# -H 是必须的：不带的话 HOME 还是登录用户的，npm 会往别人家目录写缓存
$remote = "sudo -u shop -H $deployPath/scripts/deploy.sh"

Write-Host "`n部署到 $deployHost" -ForegroundColor Cyan

if ($deployHost.StartsWith('gcloud:')) {
  $parts = $deployHost.Substring(7).Split(':')
  $args = @('compute', 'ssh', $parts[0], '--command', $remote)
  if ($parts.Count -gt 1) { $args += @('--zone', $parts[1]) }
  & gcloud @args
} else {
  & ssh $deployHost $remote
}

if ($LASTEXITCODE -ne 0) {
  Write-Host "`n部署失败。上服务器看日志：journalctl -u shop -n 50 --no-pager" -ForegroundColor Red
  exit $LASTEXITCODE
}

Write-Host "`n部署完成" -ForegroundColor Green
