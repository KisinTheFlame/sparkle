import { z } from "zod";
import {
  ZodToolComponent,
  type JsonSchema,
  type ToolExecutionResult,
  type ToolKind,
} from "@sparkle/agent-runtime";

export const END_TOOL_NAME = "End";

/**
 * End 无参数。刻意不用 `.strict()`：模型偶尔给无参工具塞个多余字段（如
 * `{reason:"done"}`），strict 会判非法。多余字段直接 strip 掉即可。
 */
const EndInputSchema = z.object({});

/**
 * `End` 工具：结束本轮发言。toolChoice="required" 下模型每轮必调一个工具；v1 只有
 * End。它**不产任何 effect、不在工具内阻塞**——本轮照常 commit（助手回复立即写进
 * context、可被 `GET /agent/transcript` 看到），"挂起等下一个事件"由 loop 的
 * `runOnce` 在 commit 之后负责（无未处理输入就 block 在事件 Queue 上）。
 *
 * 为什么不在工具内阻塞：kernel 在一轮内是 `model → 执行工具 → 解释 effect → 返回
 * → commit`。若在 effect 解释阶段阻塞，会把 commit 推迟到下一个事件到来，导致单条
 * 消息发出后 transcript 迟迟看不到回复（表现为"卡住"）。把挂起点放到 commit 之后
 * 的 runOnce 里，就没有这个问题。
 */
export class EndTool extends ZodToolComponent<typeof EndInputSchema> {
  public readonly name = END_TOOL_NAME;
  public readonly description =
    "结束本轮发言。当前无可继续推进的事时调用它；本轮结束后 loop 会挂起等待下一个事件。";
  public readonly kind: ToolKind = "control";
  public readonly parameters: JsonSchema = {
    type: "object",
    properties: {},
    additionalProperties: false,
  };
  protected readonly inputSchema = EndInputSchema;

  protected executeTyped(): ToolExecutionResult {
    // content 非空：维护 ReAct 协议（每个 tool_call 必有对应 tool_result）。
    return { content: "结束发言，等待下一个事件。" };
  }
}
