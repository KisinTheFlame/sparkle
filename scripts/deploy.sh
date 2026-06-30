#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

SERVICE="${1:-}"

# 应用 Prisma 迁移：DATABASE_URL 取自 config.yaml 的 server.databaseUrl（与运行时同库）。
# 仅 agent 写库，故迁移前只需停 agent 腾出独占访问；无待应用迁移时跳过（status 只读，
# 与运行进程并存无碍），避免 SQLite WAL 下与运行进程争锁导致 "database is locked"。
migrate_db() {
  local db_url
  db_url="$(node "$ROOT_DIR/scripts/read-config.mjs" server.databaseUrl)"
  if DATABASE_URL="$db_url" pnpm --filter @sparkle/db exec prisma migrate status >/dev/null 2>&1; then
    echo "[app:deploy]   schema 已最新，跳过迁移（避免与运行进程争锁）。"
    return
  fi
  echo "[app:deploy]   检测到待应用迁移，暂停 agent 后迁移..."
  pnpm exec pm2 stop sparkle-agent >/dev/null 2>&1 || true
  if DATABASE_URL="$db_url" pnpm --filter @sparkle/db exec prisma migrate deploy; then
    echo "[app:deploy]   迁移完成，进程将在重载步骤拉起。"
  else
    echo "[app:deploy]   迁移失败！立即拉回 agent 避免停机，然后中止部署。" >&2
    pnpm exec pm2 start sparkle-agent >/dev/null 2>&1 || true
    exit 1
  fi
}

# ── 单服务模式：pnpm app:deploy <agent|console|web> ────────────────────────────
# 只重建并重载指定服务（含其依赖包），不跑迁移、不动其它进程。改了某个服务时用它即可；
# 涉及 DB schema 变更请用无参 `pnpm app:deploy`（它会跑迁移）。
if [ -n "$SERVICE" ]; then
  case "$SERVICE" in
    agent) PKG="@sparkle/agent"; PM2_NAME="sparkle-agent" ;;
    console) PKG="@sparkle/console"; PM2_NAME="sparkle-console" ;;
    web) PKG="@sparkle/web"; PM2_NAME="sparkle-web" ;;
    *)
      echo "用法: pnpm app:deploy [<agent|console|web>]" >&2
      echo "  无参：全量构建 + Prisma 迁移 + 重载所有进程。" >&2
      echo "  带服务名：只重建并重载该服务，不跑迁移、不动其它进程。" >&2
      exit 1
      ;;
  esac
  echo "[app:deploy] 单服务部署：构建 ${PKG}（含其依赖包）..."
  pnpm --filter "${PKG}..." build
  echo "[app:deploy] 重载 ${PM2_NAME}（不动其它进程、不跑迁移）..."
  pnpm exec pm2 startOrReload ecosystem.config.cjs --only "${PM2_NAME}" --update-env
  pnpm exec pm2 save
  echo "[app:deploy] Done：${PM2_NAME} 已重载（其它进程未受影响）。"
  exit 0
fi

# ── 全量部署（无参）────────────────────────────────────────────────────────────
echo "[app:deploy] Step 1/4: Building workspace..."
pnpm build

echo "[app:deploy] Step 2/4: Applying Prisma migrations..."
migrate_db

echo "[app:deploy] Step 3/4: Reloading PM2 apps..."
pnpm exec pm2 startOrReload ecosystem.config.cjs --update-env

echo "[app:deploy] Step 4/4: Saving PM2 process list..."
pnpm exec pm2 save

echo "[app:deploy] Done."
