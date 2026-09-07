import type { FastifyInstance } from "fastify";
import { loadStaticConfig } from "@sparkle/kernel/config/config.loader";
import { AppLogger } from "@sparkle/kernel/logger/logger";
import { createServiceApp } from "@sparkle/kernel/http/service-app";
import { HealthHandler } from "@sparkle/kernel/http/health.handler";
import { FEISHU_SSE_HEARTBEAT_MS } from "@sparkle/feishu-api/event";
import { FeishuEventBroadcaster } from "../application/event-broadcaster.js";
import { FeishuEventStore } from "../application/event-store.js";
import { FeishuGateway } from "../application/feishu-gateway.js";
import { FeishuEventsHandler } from "../http/feishu-events.handler.js";
import { FeishuSendHandler } from "../http/feishu-send.handler.js";
import { closeDb, configureSqlite, createDbClient, type Database } from "../infra/db/client.js";

const logger = new AppLogger({ source: "feishu-bootstrap" });

/** 事件保留窗口：agent 游标只前进，旧事件行仅供回放，7 天足够覆盖任何合理断连。 */
const EVENT_RETENTION_DAYS = 7;
const EVENT_PRUNE_INTERVAL_MS = 24 * 60 * 60 * 1000;

export type FeishuRuntime = {
  app: FastifyInstance;
  database: Database;
  port: number;
  /** 关停时清 SSE 心跳与事件保留清理定时器。 */
  stopTimers: () => void;
};

/**
 * sparkle-feishu 进程运行时装配：飞书接入独立进程。持有自建应用长连接事件订阅（WS，SDK 自管
 * 重连）+ 出站 API 门面 + 事件落库（append-only，供 SSE 回放）。独立 PM2 生命周期——agent
 * 重启不断飞书连接（napcat 时代拓扑的直接后继）。
 */
export async function buildFeishuRuntime(): Promise<FeishuRuntime> {
  const config = await loadStaticConfig();

  const database = createDbClient({ databaseUrl: config.services.feishu.databaseUrl });
  await configureSqlite(database);

  const eventStore = new FeishuEventStore({ database });
  const broadcaster = new FeishuEventBroadcaster();
  const gateway = new FeishuGateway({
    appId: config.server.feishu.appId,
    appSecret: config.server.feishu.appSecret,
    eventStore,
    broadcaster,
  });

  const app = createServiceApp({
    logger,
    handlers: [
      new HealthHandler(),
      new FeishuSendHandler({ gateway }),
      new FeishuEventsHandler({ store: eventStore, broadcaster }),
    ],
  });

  await gateway.start();

  // SSE 心跳：给所有在线订阅者发注释帧保活（agent 侧靠它判半开）。unref 不挡进程退出。
  const heartbeatTimer = setInterval(() => {
    broadcaster.heartbeatAll();
  }, FEISHU_SSE_HEARTBEAT_MS);
  heartbeatTimer.unref?.();

  // 事件保留清理：每日删过窗旧行。unref 不挡进程退出。
  const pruneTimer = setInterval(() => {
    const cutoff = new Date(Date.now() - EVENT_RETENTION_DAYS * 24 * 60 * 60 * 1000);
    void eventStore.pruneBefore({ cutoff }).catch(error => {
      logger.warn("feishu 事件保留清理失败", {
        event: "feishu.event_prune_failed",
        error: error instanceof Error ? error.message : String(error),
      });
    });
  }, EVENT_PRUNE_INTERVAL_MS);
  pruneTimer.unref?.();

  return {
    app,
    database,
    port: config.services.feishu.port,
    stopTimers: () => {
      clearInterval(heartbeatTimer);
      clearInterval(pruneTimer);
    },
  };
}

export { closeDb };
