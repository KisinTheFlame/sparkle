#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

# 停掉 ecosystem 里的所有 PM2 进程。apps 骨架为空时 ecosystem 无进程，pm2 stop 会
# 报“进程不存在”，以 `|| true` 容忍，保持幂等。
pnpm exec pm2 stop ecosystem.config.cjs || true
