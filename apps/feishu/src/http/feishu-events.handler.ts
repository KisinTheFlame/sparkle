import type { FastifyInstance, FastifyRequest } from "fastify";
import { AppLogger } from "@sparkle/kernel/logger/logger";
import { createBackpressureAwareWrite } from "@sparkle/http/sse";
import { FEISHU_EVENTS_SSE_PATH } from "@sparkle/feishu-api/event";
import {
  encodeEventFrame,
  type FeishuEventBroadcaster,
  type FeishuEventSubscriber,
} from "../application/event-broadcaster.js";
import type { FeishuEventStore } from "../application/event-store.js";

const logger = new AppLogger({ source: "feishu.events-handler" });

/** SSE 背压宽限期：res.write 背压后等 drain 这么久，还不 drain 就销毁连接（#425 同款）。 */
const SSE_BACKPRESSURE_GRACE_MS = 15_000;
/** 回放分页大小。 */
const REPLAY_BATCH_SIZE = 200;

type FeishuEventsHandlerDeps = {
  store: FeishuEventStore;
  broadcaster: FeishuEventBroadcaster;
};

/**
 * SSE 入站事件流端点 `GET /feishu/events`（agent 拨出订阅）。消息是外部事实：帧带 `id: <seq>`，
 * agent 断线重连带 `Last-Event-ID`，本端从库里回放缺口后接 live。
 *
 * 回放与 live 的乱序防护：先以 buffering 状态注册订阅者（live 事件进缓冲），分页回放完历史后
 * flush 缓冲（按 lastSentSeq 去重）再转 live——事件到达顺序恒为 seq 升序。
 */
export class FeishuEventsHandler {
  private readonly store: FeishuEventStore;
  private readonly broadcaster: FeishuEventBroadcaster;

  public constructor({ store, broadcaster }: FeishuEventsHandlerDeps) {
    this.store = store;
    this.broadcaster = broadcaster;
  }

  public register(app: FastifyInstance): void {
    app.get(FEISHU_EVENTS_SSE_PATH, async (request, reply) => {
      const cursor = parseLastEventId(request);

      reply.hijack();
      const res = reply.raw;
      res.writeHead(200, {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        Connection: "keep-alive",
        "X-Accel-Buffering": "no",
      });

      const write = createBackpressureAwareWrite(res, SSE_BACKPRESSURE_GRACE_MS, () => {
        logger.warn("SSE 背压超时，销毁连接等 agent 重连", {
          event: "feishu.sse.backpressure_timeout",
        });
      });

      const subscriber: FeishuEventSubscriber = {
        write,
        heartbeat: () => write(": keepalive\n\n"),
        buffering: true,
        buffered: [],
        lastSentSeq: cursor,
      };
      this.broadcaster.add(subscriber);
      res.on("close", () => this.broadcaster.remove(subscriber));

      try {
        // 分页回放缺口（回放期间的 live 事件在 buffered 里排队）。
        let replayCursor = cursor;
        for (;;) {
          const batch = await this.store.listAfter({ seq: replayCursor, limit: REPLAY_BATCH_SIZE });
          for (const event of batch) {
            subscriber.lastSentSeq = event.seq;
            write(encodeEventFrame(event));
          }
          if (batch.length < REPLAY_BATCH_SIZE) {
            break;
          }
          replayCursor = batch[batch.length - 1]?.seq ?? replayCursor;
        }
        // flush 回放期间缓冲的 live 事件（seq 去重后按序写出），转 live。
        for (const event of subscriber.buffered) {
          if (event.seq > subscriber.lastSentSeq) {
            subscriber.lastSentSeq = event.seq;
            write(encodeEventFrame(event));
          }
        }
        subscriber.buffered.length = 0;
        subscriber.buffering = false;
      } catch (error) {
        logger.errorWithCause("SSE 回放失败，销毁连接等 agent 重连", error, {
          event: "feishu.sse.replay_failed",
        });
        this.broadcaster.remove(subscriber);
        res.destroy();
      }
    });
  }
}

function parseLastEventId(request: FastifyRequest): number {
  const raw = request.headers["last-event-id"];
  const value = Array.isArray(raw) ? raw[0] : raw;
  if (typeof value === "string") {
    const parsed = Number.parseInt(value, 10);
    if (Number.isInteger(parsed) && parsed >= 0) {
      return parsed;
    }
  }
  return 0;
}
