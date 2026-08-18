import { AppLogger } from "@sparkle/kernel/logger/logger";
import {
  FEISHU_EVENTS_SSE_PATH,
  FeishuMessageEventSchema,
  type FeishuMessageEvent,
} from "@sparkle/feishu-api/event";

const logger = new AppLogger({ source: "agent.feishu-event-subscriber" });

const INITIAL_BACKOFF_MS = 1_000;
const MAX_BACKOFF_MS = 30_000;
// 45s 内无任何帧（含 15s 心跳）判半开：主动 abort 重连。留 3 个心跳周期裕量。
const DEAD_CONNECTION_TIMEOUT_MS = 45_000;

export type FeishuCursorStore = {
  load(): Promise<number>;
  save(seq: number): Promise<void>;
};

type FeishuEventSubscriberDeps = {
  /** sparkle-feishu 基址，如 `http://127.0.0.1:20013`。 */
  baseUrl: string;
  /** 每条事件的消费回调；resolve 才推进游标（at-least-once，按 seq 幂等由消费方保证）。 */
  onEvent: (event: FeishuMessageEvent) => Promise<void> | void;
  /** 消费游标持久化：跨 agent 重启记住已消费到的 seq，重连带 Last-Event-ID 回放缺口。 */
  cursorStore: FeishuCursorStore;
  fetch?: typeof fetch;
};

/**
 * 入站事件订阅：长连 sparkle-feishu 的 SSE 流。掉线指数退避重连、无帧超时判半开、
 * 处理成功后落持久游标。事件是外部事实——重连带 `Last-Event-ID`，feishu 侧从库里回放缺口。
 */
export class FeishuEventSubscriber {
  private readonly baseUrl: string;
  private readonly onEvent: (event: FeishuMessageEvent) => Promise<void> | void;
  private readonly cursorStore: FeishuCursorStore;
  private readonly fetchImpl: typeof fetch;
  private running = false;
  private controller: AbortController | null = null;

  public constructor({
    baseUrl,
    onEvent,
    cursorStore,
    fetch: fetchImpl,
  }: FeishuEventSubscriberDeps) {
    this.baseUrl = baseUrl.replace(/\/+$/, "");
    this.onEvent = onEvent;
    this.cursorStore = cursorStore;
    this.fetchImpl = fetchImpl ?? fetch;
  }

  /** 启动后台订阅循环（不阻塞）。 */
  public async start(): Promise<void> {
    if (this.running) {
      return;
    }
    this.running = true;
    let backoffMs = INITIAL_BACKOFF_MS;
    while (this.running) {
      try {
        await this.connectOnce();
        backoffMs = INITIAL_BACKOFF_MS;
      } catch (error) {
        if (this.running) {
          logger.warn("feishu 事件流断开，将重连", {
            event: "agent.feishu_subscriber.connection_dropped",
            backoffMs,
            error: error instanceof Error ? error.message : String(error),
          });
        }
      }
      if (!this.running) {
        break;
      }
      await sleep(backoffMs);
      backoffMs = Math.min(backoffMs * 2, MAX_BACKOFF_MS);
    }
  }

  public stop(): void {
    this.running = false;
    this.controller?.abort();
  }

  private async connectOnce(): Promise<void> {
    const cursor = await this.cursorStore.load();
    const controller = new AbortController();
    this.controller = controller;

    // 半开检测：一段时间没有任何字节（心跳也算）就 abort，走重连。
    let watchdog = setTimeout(() => controller.abort(), DEAD_CONNECTION_TIMEOUT_MS);
    const kick = (): void => {
      clearTimeout(watchdog);
      watchdog = setTimeout(() => controller.abort(), DEAD_CONNECTION_TIMEOUT_MS);
    };

    try {
      const response = await this.fetchImpl(`${this.baseUrl}${FEISHU_EVENTS_SSE_PATH}`, {
        headers: { Accept: "text/event-stream", "Last-Event-ID": String(cursor) },
        signal: controller.signal,
      });
      if (!response.ok || response.body === null) {
        throw new Error(`SSE 连接失败：HTTP ${response.status}`);
      }
      logger.info("feishu 事件流已连接", {
        event: "agent.feishu_subscriber.connected",
        cursor,
      });

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      for (;;) {
        const { done, value } = await reader.read();
        if (done) {
          throw new Error("SSE 流被服务端关闭");
        }
        kick();
        buffer += decoder.decode(value, { stream: true });
        // SSE 帧以空行分隔；剩余半帧留在 buffer 等下一个 chunk。
        for (;;) {
          const boundary = buffer.indexOf("\n\n");
          if (boundary === -1) {
            break;
          }
          const frame = buffer.slice(0, boundary);
          buffer = buffer.slice(boundary + 2);
          await this.consumeFrame(frame);
        }
      }
    } finally {
      clearTimeout(watchdog);
      this.controller = null;
    }
  }

  private async consumeFrame(frame: string): Promise<void> {
    let data = "";
    for (const line of frame.split("\n")) {
      if (line.startsWith("data:")) {
        data += line.slice(5).trimStart();
      }
      // 注释帧（心跳）与 id 行不需要单独处理：游标以事件体里的 seq 为准。
    }
    if (data.length === 0) {
      return;
    }
    let event: FeishuMessageEvent;
    try {
      event = FeishuMessageEventSchema.parse(JSON.parse(data));
    } catch (error) {
      // 单帧坏数据跳过并推进不了游标——记日志，绝不打断流。
      logger.warn("feishu 事件帧解析失败，已跳过", {
        event: "agent.feishu_subscriber.bad_frame",
        error: error instanceof Error ? error.message : String(error),
      });
      return;
    }
    await this.onEvent(event);
    await this.cursorStore.save(event.seq);
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}
