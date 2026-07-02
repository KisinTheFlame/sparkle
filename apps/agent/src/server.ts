import Fastify, { type FastifyInstance } from "fastify";
import { z } from "zod";
import { createHealthResponse } from "@sparkle/shared/utils";
import { toHttpErrorResponse } from "@sparkle/server-http";
import { AppLogger } from "@sparkle/logger";
import type { Config } from "@sparkle/config";
import {
  createDbClient,
  closeDb,
  PrismaLlmChatCallDao,
  PrismaOAuthDao,
  type Database,
} from "@sparkle/db";
import {
  ClaudeCodeAuthStore,
  createClaudeCodeAuthService,
  createClaudeCodeProvider,
  type ClaudeCodeAuthModule,
} from "@sparkle/claude-code";
import { createLlmClient, NoopMetricService, type LlmClient } from "@sparkle/llm-client";
import { InMemoryQueue, NoopEffectInterpreter, ToolCatalog } from "@sparkle/agent-runtime";
import type { AgentEvent } from "./agent/events/event.js";
import { InMemoryAgentContext } from "./agent/context/in-memory-agent-context.js";
import { EndTool, END_TOOL_NAME } from "./agent/tools/end.tool.js";
import { createAgentReActModel } from "./agent/model/llm-client-react-model.js";
import { renderMainSystemPrompt } from "./agent/system-prompt/render.js";
import { RootLoopAgent } from "./agent/runtime/root-loop-agent.js";
import { registerAgentRoutes } from "./agent/http/agent-routes.js";

const SERVICE_NAME = "agent";

export type AgentServer = {
  app: FastifyInstance;
  callbackServer: ClaudeCodeAuthModule["callbackServer"];
  llmClient: LlmClient;
  database: Database;
  rootAgent: RootLoopAgent;
  close(): Promise<void>;
};

const ChatRequestSchema = z.object({
  system: z.string().optional(),
  message: z.string().min(1),
});

/**
 * Agent 后端的组装根：把 config / logger / db / claude-code OAuth / provider / llm-client
 * 装配成一个可监听的 Fastify 实例。注意这是 sparkle 自己的 composition root——只装配
 * 复用自 kagami 的基础设施零件，AI 员工的 agent 主循环另行在其上构建。
 */
export function buildAgentServer({ config }: { config: Config }): AgentServer {
  const logger = new AppLogger({ source: "agent.server" });
  const database = createDbClient({ databaseUrl: config.server.databaseUrl });

  const claudeCodeAuthConfig = config.server.llm.claudeCodeAuth;
  const { authService, callbackServer } = createClaudeCodeAuthService({
    config: {
      enabled: claudeCodeAuthConfig.enabled,
      publicBaseUrl: claudeCodeAuthConfig.publicBaseUrl,
      oauthRedirectPath: claudeCodeAuthConfig.oauthRedirectPath,
      oauthStateTtlMs: claudeCodeAuthConfig.oauthStateTtlMs,
      refreshLeewayMs: claudeCodeAuthConfig.refreshLeewayMs,
      timeoutMs: config.server.llm.timeoutMs,
    },
    dao: new PrismaOAuthDao<"claude-code">({ database }),
  });

  const claudeCodeProviderConfig = config.server.llm.providers.claudeCode;
  const provider = createClaudeCodeProvider({
    config: {
      baseUrl: claudeCodeProviderConfig.baseUrl,
      keepAliveReplayIntervalMinutes: claudeCodeProviderConfig.keepAliveReplayIntervalMinutes,
      timeoutMs: config.server.llm.timeoutMs,
    },
    authStore: new ClaudeCodeAuthStore({ claudeCodeAuthService: authService }),
    logger,
  });

  const llmClient = createLlmClient({
    llmChatCallDao: new PrismaLlmChatCallDao({ database }),
    metricService: new NoopMetricService(),
    providers: { "claude-code": provider },
    providerConfigs: { "claude-code": { models: claudeCodeProviderConfig.models } },
    usages: config.server.llm.usages,
  });

  // ── agent 主循环组装 ──────────────────────────────────────────────
  // 单一全局常驻 agent：事件 Queue 是输入 seam（本轮由 debug 端点喂，未来接飞书），
  // 内存 context 存对话，End 工具是唯一工具（结束发言，挂起由 loop 负责）。
  // v1 工具不产 effect，用 NoopEffectInterpreter（收到 effect 会抛错，明确"无 effect"）。
  const agentEventQueue = new InMemoryQueue<AgentEvent>();
  const agentContext = new InMemoryAgentContext({ systemPrompt: renderMainSystemPrompt() });
  const agentTools = new ToolCatalog([new EndTool()]).pick([END_TOOL_NAME]);
  const rootAgent = new RootLoopAgent({
    model: createAgentReActModel({ llmClient }),
    interpreter: new NoopEffectInterpreter(),
    context: agentContext,
    queue: agentEventQueue,
    tools: agentTools,
    logger,
  });

  const app = Fastify();

  app.setErrorHandler((error, request, reply) => {
    const { statusCode, body } = toHttpErrorResponse(error);
    logger.errorWithCause("request failed", error, {
      event: "http.request_failed",
      method: request.method,
      url: request.url,
      statusCode,
    });
    void reply.code(statusCode).send(body);
  });

  app.get("/health", () => createHealthResponse(SERVICE_NAME));

  // Claude Code OAuth 管理
  app.get("/auth/claude-code/status", () => authService.getStatus());
  app.post("/auth/claude-code/login", () => authService.createLoginUrl());
  app.post("/auth/claude-code/logout", () => authService.logout());
  app.post("/auth/claude-code/refresh", () => authService.refresh());

  // 最小聊天端点：验证 provider + llm-client 已接通（需先完成 claude-code 登录）。
  app.post("/llm/chat", async request => {
    const { system, message } = ChatRequestSchema.parse(request.body);
    const response = await llmClient.chat(
      {
        ...(system ? { system } : {}),
        messages: [{ role: "user", content: message }],
        tools: [],
        toolChoice: "auto",
      },
      { usage: "agent" },
    );
    return { reply: response.message.content, model: response.model };
  });

  // 主循环 HTTP：POST /agent/event（投递事件唤醒 loop，debug 注入口，未来接飞书）、
  // GET /agent/transcript（读内存对话验证 loop 真的转了）。
  registerAgentRoutes(app, { queue: agentEventQueue, context: agentContext });

  const close = async (): Promise<void> => {
    await rootAgent.stop();
    await app.close();
    await callbackServer.stop();
    await provider.close?.();
    await closeDb(database);
  };

  return { app, callbackServer, llmClient, database, rootAgent, close };
}
