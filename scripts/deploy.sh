#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

SERVICE="${1:-}"

# ── 单服务模式：pnpm app:deploy <agent|console|gateway|web|oss|browser|llm|metric|spire|napcat|pixel|gba|scheduler> ─────
# 只重建并重载指定服务（含其依赖包），不跑迁移、不动其它进程。改了某个服务时用它即可——
# 尤其重载 console / gateway 不会打断 sparkle-agent 的热状态（KV 缓存前缀、HNSW 索引、活内存
# 上下文），符合「KV 缓存命中率优先」原则。涉及 DB schema 变更请用无参 `pnpm app:deploy`
# （它会跑迁移）。
if [ -n "$SERVICE" ]; then
  case "$SERVICE" in
    agent) PKG="@sparkle/agent"; PM2_NAME="sparkle-agent" ;;
    console) PKG="@sparkle/console"; PM2_NAME="sparkle-console" ;;
    gateway) PKG="@sparkle/gateway"; PM2_NAME="sparkle-gateway" ;;
    # web 自 #578 起是真服务（管理台前端独立进程，自持静态托管），不再是 gateway 的弃用别名。
    web) PKG="@sparkle/web"; PM2_NAME="sparkle-web" ;;
    oss) PKG="@sparkle/oss"; PM2_NAME="sparkle-oss" ;;
    browser) PKG="@sparkle/browser"; PM2_NAME="sparkle-browser" ;;
    llm) PKG="@sparkle/llm-service"; PM2_NAME="sparkle-llm" ;;
    metric) PKG="@sparkle/metric"; PM2_NAME="sparkle-metric" ;;
    spire) PKG="@sparkle/spire-service"; PM2_NAME="sparkle-spire" ;;
    napcat) PKG="@sparkle/napcat"; PM2_NAME="sparkle-napcat" ;;
    pixel) PKG="@sparkle/pixel-service"; PM2_NAME="sparkle-pixel" ;;
    gba) PKG="@sparkle/gba-service"; PM2_NAME="sparkle-gba" ;;
    scheduler) PKG="@sparkle/scheduler-service"; PM2_NAME="sparkle-scheduler" ;;
    *)
      echo "用法: pnpm app:deploy [<agent|console|gateway|web|oss|browser|llm|metric|spire|pixel|gba|napcat|scheduler>]" >&2
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
# SQLite 下的迁移：prisma migrate 的 schema engine 用独立连接、不带 busy_timeout，
# 当持库进程（#539 后主库仅 sparkle-agent 长期持有）开着 WAL 库时它拿不到锁，会直接
# "database is locked" 而中止部署。对策：无待应用迁移时（绝大多数部署）跳过 deploy
# （status 是只读、WAL 下与运行进程并存无碍）；确有待应用迁移时，先停掉相关进程腾出
# 独占访问再迁，迁移成功与否都把进程拉回来，Step 3 的 startOrReload 再正常 reload。
if pnpm db:migrate:status >/dev/null 2>&1; then
  echo "[app:deploy]   schema 已最新，跳过迁移（避免与运行进程争锁）。"
else
  echo "[app:deploy]   检测到待应用迁移，暂停 sparkle-agent 后迁移..."
  # 主库 agent.db 自 #539 起由 sparkle-agent 独占（browser/napcat/llm 已拆库、console 零 DB
  # 且均已在生产落地），迁移只需停 agent 一个进程——这正是 epic #539 的核心收益：
  # 主库 schema 变更不再打断浏览器登录态 / QQ 长连接 / OAuth 刷新等卫星进程热状态。
  pnpm exec pm2 stop sparkle-agent >/dev/null 2>&1 || true
  if pnpm db:migrate:deploy; then
    echo "[app:deploy]   迁移完成，进程将在 Step 3 重新拉起。"
  else
    echo "[app:deploy]   迁移失败！立即拉回进程避免停机，然后中止部署。" >&2
    pnpm exec pm2 start sparkle-agent >/dev/null 2>&1 || true
    exit 1
  fi
fi

echo "[app:deploy] Step 2b/4: Applying napcat Prisma migrations..."
# napcat 有独立 SQLite 库（napcat_event / napcat_qq_message / outbox / image_asset，#539），
# 只被 sparkle-napcat 单进程持有——迁移只需暂停这一个进程腾出独占锁。
if pnpm --filter @sparkle/napcat db:migrate:status >/dev/null 2>&1; then
  echo "[app:deploy]   napcat schema 已最新，跳过迁移。"
else
  echo "[app:deploy]   检测到 napcat 待应用迁移，暂停 sparkle-napcat 后迁移..."
  pnpm exec pm2 stop sparkle-napcat >/dev/null 2>&1 || true
  if pnpm --filter @sparkle/napcat db:migrate:deploy; then
    echo "[app:deploy]   napcat 迁移完成，进程将在 Step 3 重新拉起。"
  else
    # 拉回本步之前（含 Step 2 主库分支）停过的全部进程：中止部署绝不能把 agent 晾在停机态
    #（对已运行进程 pm2 start 是 no-op，安全）。
    echo "[app:deploy]   napcat 迁移失败！立即拉回全部已停进程避免停机，然后中止部署。" >&2
    pnpm exec pm2 start sparkle-agent sparkle-napcat >/dev/null 2>&1 || true
    exit 1
  fi
fi

echo "[app:deploy] Step 2c/4: Applying llm Prisma migrations..."
# llm 有独立 SQLite 库（llm_chat_call / embedding_cache / claude_file_cache / oauth_*，#539），
# 只被 sparkle-llm 单进程持有——迁移只需暂停这一个进程腾出独占锁。
if pnpm --filter @sparkle/llm-service db:migrate:status >/dev/null 2>&1; then
  echo "[app:deploy]   llm schema 已最新，跳过迁移。"
else
  echo "[app:deploy]   检测到 llm 待应用迁移，暂停 sparkle-llm 后迁移..."
  pnpm exec pm2 stop sparkle-llm >/dev/null 2>&1 || true
  if pnpm --filter @sparkle/llm-service db:migrate:deploy; then
    echo "[app:deploy]   llm 迁移完成，进程将在 Step 3 重新拉起。"
  else
    # 拉回此前所有步骤停过的进程，绝不把 agent 晾在停机态。
    echo "[app:deploy]   llm 迁移失败！立即拉回全部已停进程避免停机，然后中止部署。" >&2
    pnpm exec pm2 start sparkle-agent sparkle-napcat sparkle-llm >/dev/null 2>&1 || true
    exit 1
  fi
fi

echo "[app:deploy] Step 2d/4: Applying scheduler Prisma migrations..."
# scheduler 有独立 SQLite 库（TaskRun 执行历史，#493），只被 sparkle-scheduler 单进程持有——
# 迁移只需暂停这一个进程腾出独占锁，与主库那批多进程互不相干。无待应用迁移时（status 只读）跳过。
if pnpm --filter @sparkle/scheduler-service db:migrate:status >/dev/null 2>&1; then
  echo "[app:deploy]   scheduler schema 已最新，跳过迁移。"
else
  echo "[app:deploy]   检测到 scheduler 待应用迁移，暂停 sparkle-scheduler 后迁移..."
  pnpm exec pm2 stop sparkle-scheduler >/dev/null 2>&1 || true
  if pnpm --filter @sparkle/scheduler-service db:migrate:deploy; then
    echo "[app:deploy]   scheduler 迁移完成，进程将在 Step 3 重新拉起。"
  else
    # 同 Step 2b：拉回此前所有步骤停过的进程，绝不把 agent 晾在停机态。
    echo "[app:deploy]   scheduler 迁移失败！立即拉回全部已停进程避免停机，然后中止部署。" >&2
    pnpm exec pm2 start sparkle-agent sparkle-napcat sparkle-llm sparkle-scheduler >/dev/null 2>&1 || true
    exit 1
  fi
fi

echo "[app:deploy] Step 2e/4: Applying oss Prisma migrations..."
# oss 有独立 SQLite 库（blob / object 对象元数据），只被 sparkle-oss 单进程持有——迁移只需暂停
# 这一个进程腾出独占锁。无待应用迁移时（status 只读）跳过。首次 prisma 化前，存量库需先做一次
# baseline（`pnpm --filter @sparkle/oss db:migrate:resolve --applied <init>`）标记初始迁移已应用，
# 否则 migrate deploy 会因 CREATE TABLE 撞已存在的表而失败（见 docs/configuration.md）。
if pnpm --filter @sparkle/oss db:migrate:status >/dev/null 2>&1; then
  echo "[app:deploy]   oss schema 已最新，跳过迁移。"
else
  echo "[app:deploy]   检测到 oss 待应用迁移，暂停 sparkle-oss 后迁移..."
  pnpm exec pm2 stop sparkle-oss >/dev/null 2>&1 || true
  if pnpm --filter @sparkle/oss db:migrate:deploy; then
    echo "[app:deploy]   oss 迁移完成，进程将在 Step 3 重新拉起。"
  else
    echo "[app:deploy]   oss 迁移失败！立即拉回全部已停进程避免停机，然后中止部署。" >&2
    pnpm exec pm2 start sparkle-agent sparkle-napcat sparkle-llm sparkle-scheduler sparkle-oss >/dev/null 2>&1 || true
    exit 1
  fi
fi

echo "[app:deploy] Step 2f/4: Applying gba Prisma migrations..."
# gba 有独立 SQLite 库（rom / battery_save / run_state / resume_state），只被 sparkle-gba 单进程
# 持有——迁移只需暂停这一个进程腾出独占锁。无待应用迁移时（status 只读）跳过。首次 prisma 化前，
# 存量库同样需先 baseline（`pnpm --filter @sparkle/gba-service db:migrate:resolve --applied <init>`）。
if pnpm --filter @sparkle/gba-service db:migrate:status >/dev/null 2>&1; then
  echo "[app:deploy]   gba schema 已最新，跳过迁移。"
else
  echo "[app:deploy]   检测到 gba 待应用迁移，暂停 sparkle-gba 后迁移..."
  pnpm exec pm2 stop sparkle-gba >/dev/null 2>&1 || true
  if pnpm --filter @sparkle/gba-service db:migrate:deploy; then
    echo "[app:deploy]   gba 迁移完成，进程将在 Step 3 重新拉起。"
  else
    echo "[app:deploy]   gba 迁移失败！立即拉回全部已停进程避免停机，然后中止部署。" >&2
    pnpm exec pm2 start sparkle-agent sparkle-napcat sparkle-llm sparkle-scheduler sparkle-oss sparkle-gba >/dev/null 2>&1 || true
    exit 1
  fi
fi

echo "[app:deploy] Step 3/4: Reloading PM2 apps..."
pnpm exec pm2 startOrReload ecosystem.config.cjs --update-env

echo "[app:deploy] Step 4/4: Saving PM2 process list..."
pnpm exec pm2 save

echo "[app:deploy] Done."
