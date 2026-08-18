import type { FeishuMessageEvent } from "@sparkle/feishu-api/event";
import type { Database } from "../infra/db/client.js";

/** 落库载荷：FeishuMessageEvent 去掉 seq（seq = 自增主键）。 */
export type StorableFeishuEvent = Omit<FeishuMessageEvent, "seq">;

/**
 * 入站事件的 append-only 存储：insert 返回带 seq 的完整事件；messageId 撞唯一索引
 * （飞书重投递）返回 null，调用方静默跳过。listAfter 供 SSE 按 Last-Event-ID 回放。
 */
export class FeishuEventStore {
  private readonly database: Database;

  public constructor({ database }: { database: Database }) {
    this.database = database;
  }

  public async insert(event: StorableFeishuEvent): Promise<FeishuMessageEvent | null> {
    try {
      const row = await this.database.feishuEvent.create({
        data: { messageId: event.messageId, payload: event },
      });
      return { ...event, seq: row.seq };
    } catch (error) {
      if (isUniqueViolation(error)) {
        return null;
      }
      throw error;
    }
  }

  public async listAfter(input: { seq: number; limit: number }): Promise<FeishuMessageEvent[]> {
    const rows = await this.database.feishuEvent.findMany({
      where: { seq: { gt: input.seq } },
      orderBy: { seq: "asc" },
      take: input.limit,
    });
    return rows.map(row => ({ ...(row.payload as StorableFeishuEvent), seq: row.seq }));
  }

  /** 保留窗口清理：删除早于 cutoff 的事件行（agent 消费游标只会前进，旧行仅回放用）。 */
  public async pruneBefore(input: { cutoff: Date }): Promise<number> {
    const result = await this.database.feishuEvent.deleteMany({
      where: { createdAt: { lt: input.cutoff } },
    });
    return result.count;
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
