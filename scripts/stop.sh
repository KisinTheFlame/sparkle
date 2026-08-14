#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

SERVICE="${1:-}"

# 无参：停掉 ecosystem 里的所有进程。
if [ -z "$SERVICE" ]; then
  pnpm exec pm2 stop ecosystem.config.cjs
  exit 0
fi

# ── 单服务模式：pnpm app:stop <agent|console|gateway|web|oss|browser|llm|metric|scheduler> ──
# 别名 → PM2 进程名。与 scripts/deploy.sh 的别名表保持一致，让 stop / deploy 用同一套短名。
case "$SERVICE" in
  agent) PM2_NAME="sparkle-agent" ;;
  console) PM2_NAME="sparkle-console" ;;
  gateway) PM2_NAME="sparkle-gateway" ;;
  # web 自 #578 起是真服务（管理台前端独立进程），不再是 gateway 的弃用别名。
  web) PM2_NAME="sparkle-web" ;;
  oss) PM2_NAME="sparkle-oss" ;;
  browser) PM2_NAME="sparkle-browser" ;;
  llm) PM2_NAME="sparkle-llm" ;;
  metric) PM2_NAME="sparkle-metric" ;;
  scheduler) PM2_NAME="sparkle-scheduler" ;;
  *)
    echo "用法: pnpm app:stop [<agent|console|gateway|web|oss|browser|llm|metric|scheduler>]" >&2
    echo "  无参：停掉所有进程。" >&2
    echo "  带服务名：只停该服务。" >&2
    exit 1
    ;;
esac

pnpm exec pm2 stop "${PM2_NAME}"
