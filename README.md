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
  llm/           LLM 协议层类型 + provider 契约（@sparkle/llm，零依赖）
  agent-runtime/ ReAct kernel / 工具 / effect（@sparkle/agent-runtime）
  claude-code/   Claude Code LLM provider + OAuth 登录（@sparkle/claude-code）
  llm-client/    LLM 编排客户端：多 attempt 路由 / 重试 / 调用落库 / metric（@sparkle/llm-client）
  logger/        结构化日志：trace 上下文 + stdout/db sink（@sparkle/logger）
  config/        YAML + zod 配置加载（@sparkle/config）
  server-http/   HTTP 错误归一 + Fastify 路由助手（@sparkle/server-http）
  db/            Prisma + SQLite 持久化（@sparkle/db）
```

## 后端基础设施分包

复用自 kagami 的 `server-core`，但拆成小包按需组合：

- **@sparkle/logger** — `AppLogger` + AsyncLocalStorage trace 上下文 + `StdoutLogSink` / `DbLogSink`。`LogDao` 端口在此，Prisma 实现 `PrismaLogDao` 在 `@sparkle/db`。
- **@sparkle/llm-client** — 编排 `LlmProvider`（来自 `@sparkle/llm` 的契约）：按 usage 多 attempt 路由、重试、`onSettled` 观测、调用落库（`LlmChatCallDao` 端口 + `PrismaLlmChatCallDao` 实现）。`MetricService` 走端口 + `NoopMetricService`，完整 metric 模块留二期。
- **@sparkle/config** — sparkle 专属精简 schema（`server.{port,databaseUrl}` + `llm.{timeoutMs, claudeCodeAuth, providers.claudeCode, usages}`），保留 yaml + zod loader 机制。
- **@sparkle/server-http** — `toHttpErrorResponse` + `registerQueryRoute/ParamRoute/CommandRoute`。

依赖方向：`shared` ← `llm` ← {`claude-code`, `llm-client`, `config`}；`logger` ← `llm-client`；`db` 实现各领域包的 DAO 端口。

## @sparkle/db

Prisma 7（`prisma-client` generator，ESM）+ `better-sqlite3` driver adapter。库地址走
标准 `DATABASE_URL` 环境变量（默认 `file:./dev.db`）。内含 `PrismaOAuthDao`，实现
`@sparkle/claude-code` 的 `OAuthDao` 接口，替换默认的 `InMemoryOAuthDao`：

```ts
import { createDbClient, PrismaOAuthDao } from "@sparkle/db";
import { createClaudeCodeAuthService } from "@sparkle/claude-code";

const database = createDbClient({ databaseUrl: "file:./dev.db" });
const dao = new PrismaOAuthDao({ database, provider: "claude-code" });
const { authService } = createClaudeCodeAuthService({ config, dao });
```

```bash
# 生成 client（纯代码生成，不连库）
pnpm --filter @sparkle/db db:generate
# 迁移（默认 file:./dev.db，可用 DATABASE_URL 覆盖）
pnpm --filter @sparkle/db db:migrate:dev
DATABASE_URL="file:/abs/path/app.db" pnpm --filter @sparkle/db db:migrate:deploy
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
