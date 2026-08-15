import type {
  NoteDao,
  NoteEntryRecord,
  NotePageRecord,
  NotePageSummary,
  NoteSearchHit,
} from "../../src/agent/capabilities/note/application/note.dao.js";

/** NoteDao 的内存实现：语义对齐 PrismaNoteDao（唯一标题、更新页时间戳、子串搜索）。 */
export class InMemoryNoteDao implements NoteDao {
  private readonly pages: NotePageRecord[] = [];
  private readonly entries: NoteEntryRecord[] = [];
  private nextPageId = 1;
  private nextEntryId = 1;
  private now: () => Date;

  public constructor({ now }: { now?: () => Date } = {}) {
    this.now = now ?? (() => new Date());
  }

  public async createPage(input: { title: string }): Promise<NotePageRecord | "TITLE_EXISTS"> {
    if (this.pages.some(page => page.title === input.title)) {
      return "TITLE_EXISTS";
    }
    const timestamp = this.now();
    const page: NotePageRecord = {
      id: this.nextPageId++,
      title: input.title,
      createdAt: timestamp,
      updatedAt: timestamp,
    };
    this.pages.push(page);
    return page;
  }

  public async findPageByTitle(input: { title: string }): Promise<NotePageRecord | null> {
    return this.pages.find(page => page.title === input.title) ?? null;
  }

  public async listPages(): Promise<NotePageSummary[]> {
    return [...this.pages]
      .sort((a, b) => b.updatedAt.getTime() - a.updatedAt.getTime() || b.id - a.id)
      .map(page => ({
        ...page,
        entryCount: this.entries.filter(entry => entry.pageId === page.id).length,
      }));
  }

  public async appendEntry(input: { pageId: number; content: string }): Promise<NoteEntryRecord> {
    const page = this.pages.find(candidate => candidate.id === input.pageId);
    if (!page) {
      throw new Error(`page ${input.pageId} not found`);
    }
    const entry: NoteEntryRecord = {
      id: this.nextEntryId++,
      pageId: input.pageId,
      content: input.content,
      createdAt: this.now(),
    };
    this.entries.push(entry);
    page.updatedAt = this.now();
    return entry;
  }

  public async listEntries(input: {
    pageId: number;
    offset: number;
    limit: number;
  }): Promise<{ entries: NoteEntryRecord[]; total: number }> {
    const all = this.entries
      .filter(entry => entry.pageId === input.pageId)
      .sort((a, b) => a.id - b.id);
    return { entries: all.slice(input.offset, input.offset + input.limit), total: all.length };
  }

  public async searchEntries(input: { query: string; limit: number }): Promise<NoteSearchHit[]> {
    const titleById = new Map(this.pages.map(page => [page.id, page.title]));
    return this.entries
      .filter(entry => {
        const title = titleById.get(entry.pageId) ?? "";
        return entry.content.includes(input.query) || title.includes(input.query);
      })
      .sort((a, b) => b.id - a.id)
      .slice(0, input.limit)
      .map(entry => ({ ...entry, pageTitle: titleById.get(entry.pageId) ?? "" }));
  }
}
