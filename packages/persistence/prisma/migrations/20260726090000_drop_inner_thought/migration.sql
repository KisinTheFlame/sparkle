-- inner-voice 机制整体拆除：摸鱼判定 / 内心独白 TaskAgent / <inner_impulse> 注入
-- 全部删除，落库表随之退役。SQLite 的 DROP TABLE 连带删除该表全部索引。
DROP TABLE "inner_thought";
