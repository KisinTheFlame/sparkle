import { z } from "zod";

/**
 * sparkle-feishu → agent 的**入站消息事件** wire（SSE 载荷）。
 *
 * 与 scheduler 的 tick 不同：消息是**外部事实**，断连必须逐条回放——feishu 进程把归一化
 * 后的事件按 seq 追加落库，SSE 以 `id: <seq>` 输出帧；agent 侧持久化消费游标，重连带
 * `Last-Event-ID` 从缺口处回放。投递保证是 at-least-once（agent 侧按 seq 幂等）。
 */
export const FeishuMessageEventSchema = z
  .object({
    /** 单调递增序号（feishu 库自增主键），SSE 帧 id 与回放游标。 */
    seq: z.number().int().positive(),
    /** 飞书消息 id（om_ 开头），事件级幂等键。 */
    messageId: z.string().min(1),
    /** 会话 id（oc_ 开头）。 */
    chatId: z.string().min(1),
    chatType: z.enum(["p2p", "group"]),
    /** 会话名（群名 / 对方名）；解析失败时为 null，展示侧回落 chatId。 */
    chatName: z.string().nullable(),
    /** 发送者 open_id。 */
    senderId: z.string().min(1),
    /** 发送者名字；无权限解析时为 null，展示侧回落 open_id 尾段。 */
    senderName: z.string().nullable(),
    /** 原始消息类型（text / post / image / file / ...）。 */
    msgType: z.string().min(1),
    /** 归一化文本：text/post 提取正文（@ 提及还原成名字），其余类型给占位（如 [图片]）。 */
    text: z.string(),
    /** 消息产生时刻（ISO）。 */
    createdAt: z.string().datetime(),
  })
  .strict();

export type FeishuMessageEvent = z.infer<typeof FeishuMessageEventSchema>;

/** SSE 事件流路径（agent 拨出订阅；非 JsonRoute，是 `text/event-stream` 长流）。 */
export const FEISHU_EVENTS_SSE_PATH = "/feishu/events";

/** SSE 心跳：feishu 进程每 15s 发一个注释帧保活；agent 侧超阈值无帧即判半开重连。 */
export const FEISHU_SSE_HEARTBEAT_MS = 15_000;
