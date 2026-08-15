/** 页标题长度上限：标题是 list_pages 一屏扫过的索引，必须短。 */
export const NOTE_PAGE_TITLE_MAX_CHARS = 64;
/** 单条笔记长度上限：笔记是提炼后的结论，不是原始素材堆放处。 */
export const NOTE_ENTRY_MAX_CHARS = 2000;
/** read_page 单次返回的条目数上限（可用 offset 继续翻）。 */
export const NOTE_READ_PAGE_LIMIT = 50;
/** search_notes 返回命中数上限。 */
export const NOTE_SEARCH_LIMIT = 20;
/** 搜索命中内容进上下文的截断长度（超出以 … 结尾）。 */
export const NOTE_SEARCH_SNIPPET_CHARS = 200;
