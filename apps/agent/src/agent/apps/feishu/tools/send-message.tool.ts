import { z } from "zod";
import { ZodToolComponent, type ToolExecutionResult, type ToolKind } from "@sparkle/agent-runtime";
import type { SendMessageResult } from "../feishu.app.js";

const SEND_MESSAGE_TOOL_NAME = "send_message";

const SendMessageArgumentsSchema = z.object({
  message: z.string().min(1),
});

type Deps = {
  send: (text: string) => Promise<SendMessageResult>;
};

/** 在当前会话里发一条文本消息（先 open_conversation）。 */
export class SendMessageTool extends ZodToolComponent<typeof SendMessageArgumentsSchema> {
  public readonly name = SEND_MESSAGE_TOOL_NAME;
  public readonly description =
    "在当前打开的飞书会话里发一条文本消息（先用 open_conversation 打开会话）。只能在 feishu App 里通过 invoke 调用。";
  public readonly parameters = {
    type: "object",
    properties: {
      message: { type: "string", description: "要发送的文本。" },
    },
    required: ["message"],
  } as const;
  public readonly kind: ToolKind = "business";
  protected readonly inputSchema = SendMessageArgumentsSchema;

  private readonly send: (text: string) => Promise<SendMessageResult>;

  public constructor({ send }: Deps) {
    super();
    this.send = send;
  }

  protected async executeTyped(
    input: z.infer<typeof SendMessageArgumentsSchema>,
  ): Promise<ToolExecutionResult> {
    const message = input.message.trim();
    if (message.length === 0) {
      return { content: JSON.stringify({ ok: false, error: "EMPTY_MESSAGE" }) };
    }
    const result = await this.send(message);
    if (!result.ok) {
      return {
        content: JSON.stringify({
          ok: false,
          error: result.error,
          message: "当前没有打开的会话，先用 open_conversation 打开一个会话再发。",
        }),
      };
    }
    return { content: JSON.stringify({ ok: true, messageId: result.messageId }) };
  }
}
