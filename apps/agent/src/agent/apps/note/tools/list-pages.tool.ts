import { z } from "zod";
import { ZodToolComponent, type ToolExecutionResult, type ToolKind } from "@sparkle/agent-runtime";
import type { NoteService } from "../../../capabilities/note/application/note.service.js";
import { renderNotePagesContent } from "../render-note.js";

const LIST_PAGES_TOOL_NAME = "list_pages";

const ListPagesArgumentsSchema = z.object({});

type Deps = {
  getNoteService: () => NoteService;
};

/** 列出全部笔记页（按最近更新倒序，带条目数）。 */
export class ListPagesTool extends ZodToolComponent<typeof ListPagesArgumentsSchema> {
  public readonly name = LIST_PAGES_TOOL_NAME;
  public readonly description =
    "列出所有笔记页（按最近更新倒序，带条目数）。只能在 note App 里通过 invoke 调用。";
  public readonly parameters = {
    type: "object",
    properties: {},
  } as const;
  public readonly kind: ToolKind = "business";
  protected readonly inputSchema = ListPagesArgumentsSchema;

  private readonly getNoteService: () => NoteService;

  public constructor({ getNoteService }: Deps) {
    super();
    this.getNoteService = getNoteService;
  }

  protected async executeTyped(): Promise<ToolExecutionResult> {
    const pages = await this.getNoteService().listPages();
    return { content: renderNotePagesContent(pages) };
  }
}
