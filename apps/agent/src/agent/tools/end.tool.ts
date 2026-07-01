import { z } from "zod";
import {
  ZodToolComponent,
  type JsonSchema,
  type ToolExecutionResult,
  type ToolKind,
} from "@sparkle/agent-runtime";
import {
  WAIT_FOR_EVENT_EFFECT_TYPE,
  type WaitForEventEffect,
} from "../runtime/wait-for-event.handler.js";

export const END_TOOL_NAME = "End";

/**
 * End 无参数。刻意不用 `.strict()`：模型偶尔给无参工具塞个多余字段（如
 * `{reason:"done"}`），strict 会判非法 → 本轮不产 wait 效果。多余字段直接 strip
 * 掉即可，让 End 照常挂起。
 */
const EndInputSchema = z.object({});

/**
 * `End` 工具：结束本轮发言并挂起，等待下一个外部事件。语义与 kagami 的 `wait`
 * 完全一致，仅命名不同。它产一个 `wait_for_event` Effect，由
 * `WaitForEventHandler` 在 interpreter 阶段阻塞当前轮——这是主循环唯一的"暂停"
 * 机制。
 */
export class EndTool extends ZodToolComponent<typeof EndInputSchema> {
  public readonly name = END_TOOL_NAME;
  public readonly description =
    "结束本轮发言并挂起，等待下一个外部事件唤醒。当前无可继续推进的事时调用它。";
  public readonly kind: ToolKind = "control";
  public readonly parameters: JsonSchema = {
    type: "object",
    properties: {},
    additionalProperties: false,
  };
  protected readonly inputSchema = EndInputSchema;

  private readonly maxWaitMs: number;

  public constructor({ maxWaitMs }: { maxWaitMs: number }) {
    super();
    this.maxWaitMs = maxWaitMs;
  }

  protected executeTyped(): ToolExecutionResult {
    const effect: WaitForEventEffect = {
      type: WAIT_FOR_EVENT_EFFECT_TYPE,
      maxWaitMs: this.maxWaitMs,
    };
    // content 非空：维护 ReAct 协议（每个 tool_call 必有对应 tool_result）。
    // 真正的阻塞发生在 effect 被 interpreter 消费时，晚于这里返回。
    return { content: "结束发言，挂起等待下一个事件。", effects: [effect] };
  }
}
