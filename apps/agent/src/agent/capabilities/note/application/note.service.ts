import {
  NOTE_ENTRY_MAX_CHARS,
  NOTE_PAGE_TITLE_MAX_CHARS,
  NOTE_READ_PAGE_LIMIT,
  NOTE_SEARCH_LIMIT,
} from "./note.constants.js";
import type {
  NoteDao,
  NoteEntryRecord,
  NotePageRecord,
  NotePageSummary,
  NoteSearchHit,
} from "./note.dao.js";

export type CreatePageResult =
  | { ok: true; page: NotePageRecord }
  | { ok: false; error: "TITLE_EXISTS" | "TITLE_INVALID" };

export type AppendNoteResult =
  | { ok: true; entry: NoteEntryRecord }
  | { ok: false; error: "PAGE_NOT_FOUND" | "CONTENT_INVALID" };

export type ReadPageResult =
  | { ok: true; page: NotePageRecord; entries: NoteEntryRecord[]; total: number }
  | { ok: false; error: "PAGE_NOT_FOUND" };

type NoteServiceDeps = {
  noteDao: NoteDao;
};

/**
 * 工作笔记的业务层：页（主题）+ 页内追加条目 + 子串搜索。
 * 页与条目都以标题定位（标题唯一），Agent 不需要记内部 id。
 */
export class NoteService {
  private readonly noteDao: NoteDao;

  public constructor({ noteDao }: NoteServiceDeps) {
    this.noteDao = noteDao;
  }

  public async createPage(input: { title: string }): Promise<CreatePageResult> {
    const title = input.title.trim();
    if (title.length === 0 || title.length > NOTE_PAGE_TITLE_MAX_CHARS) {
      return { ok: false, error: "TITLE_INVALID" };
    }
    const created = await this.noteDao.createPage({ title });
    if (created === "TITLE_EXISTS") {
      return { ok: false, error: "TITLE_EXISTS" };
    }
    return { ok: true, page: created };
  }

  public async listPages(): Promise<NotePageSummary[]> {
    return this.noteDao.listPages();
  }

  public async appendNote(input: { page: string; content: string }): Promise<AppendNoteResult> {
    const content = input.content.trim();
    if (content.length === 0 || content.length > NOTE_ENTRY_MAX_CHARS) {
      return { ok: false, error: "CONTENT_INVALID" };
    }
    const page = await this.noteDao.findPageByTitle({ title: input.page.trim() });
    if (!page) {
      return { ok: false, error: "PAGE_NOT_FOUND" };
    }
    const entry = await this.noteDao.appendEntry({ pageId: page.id, content });
    return { ok: true, entry };
  }

  public async readPage(input: { page: string; offset?: number }): Promise<ReadPageResult> {
    const page = await this.noteDao.findPageByTitle({ title: input.page.trim() });
    if (!page) {
      return { ok: false, error: "PAGE_NOT_FOUND" };
    }
    const { entries, total } = await this.noteDao.listEntries({
      pageId: page.id,
      offset: input.offset ?? 0,
      limit: NOTE_READ_PAGE_LIMIT,
    });
    return { ok: true, page, entries, total };
  }

  public async search(input: { query: string }): Promise<NoteSearchHit[] | "QUERY_INVALID"> {
    const query = input.query.trim();
    if (query.length === 0) {
      return "QUERY_INVALID";
    }
    return this.noteDao.searchEntries({ query, limit: NOTE_SEARCH_LIMIT });
  }
}
