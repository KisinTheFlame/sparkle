import type { LlmMessage, LlmUsageId } from "@sparkle/llm";
import type { AssistantLikeMessage } from "@sparkle/agent-runtime";

/** 主循环的 LLM 用途标识。AI 员工目前只有主 agent 一个用途。 */
export type RootAgentUsage = LlmUsageId;

/**
 * 主循环的 kernel completion 形状。等价于 ReActKernel 的默认 completion
 * （`{ message: <assistant 消息> }`）——这里显式命名一份，给 BaseLoopAgent /
 * ReActKernel / 模型适配三处共用同一个类型参数。
 */
export type RootAgentCompletion = {
  message: Extract<LlmMessage, { role: "assistant" }> & AssistantLikeMessage;
};

/**
 * 主循环依赖的最小日志端口。`@sparkle/logger` 的 `AppLogger` 结构上满足它，
 * 但 agent 核心只依赖这两个方法——这样单测可注入一个 spy，不必初始化 logger
 * runtime，agent 核心也不硬依赖 `@sparkle/logger`。
 */
export interface AgentLogger {
  info(message: string, fields?: Record<string, unknown>): void;
  errorWithCause(message: string, error: unknown, fields?: Record<string, unknown>): void;
}
