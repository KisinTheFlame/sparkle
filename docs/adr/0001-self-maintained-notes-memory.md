# 长期记忆走自维护笔记，不做自动检索注入

Sparkle 的长期记忆采用她自己显式维护的多页主题笔记（note App：页 = 主题，页内条目纯追加，工具为 create_page / list_pages / read_page / append_note / search_notes），而不是基于 embedding 的自动召回注入（RAG）。理由：自动召回的内容需要注入到上下文的某个位置，任何"按相关性动态插入"的机制都会威胁稳定前缀、破坏 KV 缓存命中；而显式工具调用天然走尾部追加，记什么、翻什么由 Agent 自己决断，也让记忆内容始终可审。`ledger` 消息账本保持只写不读，作为将来任何记忆演进的原始素材。

## Considered Options

- **embedding 检索自动注入（RAG）**：召回质量依赖切块与相似度调参，注入位置与稳定前缀冲突，且召回行为不可审计。拒绝。
- **不做长期记忆，只靠上下文压缩摘要**：摘要会随每次压缩有损衰减，"雇主偏好、承诺过的事"这类必须精确保留的事实没有可靠落点。拒绝。

## Consequences

- 记忆质量取决于 Agent 的记笔记纪律，system prompt / App help 需持续引导"写提炼后的结论"。
- 搜索实现为 SQLite `LIKE` 子串扫描：个人笔记规模（数千条内）足够快，且对中文任意长度查询准确；若未来数据量显著增长，升级路径是 FTS5（trigram tokenizer，需处理 <3 字查询回退与 Prisma 迁移 drift）。
