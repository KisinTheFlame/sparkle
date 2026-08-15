import { z } from "zod";
import { ZodToolComponent, type ToolExecutionResult, type ToolKind } from "@sparkle/agent-runtime";
import type { NoteService } from "../../../capabilities/note/application/note.service.js";
import { renderNotePageContent } from "../render-note.js";

const READ_PAGE_TOOL_NAME = "read_page";

const ReadPageArgumentsSchema = z.object({
  page: z.string().min(1),
  offset: z.number().int().nonnegative().optional(),
});

type Deps = {
  getNoteService: () => NoteService;
};

/** 读一页的条目（时间正序，单次 50 条，长页用 offset 续读）。 */
export class ReadPageTool extends ZodToolComponent<typeof ReadPageArgumentsSchema> {
  public readonly name = READ_PAGE_TOOL_NAME;
  public readonly description =
    "读某一页的笔记条目（时间正序，单次最多 50 条；长页传 offset 继续读）。page 传页标题。只能在 note App 里通过 invoke 调用。";
  public readonly parameters = {
    type: "object",
    properties: {
      page: { type: "string", description: "页标题。" },
      offset: { type: "number", description: "可选起始偏移（默认 0），长页续读用。" },
    },
    required: ["page"],
  } as const;
  public readonly kind: ToolKind = "business";
  protected readonly inputSchema = ReadPageArgumentsSchema;

  private readonly getNoteService: () => NoteService;

  public constructor({ getNoteService }: Deps) {
    super();
    this.getNoteService = getNoteService;
  }

  protected async executeTyped(
    input: z.infer<typeof ReadPageArgumentsSchema>,
  ): Promise<ToolExecutionResult> {
    const result = await this.getNoteService().readPage(input);
    if (!result.ok) {
      return {
        content: JSON.stringify({
          ok: false,
          error: result.error,
          message: "没有这一页。用 list_pages 看现有的页，或先 create_page 开一页。",
        }),
      };
    }
    return {
      content: renderNotePageContent({
        page: result.page,
        entries: result.entries,
        total: result.total,
        offset: input.offset ?? 0,
      }),
    };
  }
}
