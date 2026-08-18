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
  private readonly chatNameCache: NameCache = new Map();
  private readonly userNameCache: NameCache = new Map();
  /** 群成员名单缓存（chatId → open_id→名字）：给通讯录查不到的外部成员兜底。 */
  private readonly chatMemberCache: RosterCache = new Map();

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
    const [resolvedChatName, senderName] = await Promise.all([
      this.resolveChatName(normalized.chatId),
      this.resolveSenderName(normalized.senderId, normalized.chatId, normalized.chatType),
    ]);
    // 单聊没有"群名"（im.chat.get 对 p2p 通常拿不到 name）：以对方名字作会话名。
    const chatName = resolvedChatName ?? (normalized.chatType === "p2p" ? senderName : null);
    const stored = await this.eventStore.insert({ ...normalized, chatName, senderName });
    if (stored === null) {
      // messageId 撞唯一索引：飞书重投递，静默跳过。
      return;
    }
    this.broadcaster.publish(stored satisfies FeishuMessageEvent);
  }

  private async resolveChatName(chatId: string): Promise<string | null> {
    const cached = cacheGet(this.chatNameCache, chatId);
    if (cached !== undefined) {
      return cached;
    }
    try {
      const response = await this.client.im.chat.get({ path: { chat_id: chatId } });
      const name = response.data?.name?.trim() || null;
      cacheSet(this.chatNameCache, chatId, name);
      return name;
    } catch {
      // 权限未批 / 网络抖动：短 TTL 负缓存——既防每条消息都打一次 API，
      // 又让补批权限后无需重启即自愈。
      cacheSet(this.chatNameCache, chatId, null);
      return null;
    }
  }

  /**
   * 发送者名字：先查通讯录（内部成员最准），拿不到再回落查所在群的成员名单。
   *
   * 回落这一层是给**外部成员**准备的：跨租户联系人不在应用的通讯录可见范围里，
   * `contact.user.get` 永远查不到，但群成员列表能给出他们在群里的名字（走同一份
   * `im:chat` 权限）。单聊没有成员名单可查，只能停在通讯录这一步。
   */
  private async resolveSenderName(
    openId: string,
    chatId: string,
    chatType: "p2p" | "group",
  ): Promise<string | null> {
    const fromDirectory = await this.resolveUserName(openId);
    if (fromDirectory !== null) {
      return fromDirectory;
    }
    if (chatType !== "group") {
      return null;
    }
    return this.resolveChatMemberName(chatId, openId);
  }

  private async resolveUserName(openId: string): Promise<string | null> {
    if (openId === "unknown") {
      return null;
    }
    const cached = cacheGet(this.userNameCache, openId);
    if (cached !== undefined) {
      return cached;
    }
    try {
      const response = await this.client.contact.user.get({
        path: { user_id: openId },
        params: { user_id_type: "open_id" },
      });
      const name = response.data?.user?.name?.trim() || null;
      cacheSet(this.userNameCache, openId, name);
      return name;
    } catch {
      // 典型失败：外部成员（不在通讯录可见范围）或缺 contact 读权限。短 TTL 负缓存
      // 防打爆 API，同时让权限/范围补齐后自愈；群聊还会走成员名单兜底。
      cacheSet(this.userNameCache, openId, null);
      return null;
    }
  }

  /** 查群成员名单里该 open_id 的名字。整群名单一次拉齐并按 chatId 缓存（分页封顶）。 */
  private async resolveChatMemberName(chatId: string, openId: string): Promise<string | null> {
    const cachedRoster = cacheGetRoster(this.chatMemberCache, chatId);
    if (cachedRoster) {
      return cachedRoster.get(openId) ?? null;
    }
    const roster = new Map<string, string>();
    try {
      let pageToken: string | undefined;
      for (let page = 0; page < CHAT_MEMBER_MAX_PAGES; page++) {
        const response = await this.client.im.chatMembers.get({
          path: { chat_id: chatId },
          params: {
            member_id_type: "open_id",
            page_size: CHAT_MEMBER_PAGE_SIZE,
            ...(pageToken === undefined ? {} : { page_token: pageToken }),
          },
        });
        for (const member of response.data?.items ?? []) {
          const name = member.name?.trim();
          if (member.member_id && name) {
            roster.set(member.member_id, name);
          }
        }
        pageToken = response.data?.page_token;
        if (response.data?.has_more !== true || pageToken === undefined) {
          break;
        }
      }
      cacheSetRoster(this.chatMemberCache, chatId, roster);
      return roster.get(openId) ?? null;
    } catch {
      // 名单拉取失败（权限 / 机器人已不在群）：缓存空名单短 TTL，避免每条消息重试。
      cacheSetRoster(this.chatMemberCache, chatId, roster);
      return null;
    }
  }
}

/** 命中缓存 1 小时（名字会改，别永久钉死）；未命中 5 分钟后重试（权限补批后自愈）。 */
const NAME_CACHE_HIT_TTL_MS = 60 * 60 * 1000;
const NAME_CACHE_MISS_TTL_MS = 5 * 60 * 1000;

type NameCacheEntry = { value: string | null; expiresAt: number };
type NameCache = Map<string, NameCacheEntry>;

function cacheGet(cache: NameCache, key: string): string | null | undefined {
  const entry = cache.get(key);
  if (!entry || entry.expiresAt <= Date.now()) {
    cache.delete(key);
    return undefined;
  }
  return entry.value;
}

function cacheSet(cache: NameCache, key: string, value: string | null): void {
  const ttl = value === null ? NAME_CACHE_MISS_TTL_MS : NAME_CACHE_HIT_TTL_MS;
  cache.set(key, { value, expiresAt: Date.now() + ttl });
}

/** 群成员名单缓存 10 分钟：成员进出比人名变化频繁，窗口取短些。 */
const ROSTER_CACHE_TTL_MS = 10 * 60 * 1000;
/** 单次分页大小与页数上限：大群名单不无限拉（超出的成员回落显示 id）。 */
const CHAT_MEMBER_PAGE_SIZE = 100;
const CHAT_MEMBER_MAX_PAGES = 10;

type RosterCacheEntry = { roster: Map<string, string>; expiresAt: number };
type RosterCache = Map<string, RosterCacheEntry>;

function cacheGetRoster(cache: RosterCache, chatId: string): Map<string, string> | undefined {
  const entry = cache.get(chatId);
  if (!entry || entry.expiresAt <= Date.now()) {
    cache.delete(chatId);
    return undefined;
  }
  return entry.roster;
}

function cacheSetRoster(cache: RosterCache, chatId: string, roster: Map<string, string>): void {
  cache.set(chatId, { roster, expiresAt: Date.now() + ROSTER_CACHE_TTL_MS });
}
