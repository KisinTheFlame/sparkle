#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

# 基建骨架的部署：先构建全部包（pnpm -r build 按拓扑序，@sparkle/config 叶子最先，
# read-config.mjs 依赖其产物），再应用数据库迁移。apps 目录当前为空——ecosystem 的
# apps 补齐后，这里会自动拉起 PM2 进程。
echo "[app:deploy] 构建所有包..."
pnpm build

echo "[app:deploy] 应用数据库迁移..."
pnpm db:migrate:deploy

if node -e "process.exit(require('./ecosystem.config.cjs').apps.length ? 0 : 1)"; then
  echo "[app:deploy] 启动/重载 PM2 进程..."
  pnpm exec pm2 startOrReload ecosystem.config.cjs
else
  echo "[app:deploy] ecosystem.apps 为空，跳过 PM2（apps 骨架待补齐）。"
fi
