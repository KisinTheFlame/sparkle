import { loadStaticConfig } from "@sparkle/config";
import {
  AppLogger,
  DbLogSink,
  getLoggerRuntime,
  initLoggerRuntime,
  StdoutLogSink,
} from "@sparkle/logger";
import { closeDb, createDbClient, PrismaLogDao } from "@sparkle/db";
import { buildAgentServer } from "./server.js";

const SHUTDOWN_TIMEOUT_MS = 10_000;

async function main(): Promise<void> {
  const config = await loadStaticConfig();

  // 日志 runtime 需在任何业务日志前初始化。db sink 把日志落进 app_log 表。
  const logDatabase = createDbClient({ databaseUrl: config.server.databaseUrl });
  initLoggerRuntime({
    sinks: [new StdoutLogSink(), new DbLogSink({ logDao: new PrismaLogDao({ database: logDatabase }) })],
  });
  const logger = new AppLogger({ source: "bootstrap" });

  const server = buildAgentServer({ config });

  await server.callbackServer.start();
  await server.app.listen({ port: config.server.port, host: "0.0.0.0" });
  logger.info("agent server started", {
    event: "server.started",
    port: config.server.port,
  });

  let isShuttingDown = false;
  const shutdown = (signal: string): void => {
    if (isShuttingDown) {
      return;
    }
    isShuttingDown = true;
    logger.info("agent server shutting down", { event: "server.shutdown", signal });

    const timer = setTimeout(() => {
      process.stderr.write("graceful shutdown timed out, forcing exit\n");
      process.exit(1);
    }, SHUTDOWN_TIMEOUT_MS);
    timer.unref();

    void (async () => {
      try {
        await server.close();
        await closeDb(logDatabase);
        await getLoggerRuntime().close();
        process.exit(0);
      } catch (error) {
        process.stderr.write(`shutdown failed: ${String(error)}\n`);
        process.exit(1);
      }
    })();
  };

  process.on("SIGINT", () => shutdown("SIGINT"));
  process.on("SIGTERM", () => shutdown("SIGTERM"));
}

void main().catch((error: unknown) => {
  process.stderr.write(`agent server failed to start: ${String(error)}\n`);
  process.exit(1);
});
