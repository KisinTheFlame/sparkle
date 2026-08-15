import { NOTE_SEARCH_SNIPPET_CHARS } from "../../capabilities/note/application/note.constants.js";
import type {
  NoteEntryRecord,
  NotePageRecord,
  NotePageSummary,
  NoteSearchHit,
} from "../../capabilities/note/application/note.dao.js";

/**
 * 把页清单渲染成 `<note_pages>` 屏幕文本，供 onFocus 的 append_message 与
 * list_pages 工具结果共用。页按最近更新倒序。
 */
export function renderNotePagesContent(pages: NotePageSummary[]): string {
  const lines: string[] = ["<note_pages>"];
  if (pages.length === 0) {
    lines.push("（还没有任何笔记页）");
  } else {
    for (const page of pages) {
      lines.push(`- ${page.title}（${page.entryCount} 条，更新于 ${formatDate(page.updatedAt)}）`);
    }
  }
  lines.push("</note_pages>");
  return lines.join("\n");
}

/** 把一页的条目渲染成 `<note_page>` 屏幕文本；分段读时标注可见区间。 */
export function renderNotePageContent(input: {
  page: NotePageRecord;
  entries: NoteEntryRecord[];
  total: number;
  offset: number;
}): string {
  const lines: string[] = [`<note_page title="${input.page.title}">`];
  if (input.entries.length === 0) {
    lines.push("（这一页还没有条目）");
  } else {
    for (const entry of input.entries) {
      lines.push(`[${formatDate(entry.createdAt)}] ${entry.content}`);
    }
    const shownUntil = input.offset + input.entries.length;
    if (input.offset > 0 || shownUntil < input.total) {
      lines.push(`（共 ${input.total} 条，当前显示第 ${input.offset + 1}–${shownUntil} 条）`);
    }
  }
  lines.push("</note_page>");
  return lines.join("\n");
}

/** 把搜索命中渲染成 `<note_search_results>` 屏幕文本，内容超长截断。 */
export function renderNoteSearchContent(query: string, hits: NoteSearchHit[]): string {
  const lines: string[] = [`<note_search_results query="${query}">`];
  if (hits.length === 0) {
    lines.push("（没有命中）");
  } else {
    for (const hit of hits) {
      lines.push(`- 《${hit.pageTitle}》[${formatDate(hit.createdAt)}] ${snippet(hit.content)}`);
    }
  }
  lines.push("</note_search_results>");
  return lines.join("\n");
}

function snippet(content: string): string {
  return content.length > NOTE_SEARCH_SNIPPET_CHARS
    ? `${content.slice(0, NOTE_SEARCH_SNIPPET_CHARS)}…`
    : content;
}

function formatDate(date: Date): string {
  const pad = (n: number): string => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}
