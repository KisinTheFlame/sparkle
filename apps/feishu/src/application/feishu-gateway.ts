import { Client, EventDispatcher, WSClient } from "@larksuiteoapi/node-sdk";
import { AppLogger } from "@sparkle/kernel/logger/logger";
import type { FeishuMessageEvent } from "@sparkle/feishu-api/event";
import { InboundMessagePayloadSchema, normalizeInboundMessage } from "../domain/inbound-message.js";
import type { FeishuEventBroadcaster } from "./event-broadcaster.js";
import type { FeishuEventStore } from "./event-store.js";

const logger = new AppLogger({ source: "feishu.gateway" });

type FeishuGatewayDeps = {
  appId: string;
  appSecret: string;
  eventStore: FeishuEventStore;
  broadcaster: FeishuEventBroadcaster;
};

/**
 * 飞书网关：持有自建应用的长连接事件订阅（官方 SDK WSClient，token / 验签 / 重连全在 SDK 内）
 * 与出站 API client。入站 `im.message.receive_v1` → 归一化 → 落库（messageId 幂等）→ 广播；
 * 出站 sendMessage 发文本消息。
 *
 * 名字解析（尽力而为，带进程内缓存）：会话名走 im.chat.get，发送者名走 contact.user.get；
 * 任一失败都降级为 null（展示侧回落 id），绝不阻断事件流——权限没批到时功能照常、只是没名字。
 */
export class FeishuGateway {
  private readonly client: Client;
  private readonly wsClient: WSClient;
  private readonly eventStore: FeishuEventStore;
  private readonly broadcaster: FeishuEventBroadcaster;
  private readonly chatNameCache = new Map<string, string | null>();
  private readonly userNameCache = new Map<string, string | null>();

  public constructor({ appId, appSecret, eventStore, broadcaster }: FeishuGatewayDeps) {
    this.client = new Client({ appId, appSecret });
    this.wsClient = new WSClient({ appId, appSecret });
    this.eventStore = eventStore;
    this.broadcaster = broadcaster;
  }

  /** 启动长连接事件订阅（SDK 内部自管重连）。 */
  public start(): void {
    const dispatcher = new EventDispatcher({}).register({
      "im.message.receive_v1": async data => {
        try {
          await this.handleInboundMessage(data);
        } catch (error) {
          // 单条消息处理失败绝不打断订阅流：记日志后继续收下一条。
          logger.errorWithCause("处理入站消息失败，已跳过", error, {
            event: "feishu.inbound.handle_failed",
          });
        }
      },
    });
    this.wsClient.start({ eventDispatcher: dispatcher });
    logger.info("Feishu WS 长连接事件订阅已启动", { event: "feishu.ws.started" });
  }

  public async sendMessage(input: {
    chatId: string;
    text: string;
  }): Promise<{ messageId: string }> {
    const response = await this.client.im.message.create({
      params: { receive_id_type: "chat_id" },
      data: {
        receive_id: input.chatId,
        msg_type: "text",
        content: JSON.stringify({ text: input.text }),
      },
    });
    const messageId = response.data?.message_id;
    if (!messageId) {
      throw new Error(`飞书发消息未返回 message_id（code=${String(response.code)}）`);
    }
    return { messageId };
  }

  private async handleInboundMessage(data: unknown): Promise<void> {
    const parsed = InboundMessagePayloadSchema.safeParse(data);
    if (!parsed.success) {
      logger.warn("入站消息形状不识别，已跳过", {
        event: "feishu.inbound.unrecognized",
        issues: parsed.error.issues.slice(0, 3),
      });
      return;
    }
    const normalized = normalizeInboundMessage(parsed.data);
    const [chatName, senderName] = await Promise.all([
      this.resolveChatName(normalized.chatId),
      this.resolveUserName(normalized.senderId),
    ]);
    const stored = await this.eventStore.insert({ ...normalized, chatName, senderName });
    if (stored === null) {
      // messageId 撞唯一索引：飞书重投递，静默跳过。
      return;
    }
    this.broadcaster.publish(stored satisfies FeishuMessageEvent);
  }

  private async resolveChatName(chatId: string): Promise<string | null> {
    const cached = this.chatNameCache.get(chatId);
    if (cached !== undefined) {
      return cached;
    }
    try {
      const response = await this.client.im.chat.get({ path: { chat_id: chatId } });
      const name = response.data?.name ?? null;
      this.chatNameCache.set(chatId, name);
      return name;
    } catch {
      // 权限未批 / 网络抖动：缓存 null 防止每条消息都打一次 API。
      this.chatNameCache.set(chatId, null);
      return null;
    }
  }

  private async resolveUserName(openId: string): Promise<string | null> {
    if (openId === "unknown") {
      return null;
    }
    const cached = this.userNameCache.get(openId);
    if (cached !== undefined) {
      return cached;
    }
    try {
      const response = await this.client.contact.user.get({
        path: { user_id: openId },
        params: { user_id_type: "open_id" },
      });
      const name = response.data?.user?.name ?? null;
      this.userNameCache.set(openId, name);
      return name;
    } catch {
      this.userNameCache.set(openId, null);
      return null;
    }
  }
}
