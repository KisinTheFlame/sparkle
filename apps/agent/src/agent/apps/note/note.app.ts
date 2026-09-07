import type { App } from "@sparkle/agent-runtime";
import { renderServerStaticTemplate } from "@sparkle/kernel/runtime/read-static-text";
import type { NoteService } from "../../capabilities/note/application/note.service.js";
import type { RootAgentEffect } from "../../runtime/effect/root-agent-effect.js";
import { renderNotePagesContent } from "./render-note.js";
import { AppendNoteTool } from "./tools/append-note.tool.js";
import { CreatePageTool } from "./tools/create-page.tool.js";
import { ListPagesTool } from "./tools/list-pages.tool.js";
import { ReadPageTool } from "./tools/read-page.tool.js";
import { SearchNotesTool } from "./tools/search-notes.tool.js";

const NOTE_APP_ID = "note";

type NoteAppDeps = {
  noteService: NoteService;
};

/**
 * 笔记 App。Sparkle 自维护的长期记忆：页 = 主题（一个人、一个项目、一类偏好），
 * 页内条目纯追加、不改不删；记什么、开什么页由 Sparkle 自己决定（见 docs/adr/0001）。
 *
 * - 工具：create_page / list_pages / read_page / append_note / search_notes
 * - mutation 工具返回一行紧凑确认；读类工具回屏幕文本（守 context-growth 红线）
 * - onFocus 列一次页清单（有界：只有标题行）
 */
export class NoteApp implements App {
  public readonly id = NOTE_APP_ID;
  public readonly displayName = "笔记";
  public readonly description = "自己维护的工作笔记：按主题开页、页内追加、全文搜索。";
  public readonly tools: readonly [
    CreatePageTool,
    ListPagesTool,
    ReadPageTool,
    AppendNoteTool,
    SearchNotesTool,
  ];

  private readonly noteService: NoteService;

  public constructor({ noteService }: NoteAppDeps) {
    this.noteService = noteService;
    const getNoteService = (): NoteService => this.noteService;
    this.tools = [
      new CreatePageTool({ getNoteService }),
      new ListPagesTool({ getNoteService }),
      new ReadPageTool({ getNoteService }),
      new AppendNoteTool({ getNoteService }),
      new SearchNotesTool({ getNoteService }),
    ];
  }

  public canInvoke(): boolean {
    return true;
  }

  public async help(): Promise<string> {
    return renderServerStaticTemplate(import.meta.url, "prompts/note-app-help.hbs");
  }

  /** 进入 App 时列一次页清单，作为 append_message Effect 追加到上下文尾部。 */
  public async onFocus(): Promise<readonly RootAgentEffect[]> {
    const pages = await this.noteService.listPages();
    return [{ type: "append_message", content: renderNotePagesContent(pages) }];
  }
}
