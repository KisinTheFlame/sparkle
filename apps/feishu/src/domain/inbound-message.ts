import { z } from "zod";

/**
 * 飞书 `im.message.receive_v1` 事件里本进程真正消费的字段（宽容 schema：只声明用到的，
 * 其余透传忽略）。SDK 已做验签与解密，这里只做形状收窄。
 */
export const InboundMessagePayloadSchema = z.object({
  sender: z.object({
    sender_id: z
      .object({
        open_id: z.string().min(1),
      })
      .optional(),
  }),
  message: z.object({
    message_id: z.string().min(1),
    chat_id: z.string().min(1),
    chat_type: z.string().min(1),
    message_type: z.string().min(1),
    /** JSON 字符串，形状随 message_type 变。 */
    content: z.string(),
    /** 毫秒时间戳字符串。 */
    create_time: z.string().min(1),
    mentions: z
      .array(
        z.object({
          key: z.string(),
          name: z.string().optional(),
        }),
      )
      .optional(),
  }),
});

export type InboundMessagePayload = z.infer<typeof InboundMessagePayloadSchema>;

/** 归一化产物：FeishuMessageEvent 去掉 seq（seq 由落库自增分配）。 */
export type NormalizedInboundMessage = {
  messageId: string;
  chatId: string;
  chatType: "p2p" | "group";
  senderId: string;
  msgType: string;
  text: string;
  createdAt: string;
};

/**
 * 把飞书入站消息事件归一化成本进程的事件形状：text/post 提取正文（@ 提及键还原成名字），
 * 其余类型给 `[类型]` 占位。归一化必须**永不抛**——单条怪消息不能打断事件流，解析失败
 * 降级为占位文本。
 */
export function normalizeInboundMessage(payload: InboundMessagePayload): NormalizedInboundMessage {
  const { message, sender } = payload;
  return {
    messageId: message.message_id,
    chatId: message.chat_id,
    chatType: message.chat_type === "p2p" ? "p2p" : "group",
    senderId: sender.sender_id?.open_id ?? "unknown",
    msgType: message.message_type,
    text: extractText(message),
    createdAt: toIso(message.create_time),
  };
}

function toIso(createTimeMs: string): string {
  const ms = Number(createTimeMs);
  const date = Number.isFinite(ms) && ms > 0 ? new Date(ms) : new Date();
  return date.toISOString();
}

function extractText(message: InboundMessagePayload["message"]): string {
  try {
    switch (message.message_type) {
      case "text": {
        const content = JSON.parse(message.content) as { text?: unknown };
        const raw = typeof content.text === "string" ? content.text : "";
        return restoreMentions(raw, message.mentions);
      }
      case "post": {
        return restoreMentions(extractPostText(JSON.parse(message.content)), message.mentions);
      }
      case "image":
        return "[图片]";
      case "sticker":
        return "[表情]";
      case "audio":
        return "[语音]";
      case "media":
        return "[视频]";
      case "file": {
        const content = JSON.parse(message.content) as { file_name?: unknown };
        return typeof content.file_name === "string" ? `[文件] ${content.file_name}` : "[文件]";
      }
      case "share_chat":
      case "share_user":
        return "[分享]";
      case "interactive":
        return "[卡片]";
      default:
        return `[${message.message_type}]`;
    }
  } catch {
    return `[${message.message_type}]`;
  }
}

/** 把富文本（post）拍平成纯文本：标题 + 各段落的 text/a/at 节点拼接，段落间换行。 */
function extractPostText(content: unknown): string {
  if (typeof content !== "object" || content === null) {
    return "[富文本]";
  }
  const post = content as { title?: unknown; content?: unknown };
  const lines: string[] = [];
  if (typeof post.title === "string" && post.title.length > 0) {
    lines.push(post.title);
  }
  if (Array.isArray(post.content)) {
    for (const paragraph of post.content) {
      if (!Array.isArray(paragraph)) {
        continue;
      }
      const parts: string[] = [];
      for (const node of paragraph) {
        if (typeof node !== "object" || node === null) {
          continue;
        }
        const el = node as { tag?: unknown; text?: unknown; href?: unknown; user_name?: unknown };
        if (typeof el.text === "string") {
          parts.push(el.text);
        } else if (el.tag === "at" && typeof el.user_name === "string") {
          parts.push(`@${el.user_name}`);
        } else if (el.tag === "img") {
          parts.push("[图片]");
        }
      }
      if (parts.length > 0) {
        lines.push(parts.join(""));
      }
    }
  }
  return lines.length > 0 ? lines.join("\n") : "[富文本]";
}

/** 把 text 里的 @ 提及键（@_user_1 这类）还原成 @名字。 */
function restoreMentions(
  text: string,
  mentions: InboundMessagePayload["message"]["mentions"],
): string {
  if (!mentions || mentions.length === 0) {
    return text;
  }
  let restored = text;
  for (const mention of mentions) {
    if (mention.key && mention.name) {
      restored = restored.replaceAll(mention.key, `@${mention.name}`);
    }
  }
  return restored;
}
