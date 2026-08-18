import { z } from "zod";
import { ZodToolComponent, type ToolExecutionResult, type ToolKind } from "@sparkle/agent-runtime";

const LIST_CONVERSATIONS_TOOL_NAME = "list_conversations";

const ListConversationsArgumentsSchema = z.object({});

type Deps = {
  list: () => string;
};

/** 列出有过消息的会话（屏幕文本，含 chatId / 未读数）。 */
export class ListConversationsTool extends ZodToolComponent<
  typeof ListConversationsArgumentsSchema
> {
  public readonly name = LIST_CONVERSATIONS_TOOL_NAME;
  public readonly description =
    "列出有过消息的飞书会话（名字、未读数、chatId）。只能在 feishu App 里通过 invoke 调用。";
  public readonly parameters = {
    type: "object",
    properties: {},
  } as const;
  public readonly kind: ToolKind = "business";
  protected readonly inputSchema = ListConversationsArgumentsSchema;

  private readonly list: () => string;

  public constructor({ list }: Deps) {
    super();
    this.list = list;
  }

  protected async executeTyped(): Promise<ToolExecutionResult> {
    return { content: this.list() };
  }
}
