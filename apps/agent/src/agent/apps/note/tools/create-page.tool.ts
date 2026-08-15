import { z } from "zod";
import { ZodToolComponent, type ToolExecutionResult, type ToolKind } from "@sparkle/agent-runtime";
import type { NoteService } from "../../../capabilities/note/application/note.service.js";

const CREATE_PAGE_TOOL_NAME = "create_page";

const CreatePageArgumentsSchema = z.object({
  title: z.string().min(1),
});

type Deps = {
  getNoteService: () => NoteService;
};

/** 新开一个主题页。标题即索引，全局唯一。 */
export class CreatePageTool extends ZodToolComponent<typeof CreatePageArgumentsSchema> {
  public readonly name = CREATE_PAGE_TOOL_NAME;
  public readonly description =
    "新开一个笔记页。一页一个主题（一个人、一个项目、一类偏好），标题全局唯一、要短且一眼可辨。只能在 note App 里通过 invoke 调用。";
  public readonly parameters = {
    type: "object",
    properties: {
      title: { type: "string", description: "页标题（主题名），全局唯一，64 字以内。" },
    },
    required: ["title"],
  } as const;
  public readonly kind: ToolKind = "business";
  protected readonly inputSchema = CreatePageArgumentsSchema;

  private readonly getNoteService: () => NoteService;

  public constructor({ getNoteService }: Deps) {
    super();
    this.getNoteService = getNoteService;
  }

  protected async executeTyped(
    input: z.infer<typeof CreatePageArgumentsSchema>,
  ): Promise<ToolExecutionResult> {
    const result = await this.getNoteService().createPage(input);
    if (!result.ok) {
      return { content: JSON.stringify({ ok: false, error: result.error }) };
    }
    return { content: JSON.stringify({ ok: true, title: result.page.title }) };
  }
}
