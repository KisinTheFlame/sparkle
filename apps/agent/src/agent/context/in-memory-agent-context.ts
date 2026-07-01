import type { LlmMessage } from "@sparkle/llm";

/** context 的只读快照：每轮 buildRoundInput 拿它喂给 kernel。 */
export type AgentContextSnapshot = {
  readonly systemPrompt?: string;
  readonly messages: LlmMessage[];
};

/**
 * 主循环的对话上下文端口。v1 只有内存实现；未来的 Prisma ledger / 快照恢复
 * 实现同一接口替换即可（见 issue 的 Out of Scope）。
 */
export interface AgentContext {
  getSnapshot(): AgentContextSnapshot;
  appendUserMessage(content: string): void;
  appendMessages(messages: readonly LlmMessage[]): void;
}

/**
 * 纯内存上下文：systemPrompt 固定，messages 线性追加。重启即丢——持久化是
 * follow-up。getSnapshot 返回 messages 的拷贝，调用方拿到后再改不会污染内部状态。
 */
export class InMemoryAgentContext implements AgentContext {
  private readonly systemPrompt?: string;
  private readonly messages: LlmMessage[] = [];

  public constructor({ systemPrompt }: { systemPrompt?: string } = {}) {
    this.systemPrompt = systemPrompt;
  }

  public getSnapshot(): AgentContextSnapshot {
    return {
      systemPrompt: this.systemPrompt,
      messages: [...this.messages],
    };
  }

  public appendUserMessage(content: string): void {
    this.messages.push({ role: "user", content });
  }

  public appendMessages(messages: readonly LlmMessage[]): void {
    this.messages.push(...messages);
  }
}
