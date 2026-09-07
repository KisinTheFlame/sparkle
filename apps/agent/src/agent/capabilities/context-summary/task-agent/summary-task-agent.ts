import type { AgentLlmClient } from "../../../runtime/llm-client.js";
import { BaseTaskAgent, type TaskAgentInvoker, type ToolExecutor } from "@sparkle/agent-runtime";
import type { LlmMessage } from "@sparkle/llm-client";

export type SummaryTaskInput = {
  systemPrompt: string;
  /** 喂给 LLM 做摘要的消息（被压缩的那一段，即 context 的前缀）。 */
  messages: LlmMessage[];
};

/**
 * 上下文摘要 task agent。
 *
 * 输入：主 Agent system prompt + 被摘要的消息前缀。
 * 输出：累计上下文摘要字符串；替换语义（replace_leading_messages 的 count /
 * replacement 拼装）由调用方（RootLoopAgent.attemptSummarize）负责。
 *
 * 关键设计：复用主 Agent 的 tools / system /
 * 消息前缀（字节相等），命中 Anthropic prompt cache。隔离手段是顶层工具集中
 * 除 invoke 之外全部走 OutOfScopeTool 软拒绝，invoke 只挂 finalize_summary
 * 终止子工具。
 *
 * 终止条件：LLM 调用 invoke({tool:"finalize_summary", summary:...})，产
 * `terminate` Effect 退出循环；跑满 maxRounds 仍未终止则抛
 * TaskAgentMaxRoundsExceededError，调用方降级为本次不压缩。
 */
export class SummaryTaskAgent
  extends BaseTaskAgent<SummaryTaskInput, string, "agent">
  implements TaskAgentInvoker<SummaryTaskInput, string>
{
  private readonly reminderMessageFactory: () => Extract<LlmMessage, { role: "user" }>;

  public constructor({
    llmClient,
    taskTools,
    reminderMessageFactory,
  }: {
    llmClient: AgentLlmClient;
    taskTools: ToolExecutor;
    reminderMessageFactory: () => Extract<LlmMessage, { role: "user" }>;
  }) {
    super({
      model: llmClient,
      taskTools,
      // required 要求工具调用，但模型仍可能选错工具或异常返回纯文本；保留重试余量。
      maxRounds: 4,
    });
    this.reminderMessageFactory = reminderMessageFactory;
  }

  protected async createInvocation(input: SummaryTaskInput): Promise<{
    systemPrompt: string;
    messages: LlmMessage[];
    usage: "agent";
    scene: string;
  }> {
    const systemPrompt = input.systemPrompt.trim();
    if (systemPrompt.length === 0) {
      throw new Error("SummaryTaskAgent requires a non-empty systemPrompt");
    }

    return {
      systemPrompt,
      messages: [...input.messages, this.reminderMessageFactory()],
      // usage=agent：复用主 Agent 前缀命中 prompt cache。scene 保留原归因标签。
      usage: "agent",
      scene: "contextSummarizer",
    };
  }

  protected buildResult({
    content,
  }: {
    input: SummaryTaskInput;
    messages: LlmMessage[];
    content: string;
  }): string {
    const summary = content.trim();
    if (summary.length === 0) {
      throw new Error("SummaryTaskAgent returned an empty summary");
    }

    return summary;
  }
}
