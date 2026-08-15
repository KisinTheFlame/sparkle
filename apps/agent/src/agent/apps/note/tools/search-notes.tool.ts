import { z } from "zod";
import { ZodToolComponent, type ToolExecutionResult, type ToolKind } from "@sparkle/agent-runtime";
import type { NoteService } from "../../../capabilities/note/application/note.service.js";
import { renderNoteSearchContent } from "../render-note.js";

const SEARCH_NOTES_TOOL_NAME = "search_notes";

const SearchNotesArgumentsSchema = z.object({
  query: z.string().min(1),
});

type Deps = {
  getNoteService: () => NoteService;
};

/** 全文搜索：条目内容或页标题命中都算，按新旧倒序、封顶 20 条。 */
export class SearchNotesTool extends ZodToolComponent<typeof SearchNotesArgumentsSchema> {
  public readonly name = SEARCH_NOTES_TOOL_NAME;
  public readonly description =
    "在全部笔记里按关键词搜索（条目内容或页标题命中都算），返回最新的至多 20 条命中。只能在 note App 里通过 invoke 调用。";
  public readonly parameters = {
    type: "object",
    properties: {
      query: { type: "string", description: "搜索关键词（子串匹配）。" },
    },
    required: ["query"],
  } as const;
  public readonly kind: ToolKind = "business";
  protected readonly inputSchema = SearchNotesArgumentsSchema;

  private readonly getNoteService: () => NoteService;

  public constructor({ getNoteService }: Deps) {
    super();
    this.getNoteService = getNoteService;
  }

  protected async executeTyped(
    input: z.infer<typeof SearchNotesArgumentsSchema>,
  ): Promise<ToolExecutionResult> {
    const hits = await this.getNoteService().search(input);
    if (hits === "QUERY_INVALID") {
      return { content: JSON.stringify({ ok: false, error: "QUERY_INVALID" }) };
    }
    return { content: renderNoteSearchContent(input.query.trim(), hits) };
  }
}
