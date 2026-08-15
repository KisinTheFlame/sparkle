import { z } from "zod";
import { ZodToolComponent, type ToolExecutionResult, type ToolKind } from "@sparkle/agent-runtime";
import type { NoteService } from "../../../capabilities/note/application/note.service.js";

const APPEND_NOTE_TOOL_NAME = "append_note";

const AppendNoteArgumentsSchema = z.object({
  page: z.string().min(1),
  content: z.string().min(1),
});

type Deps = {
  getNoteService: () => NoteService;
};

/** 往某页追加一条笔记。纯追加：改结论就再记一条，不改写历史。 */
export class AppendNoteTool extends ZodToolComponent<typeof AppendNoteArgumentsSchema> {
  public readonly name = APPEND_NOTE_TOOL_NAME;
  public readonly description =
    "往某个笔记页追加一条笔记（2000 字以内，写提炼后的结论而非原始素材）。纯追加：结论变了就再记一条，不改写旧条目。page 传页标题。只能在 note App 里通过 invoke 调用。";
  public readonly parameters = {
    type: "object",
    properties: {
      page: { type: "string", description: "页标题（须已存在，先 create_page）。" },
      content: { type: "string", description: "笔记内容，2000 字以内。" },
    },
    required: ["page", "content"],
  } as const;
  public readonly kind: ToolKind = "business";
  protected readonly inputSchema = AppendNoteArgumentsSchema;

  private readonly getNoteService: () => NoteService;

  public constructor({ getNoteService }: Deps) {
    super();
    this.getNoteService = getNoteService;
  }

  protected async executeTyped(
    input: z.infer<typeof AppendNoteArgumentsSchema>,
  ): Promise<ToolExecutionResult> {
    const result = await this.getNoteService().appendNote(input);
    if (!result.ok) {
      const message =
        result.error === "PAGE_NOT_FOUND"
          ? "没有这一页。用 list_pages 看现有的页，或先 create_page 开一页。"
          : "内容为空或超过 2000 字。";
      return { content: JSON.stringify({ ok: false, error: result.error, message }) };
    }
    return { content: JSON.stringify({ ok: true, id: result.entry.id }) };
  }
}
