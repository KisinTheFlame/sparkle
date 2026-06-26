# Sparkle

pnpm workspaces monorepo.

## 结构

```
apps/
  agent/      后端服务（Fastify），端口 3001
  console/    后端服务（Fastify），端口 3002
  web/        前端（Vite + React + Tailwind）
packages/
  shared/        跨端共享的 schema、错误与工具（@sparkle/shared）
  llm/           LLM 协议层类型（@sparkle/llm，零依赖）
  agent-runtime/ ReAct kernel / 工具 / effect（@sparkle/agent-runtime）
  claude-code/   Claude Code LLM provider + OAuth 登录（@sparkle/claude-code）
```

## @sparkle/claude-code

从 kagami 移植的 Claude Code API provider 与 OAuth 登录流程，支撑层全部改为**注入式**
（不依赖具体的 config loader / 数据库）：

- `config`：调用方注入 `OAuthRuntimeConfig` 与 provider 配置切片
- 持久化：注入 `OAuthDao`，默认 `InMemoryOAuthDao`（进程内，重启即丢；生产请注入持久化实现）
- 日志：注入最小 `Logger` 接口，默认 no-op
- 票据加密：注入 `OAuthSecretStore`，默认明文

```ts
import {
  createClaudeCodeAuthService,
  createClaudeCodeProvider,
  ClaudeCodeAuthStore,
} from "@sparkle/claude-code";

const { authService, callbackServer } = createClaudeCodeAuthService({ config });
const provider = createClaudeCodeProvider({
  config: { baseUrl, keepAliveReplayIntervalMinutes, timeoutMs },
  authStore: new ClaudeCodeAuthStore({ claudeCodeAuthService: authService }),
});
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
