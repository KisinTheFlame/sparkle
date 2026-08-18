/** 飞书 App 私有的会话内存模型（不进 runtime 核心抽象）。 */

export type FeishuMessage = {
  senderId: string;
  senderName: string | null;
  text: string;
  at: Date;
};

export type FeishuConversation = {
  chatId: string;
  chatType: "p2p" | "group";
  /** 会话名（群名 / 对方名）；feishu 进程解析失败时为 null，展示回落 chatId。 */
  name: string | null;
  unreadCount: number;
  /** 最近消息环形缓冲（含自己发出的），上限 RECENT_MESSAGE_CAP。 */
  recent: FeishuMessage[];
  lastActiveAt: Date;
};

/** 每会话保留的最近消息条数（open_conversation 一屏能看的历史）。 */
export const RECENT_MESSAGE_CAP = 50;

export function pushRecent(conversation: FeishuConversation, message: FeishuMessage): void {
  conversation.recent.push(message);
  if (conversation.recent.length > RECENT_MESSAGE_CAP) {
    conversation.recent.splice(0, conversation.recent.length - RECENT_MESSAGE_CAP);
  }
  conversation.lastActiveAt = message.at;
}
