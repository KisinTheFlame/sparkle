import { renderServerStaticTemplate } from "@sparkle/kernel/runtime/read-static-text";
import type { NotificationDraft } from "../../runtime/root-agent/notification/notification-draft.js";

/**
 * 飞书会话的后台通知 draft（手机 OS 模型）。每个会话一个 source（细粒度折叠），
 * 归到 "飞书" 段下，内容一行：`会话名：N 条新消息`。
 * 折叠约定 this = 最新、prev = 历史：会话名取最新、条数累加。
 */
export class FeishuChatNotificationDraft implements NotificationDraft {
  public readonly sourceId: string;
  public readonly group = "飞书";
  public readonly displayName: string;
  private readonly count: number;

  public constructor({
    chatId,
    displayName,
    count = 1,
  }: {
    chatId: string;
    displayName: string;
    count?: number;
  }) {
    this.sourceId = feishuChatSourceId(chatId);
    this.displayName = displayName;
    this.count = count;
  }

  public merge(prev: NotificationDraft): NotificationDraft {
    const previous = prev as FeishuChatNotificationDraft;
    return new FeishuChatNotificationDraft({
      chatId: this.sourceId.slice(FEISHU_CHAT_SOURCE_PREFIX.length),
      displayName: this.displayName,
      count: previous.count + this.count,
    });
  }

  public render(): string {
    return renderServerStaticTemplate(import.meta.url, "context/notifications/feishu-chat.hbs", {
      displayName: this.displayName,
      count: this.count,
    });
  }
}

const FEISHU_CHAT_SOURCE_PREFIX = "feishu:chat:";

/** 会话级通知源 id：打开会话时按它清横幅（clearForSource）。 */
export function feishuChatSourceId(chatId: string): string {
  return `${FEISHU_CHAT_SOURCE_PREFIX}${chatId}`;
}
