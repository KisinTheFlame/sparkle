export type NotePageRecord = {
  id: number;
  title: string;
  createdAt: Date;
  updatedAt: Date;
};

export type NotePageSummary = NotePageRecord & {
  entryCount: number;
};

export type NoteEntryRecord = {
  id: number;
  pageId: number;
  content: string;
  createdAt: Date;
};

/** 搜索命中：条目 + 所属页标题（供直接定位到页）。 */
export type NoteSearchHit = NoteEntryRecord & {
  pageTitle: string;
};

/**
 * 工作笔记的持久化 port。条目纯追加：没有 update / delete——记忆的修正靠追加新条目
 * 覆盖旧结论，不改写历史（与 ledger 同一哲学，也是 KV 友好的显式记忆模型）。
 */
export type NoteDao = {
  createPage(input: { title: string }): Promise<NotePageRecord | "TITLE_EXISTS">;
  findPageByTitle(input: { title: string }): Promise<NotePageRecord | null>;
  /** 按最近更新倒序列出所有页（带条目数）。 */
  listPages(): Promise<NotePageSummary[]>;
  /** 追加条目并顺带把页的 updatedAt 提到当前。页不存在返回 null。 */
  appendEntry(input: { pageId: number; content: string }): Promise<NoteEntryRecord>;
  /** 按时间正序读一页的条目；offset/limit 支持长页分段读。 */
  listEntries(input: {
    pageId: number;
    offset: number;
    limit: number;
  }): Promise<{ entries: NoteEntryRecord[]; total: number }>;
  /** 子串搜索条目内容与页标题（大小写不敏感由实现决定），按条目新旧倒序，封顶 limit。 */
  searchEntries(input: { query: string; limit: number }): Promise<NoteSearchHit[]>;
};
