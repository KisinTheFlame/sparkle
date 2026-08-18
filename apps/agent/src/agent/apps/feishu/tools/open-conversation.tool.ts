import { z } from "zod";
import { ZodToolComponent, type ToolExecutionResult, type ToolKind } from "@sparkle/agent-runtime";
import type { OpenConversationResult } from "../feishu.app.js";

const OPEN_CONVERSATION_TOOL_NAME = "open_conversation";

const OpenConversationArgumentsSchema = z.object({
  chatId: z.string().min(1),
});

type Deps = {
  open: (chatId: string) => OpenConversationResult;
};

/** 打开一个会话：看到最近消息，此后它就是"当前会话"（send_message 的目标、实时刷新的屏幕）。 */
export class OpenConversationTool extends ZodToolComponent<typeof OpenConversationArgumentsSchema> {
  public readonly name = OPEN_CONVERSATION_TOOL_NAME;
  public readonly description =
    "打开一个飞书会话（chatId 见 list_conversations），看到最近消息；打开后它就是当前会话，新消息实时刷进来，send_message 也发到这里。只能在 feishu App 里通过 invoke 调用。";
  public readonly parameters = {
    type: "object",
    properties: {
      chatId: { type: "string", description: "会话 id（oc_ 开头），见 list_conversations。" },
    },
    required: ["chatId"],
  } as const;
  public readonly kind: ToolKind = "business";
  protected readonly inputSchema = OpenConversationArgumentsSchema;

  private readonly open: (chatId: string) => OpenConversationResult;

  public constructor({ open }: Deps) {
    super();
    this.open = open;
  }

  protected async executeTyped(
    input: z.infer<typeof OpenConversationArgumentsSchema>,
  ): Promise<ToolExecutionResult> {
    const result = this.open(input.chatId);
    if (!result.ok) {
      return {
        content: JSON.stringify({
          ok: false,
          error: result.error,
          message: "没有这个会话。用 list_conversations 看现有会话与 chatId。",
        }),
      };
    }
    return { content: result.content };
  }
}
