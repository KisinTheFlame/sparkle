import type { LlmClient } from "@sparkle/llm-client";
import type { ReActModel } from "@sparkle/agent-runtime";
import type { RootAgentCompletion, RootAgentUsage } from "../runtime/types.js";

/**
 * 把 `@sparkle/llm-client` 的 `LlmClient` 适配成 kernel 的 `ReActModel`。
 *
 * 二者形状本就对齐：`LlmClient.chat(request, { usage })` 的请求/响应与
 * `ReActModel.chat` 一致（`LlmChatResponsePayload.message` 即 assistant 消息）。
 * 这层薄封装只为把"主 agent 用 llm-client"这条边界显式化，并把 usage 透传。
 */
export function createAgentReActModel({
  llmClient,
}: {
  llmClient: LlmClient;
}): ReActModel<RootAgentUsage, RootAgentCompletion> {
  return {
    chat: (request, options) => llmClient.chat(request, { usage: options.usage }),
  };
}
