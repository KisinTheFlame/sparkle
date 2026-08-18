import { defineJsonRoute } from "@sparkle/http/contract";
import { z } from "zod";

/**
 * sparkle-feishu 进程的对外契约（单一事实源）。feishu 是飞书接入独立进程：持有自建应用的
 * 长连接事件订阅 + 出站 API 门面；agent 经本契约出站（发消息），入站走 SSE 事件流
 * （见 event.ts，非 JSON 路由）。
 */

export const FeishuSendMessageRequestSchema = z
  .object({
    chatId: z.string().min(1),
    text: z.string().min(1),
  })
  .strict();

export type FeishuSendMessageRequest = z.infer<typeof FeishuSendMessageRequestSchema>;

export const FeishuSendMessageResponseSchema = z
  .object({
    messageId: z.string().min(1),
  })
  .strict();

export const feishuApiContract = {
  sendMessage: defineJsonRoute({
    method: "POST",
    path: "/feishu/send",
    input: FeishuSendMessageRequestSchema,
    output: FeishuSendMessageResponseSchema,
  }),
} as const;
