-- epic #539 收尾（子 issue 5）：DROP 已拆走服务的旧表。
-- llm 五表（→ data/sqlite/llm.db，子 issue 3）与 image_asset 的归属库已完成启动期搬迁
-- 并对账（哨兵 user_version=1），主库中的这些旧表只剩历史副本、无任何进程读写。
-- 自此主库为 agent 独占库。
-- IF EXISTS：破坏性收尾迁移对异构库状态容错，缺表跳过而非 P3009 堵死迁移链。
-- 空间回收：DROP 只释放页到 freelist，8GB+ 的物理回收由部署后的一次性 VACUUM 完成
--（VACUUM 需独占、不能进迁移事务；操作步骤见 docs/configuration.md「维护」）。
DROP TABLE IF EXISTS "image_asset";
DROP TABLE IF EXISTS "llm_chat_call";
DROP TABLE IF EXISTS "embedding_cache";
DROP TABLE IF EXISTS "claude_file_cache";
DROP TABLE IF EXISTS "oauth_session";
DROP TABLE IF EXISTS "oauth_state";
