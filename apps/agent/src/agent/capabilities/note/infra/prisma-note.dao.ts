import type { Database } from "@sparkle/persistence/db/client";
import type {
  NoteDao,
  NoteEntryRecord,
  NotePageRecord,
  NotePageSummary,
  NoteSearchHit,
} from "../application/note.dao.js";

export class PrismaNoteDao implements NoteDao {
  private readonly database: Database;

  public constructor({ database }: { database: Database }) {
    this.database = database;
  }

  public async createPage(input: { title: string }): Promise<NotePageRecord | "TITLE_EXISTS"> {
    // 以唯一索引为准（而非先查后插）：并发建同名页时数据库兜底。
    try {
      const row = await this.database.notePage.create({ data: { title: input.title } });
      return mapPage(row);
    } catch (error) {
      if (isUniqueViolation(error)) {
        return "TITLE_EXISTS";
      }
      throw error;
    }
  }

  public async findPageByTitle(input: { title: string }): Promise<NotePageRecord | null> {
    const row = await this.database.notePage.findUnique({ where: { title: input.title } });
    return row ? mapPage(row) : null;
  }

  public async listPages(): Promise<NotePageSummary[]> {
    const rows = await this.database.notePage.findMany({
      orderBy: [{ updatedAt: "desc" }, { id: "desc" }],
      include: { _count: { select: { entries: true } } },
    });
    return rows.map(row => ({ ...mapPage(row), entryCount: row._count.entries }));
  }

  public async appendEntry(input: { pageId: number; content: string }): Promise<NoteEntryRecord> {
    // 追加条目 + 提升页的 updatedAt 放一个事务，保证 list_pages 的最近更新排序与内容一致。
    const [entry] = await this.database.$transaction([
      this.database.noteEntry.create({
        data: { pageId: input.pageId, content: input.content },
      }),
      this.database.notePage.update({
        where: { id: input.pageId },
        data: { updatedAt: new Date() },
      }),
    ]);
    return mapEntry(entry);
  }

  public async listEntries(input: {
    pageId: number;
    offset: number;
    limit: number;
  }): Promise<{ entries: NoteEntryRecord[]; total: number }> {
    const [rows, total] = await Promise.all([
      this.database.noteEntry.findMany({
        where: { pageId: input.pageId },
        orderBy: { id: "asc" },
        skip: input.offset,
        take: input.limit,
      }),
      this.database.noteEntry.count({ where: { pageId: input.pageId } }),
    ]);
    return { entries: rows.map(mapEntry), total };
  }

  public async searchEntries(input: { query: string; limit: number }): Promise<NoteSearchHit[]> {
    // 子串搜索：条目内容或所属页标题命中都算。个人笔记规模（数千条内）LIKE 全扫足够快，
    // 且对中文任意长度查询都准确；数据量大了再升级 FTS（见 docs/adr/0001）。
    const rows = await this.database.noteEntry.findMany({
      where: {
        OR: [
          { content: { contains: input.query } },
          { page: { title: { contains: input.query } } },
        ],
      },
      orderBy: { id: "desc" },
      take: input.limit,
      include: { page: { select: { title: true } } },
    });
    return rows.map(row => ({ ...mapEntry(row), pageTitle: row.page.title }));
  }
}

function isUniqueViolation(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as { code?: unknown }).code === "P2002"
  );
}

function mapPage(row: {
  id: number;
  title: string;
  createdAt: Date;
  updatedAt: Date;
}): NotePageRecord {
  return { id: row.id, title: row.title, createdAt: row.createdAt, updatedAt: row.updatedAt };
}

function mapEntry(row: {
  id: number;
  pageId: number;
  content: string;
  createdAt: Date;
}): NoteEntryRecord {
  return { id: row.id, pageId: row.pageId, content: row.content, createdAt: row.createdAt };
}
