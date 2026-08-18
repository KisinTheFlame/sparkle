import { renderServerStaticTemplate } from "@sparkle/kernel/runtime/read-static-text";
import type { FeishuConversation, FeishuMessage } from "./conversation.js";

/**
 * 飞书 App 的屏幕渲染：会话列表 / 会话画面 / 前台新消息块。散文在 .hbs 模板里，
 * 这里只算 view-model（label / 消息行等预格式化字符串）。
 */

export function renderFeishuConversationList(conversations: readonly FeishuConversation[]): string {
  return renderServerStaticTemplate(import.meta.url, "context/feishu-conversation-list.hbs", {
    isEmpty: conversations.length === 0,
    conversations: conversations.map(conversation => ({
      chatId: conversation.chatId,
      label: conversationLabel(conversation),
      unread: conversation.unreadCount,
    })),
  }).trim();
}

export function renderFeishuConversation(conversation: FeishuConversation): string {
  return renderServerStaticTemplate(import.meta.url, "context/feishu-conversation.hbs", {
    chatId: conversation.chatId,
    label: conversationLabel(conversation),
    isEmpty: conversation.recent.length === 0,
    lines: conversation.recent.map(formatMessageLine),
  }).trim();
}

export function renderFeishuNewMessages(
  conversation: FeishuConversation,
  messages: readonly FeishuMessage[],
): string {
  return renderServerStaticTemplate(
    import.meta.url,
    "context/feishu-conversation-new-messages.hbs",
    {
      label: conversationLabel(conversation),
      lines: messages.map(formatMessageLine),
    },
  ).trim();
}

/** 会话展示名：会话名缺失时回落 chatId；群聊带标注。 */
export function conversationLabel(conversation: FeishuConversation): string {
  const base = conversation.name ?? conversation.chatId;
  return conversation.chatType === "group" ? `${base}（群聊）` : base;
}

/** 单条消息行：`[MM-DD HH:mm] 发送者: 文本`。中和伪闭合标签，保住屏幕标签结构。 */
function formatMessageLine(message: FeishuMessage): string {
  const sender = message.senderName ?? shortenOpenId(message.senderId);
  const text = message.text.replaceAll("</feishu_", "<\\/feishu_");
  return `[${formatTime(message.at)}] ${sender}: ${text}`;
}

function shortenOpenId(openId: string): string {
  return openId.length > 12 ? `${openId.slice(0, 8)}…` : openId;
}

function formatTime(date: Date): string {
  const pad = (n: number): string => String(n).padStart(2, "0");
  return `${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
}
