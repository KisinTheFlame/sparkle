import type { App, JsonValue } from "@sparkle/agent-runtime";
import { renderServerStaticTemplate } from "@sparkle/kernel/runtime/read-static-text";
import type { FeishuMessageEvent } from "@sparkle/feishu-api/event";
import type { FeishuClient } from "../../../acl/feishu-client.js";
import type { NotificationCenter } from "../../runtime/root-agent/notification/notification-center.js";
import type {
  ForegroundInput,
  ForegroundInputSource,
} from "../../runtime/root-agent/foreground-input.js";
import type { RootAgentEffect } from "../../runtime/effect/root-agent-effect.js";
import { pushRecent, type FeishuConversation, type FeishuMessage } from "./conversation.js";
import {
  FeishuChatNotificationDraft,
  feishuChatSourceId,
} from "./feishu-chat-notification-draft.js";
import {
  conversationLabel,
  renderFeishuConversation,
  renderFeishuConversationList,
  renderFeishuNewMessages,
} from "./render-feishu.js";
import { ListConversationsTool } from "./tools/list-conversations.tool.js";
import { OpenConversationTool } from "./tools/open-conversation.tool.js";
import { SendMessageTool } from "./tools/send-message.tool.js";

export const FEISHU_APP_ID = "feishu";

/** exportState 的形状版本；restoreState 不认识的版本安全忽略。 */
const STATE_VERSION = 1;

type FeishuAppDeps = {
  feishuClient: FeishuClient;
  notificationCenter: NotificationCenter;
  /** 前台输入敲门端口：当前会话来实时新消息时 enqueue 不带内容的 foreground_input 事件。 */
  notifyForegroundInput: () => void;
};

export type OpenConversationResult =
  | { ok: true; content: string }
  | { ok: false; error: "CHAT_NOT_FOUND" };

export type SendMessageResult =
  | { ok: true; messageId: string }
  | { ok: false; error: "CHAT_CONTEXT_UNAVAILABLE" };

/**
 * 飞书 App：消息渠道的承载者。入站事件由 server-runtime 的 SSE 订阅者喂给
 * handleInboundMessage（不走共享事件队列），按「屏幕 vs 横幅」分流：
 * - 前台且属当前会话：入前台缓冲并敲门（实时路径，drain 时现拉渲染）；
 * - 其余：累积进会话、向 NotificationCenter push 一个会话级 draft（横幅）。
 *
 * 全量投递语义：凡是机器人收得到的消息（所在群 + 私聊）都进来，不做 @ 过滤、
 * 不在 prompt 层约束——回不回、回哪条由 Sparkle 自己判断；暴露面靠群成员关系控制。
 */
export class FeishuApp implements App, ForegroundInputSource {
  public readonly id = FEISHU_APP_ID;
  public readonly displayName = "飞书";
  public readonly description = "收发飞书消息：群聊与私聊，打开会话后可实时对话。";
  public readonly tools: readonly [ListConversationsTool, OpenConversationTool, SendMessageTool];

  private readonly feishuClient: FeishuClient;
  private readonly notificationCenter: NotificationCenter;
  private readonly notifyForegroundInput: () => void;

  private readonly conversations = new Map<string, FeishuConversation>();
  /** App 是否处于前台（onFocus/onBlur 翻转）。失焦时前台缓冲退化回通知路径。 */
  private focused = false;
  /** 当前打开的会话；null = 进了 App 但没打开任何会话。失焦即清空。 */
  private currentChatId: string | null = null;
  /** 当前会话待注入的实时消息（drain 时现拉渲染，先渲染后消费）。 */
  private pendingForeground: FeishuMessage[] = [];

  public constructor({ feishuClient, notificationCenter, notifyForegroundInput }: FeishuAppDeps) {
    this.feishuClient = feishuClient;
    this.notificationCenter = notificationCenter;
    this.notifyForegroundInput = notifyForegroundInput;
    this.tools = [
      new ListConversationsTool({ list: () => this.renderConversationList() }),
      new OpenConversationTool({ open: chatId => this.openConversation(chatId) }),
      new SendMessageTool({ send: text => this.sendMessage(text) }),
    ];
  }

  public canInvoke(): boolean {
    return true;
  }

  public async help(): Promise<string> {
    return renderServerStaticTemplate(import.meta.url, "prompts/feishu-app-help.hbs");
  }

  /** 进入 App：屏幕是会话列表。 */
  public async onFocus(): Promise<readonly RootAgentEffect[]> {
    this.focused = true;
    return [{ type: "append_message", content: this.renderConversationList() }];
  }

  /** 离开 App：前台缓冲退化回通知路径（绝不静默丢），当前会话关闭。 */
  public async onBlur(): Promise<readonly RootAgentEffect[]> {
    this.focused = false;
    this.demotePendingToNotification();
    this.currentChatId = null;
    return [];
  }

  /** 入站消息（来自 SSE 订阅者）。永不抛：单条失败只影响该条。 */
  public handleInboundMessage(event: FeishuMessageEvent): void {
    const conversation = this.upsertConversation(event);
    const message: FeishuMessage = {
      senderId: event.senderId,
      senderName: event.senderName,
      text: event.text,
      at: new Date(event.createdAt),
    };
    pushRecent(conversation, message);

    if (this.focused && this.currentChatId === event.chatId) {
      // 屏幕路径：当前会话的实时消息入前台缓冲 + 敲门（内容 drain 时现拉）。
      this.pendingForeground.push(message);
      this.notifyForegroundInput();
      return;
    }
    // 横幅路径：未读累积 + 会话级通知 draft。
    conversation.unreadCount += 1;
    this.notificationCenter.push(
      new FeishuChatNotificationDraft({
        chatId: conversation.chatId,
        displayName: conversationLabel(conversation),
      }),
    );
  }

  /** 前台输入现拉：只读已缓冲内容并渲染（纯内存短路径），先渲染后消费。 */
  public async drainForegroundInput(): Promise<ForegroundInput | null> {
    if (!this.focused || this.currentChatId === null || this.pendingForeground.length === 0) {
      return null;
    }
    const conversation = this.conversations.get(this.currentChatId);
    if (!conversation) {
      return null;
    }
    const messages = this.pendingForeground;
    const text = renderFeishuNewMessages(conversation, messages);
    // 渲染成功才消费；渲染抛错时缓冲原封不动（session 侧视同拉空，输入不丢）。
    this.pendingForeground = [];
    return { text, itemCount: messages.length };
  }

  public exportState(): JsonValue {
    return {
      version: STATE_VERSION,
      conversations: [...this.conversations.values()].map(conversation => ({
        chatId: conversation.chatId,
        chatType: conversation.chatType,
        name: conversation.name,
        unreadCount: conversation.unreadCount,
        lastActiveAt: conversation.lastActiveAt.toISOString(),
      })),
    };
  }

  public restoreState(state: JsonValue): void {
    if (
      typeof state !== "object" ||
      state === null ||
      Array.isArray(state) ||
      (state as { version?: unknown }).version !== STATE_VERSION
    ) {
      return;
    }
    const conversations = (state as { conversations?: unknown }).conversations;
    if (!Array.isArray(conversations)) {
      return;
    }
    for (const raw of conversations) {
      if (typeof raw !== "object" || raw === null) {
        continue;
      }
      const record = raw as {
        chatId?: unknown;
        chatType?: unknown;
        name?: unknown;
        unreadCount?: unknown;
        lastActiveAt?: unknown;
      };
      if (typeof record.chatId !== "string" || record.chatId.length === 0) {
        continue;
      }
      this.conversations.set(record.chatId, {
        chatId: record.chatId,
        chatType: record.chatType === "p2p" ? "p2p" : "group",
        name: typeof record.name === "string" ? record.name : null,
        unreadCount:
          typeof record.unreadCount === "number" && record.unreadCount >= 0
            ? record.unreadCount
            : 0,
        recent: [],
        lastActiveAt:
          typeof record.lastActiveAt === "string" ? new Date(record.lastActiveAt) : new Date(),
      });
    }
  }

  private upsertConversation(event: FeishuMessageEvent): FeishuConversation {
    const existing = this.conversations.get(event.chatId);
    if (existing) {
      if (event.chatName !== null) {
        existing.name = event.chatName;
      }
      return existing;
    }
    const conversation: FeishuConversation = {
      chatId: event.chatId,
      chatType: event.chatType,
      name: event.chatName,
      unreadCount: 0,
      recent: [],
      lastActiveAt: new Date(event.createdAt),
    };
    this.conversations.set(event.chatId, conversation);
    return conversation;
  }

  private renderConversationList(): string {
    const conversations = [...this.conversations.values()].sort(
      (a, b) => b.lastActiveAt.getTime() - a.lastActiveAt.getTime(),
    );
    return renderFeishuConversationList(conversations);
  }

  private openConversation(chatId: string): OpenConversationResult {
    const conversation = this.conversations.get(chatId);
    if (!conversation) {
      return { ok: false, error: "CHAT_NOT_FOUND" };
    }
    // 切当前会话：上一个会话的前台缓冲退化回通知（不静默丢）。
    if (this.currentChatId !== null && this.currentChatId !== chatId) {
      this.demotePendingToNotification();
    }
    this.currentChatId = chatId;
    conversation.unreadCount = 0;
    // 打开即已读：清掉这个会话攒着的横幅（内容马上以屏幕形式可见）。
    this.notificationCenter.clearForSource(feishuChatSourceId(chatId));
    return { ok: true, content: renderFeishuConversation(conversation) };
  }

  private async sendMessage(text: string): Promise<SendMessageResult> {
    if (this.currentChatId === null) {
      return { ok: false, error: "CHAT_CONTEXT_UNAVAILABLE" };
    }
    const chatId = this.currentChatId;
    const { messageId } = await this.feishuClient.sendMessage({ chatId, text });
    // 自己发出的消息也进最近记录，会话画面才是完整对话。
    const conversation = this.conversations.get(chatId);
    if (conversation) {
      pushRecent(conversation, {
        senderId: "self",
        senderName: "Sparkle",
        text,
        at: new Date(),
      });
    }
    return { ok: true, messageId };
  }

  /** 前台缓冲退化回通知路径：未读补账 + 补推会话级 draft。 */
  private demotePendingToNotification(): void {
    if (this.pendingForeground.length === 0) {
      return;
    }
    const chatId = this.currentChatId;
    const conversation = chatId ? this.conversations.get(chatId) : undefined;
    const count = this.pendingForeground.length;
    this.pendingForeground = [];
    if (!conversation) {
      return;
    }
    conversation.unreadCount += count;
    this.notificationCenter.push(
      new FeishuChatNotificationDraft({
        chatId: conversation.chatId,
        displayName: conversationLabel(conversation),
        count,
      }),
    );
  }
}
