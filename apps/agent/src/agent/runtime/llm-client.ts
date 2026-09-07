import { randomUUID } from "node:crypto";
import type { Config } from "@sparkle/kernel/config/config.loader";
import type { LlmUsageId } from "@sparkle/kernel/contracts/llm";
import type { LlmProviderOption } from "@sparkle/llm-api/llm-chat";
import type { LlmChatRequest, LlmChatResponsePayload, LlmClient } from "@sparkle/llm-client";

type AgentLlmChatOptions = {
  /** KV 缓存身份；主 Agent 与镜像摘要必须复用 agent。 */
  usage: LlmUsageId;
  /** 仅用于调用归因，不影响模型或请求前缀。 */
  scene: string;
  recordCall?: boolean;
};

export interface AgentLlmClient {
  chat(request: LlmChatRequest, options: AgentLlmChatOptions): Promise<LlmChatResponsePayload>;
  listAvailableProviders(options: { usage: LlmUsageId }): Promise<LlmProviderOption[]>;
}

/** 调用方策略：在一个 Module 内解析 usage、注入 thinking、执行有序尝试并关联观测记录。 */
export function createAgentLlmClient({
  gateway,
  usages,
}: {
  gateway: LlmClient;
  usages: Config["server"]["agent"]["usages"];
}): AgentLlmClient {
  const requireUsageConfig = (usage: LlmUsageId) => {
    if (!usage) throw new Error("AgentLlmClient requires an explicit usage");
    const config = usages[usage];
    if (!config) throw new Error(`AgentLlmClient usage is not configured: ${usage}`);
    return config;
  };

  return {
    async chat(request, options) {
      const usageConfig = requireUsageConfig(options?.usage);
      const scene = options?.scene?.trim() ?? "";
      if (!scene) throw new Error("AgentLlmClient.chat requires an explicit non-empty scene");
      const requestId = randomUUID();
      // 保留旧策略：有配置时覆盖 request.thinking，缺省时透传；不改历史消息或工具定义。
      const requestForUsage = usageConfig.thinking
        ? { ...request, thinking: usageConfig.thinking }
        : request;
      let lastError: unknown;
      let seq = 0;
      for (const attempt of usageConfig.attempts) {
        for (let currentTry = 0; currentTry < attempt.times; currentTry += 1) {
          try {
            return await gateway.chatDirect(requestForUsage, {
              providerId: attempt.provider,
              model: attempt.model,
              ...(options.recordCall === undefined ? {} : { recordCall: options.recordCall }),
              trace: { requestId, seq: ++seq, usage: options.usage, scene },
            });
          } catch (error) {
            lastError = error;
          }
        }
      }
      throw lastError;
    },
    async listAvailableProviders(options) {
      const preferredProvider = requireUsageConfig(options?.usage).attempts[0]?.provider;
      const providers = await gateway.listAvailableProviders();
      return [...providers].sort((left, right) => {
        if (left.id === right.id) return 0;
        if (left.id === preferredProvider) return -1;
        if (right.id === preferredProvider) return 1;
        return left.id.localeCompare(right.id);
      });
    },
  };
}
