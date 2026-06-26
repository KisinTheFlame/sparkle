# Sparkle

pnpm workspaces monorepo.

## 结构

```
apps/
  agent/      后端服务（Fastify），端口 3001
  console/    后端服务（Fastify），端口 3002
  web/        前端（Vite + React + Tailwind）
packages/
  shared/     跨端共享的 schema 与工具（@sparkle/shared）
```

## 环境

- Node.js >= 22
- pnpm 10.18.3（通过 corepack 激活：`corepack enable`）

## 常用命令

```bash
pnpm install            # 安装依赖
pnpm build              # 递归构建所有包
pnpm typecheck          # 递归类型检查
pnpm lint               # ESLint
pnpm format             # Prettier 检查

# 单独启动
pnpm --filter @sparkle/agent dev
pnpm --filter @sparkle/console dev
pnpm --filter @sparkle/web dev
```
