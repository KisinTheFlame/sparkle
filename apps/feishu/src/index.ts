import { runService } from "@sparkle/kernel/http/service-runner";
import { buildFeishuRuntime, closeDb } from "./app/feishu-runtime.js";

// feishu 进程（sparkle-feishu）：飞书接入独立进程。持有到飞书开放平台的 WS 长连接 + 出站 RPC +
// 入站事件落库/SSE。独立 PM2 生命周期，agent 重启不断飞书连接。
runService({
  name: "feishu",
  source: "feishu-bootstrap",
  build: async () => {
    const runtime = await buildFeishuRuntime();
    return {
      app: runtime.app,
      // 仅绑 127.0.0.1：只有使用方（agent）在同机 reach 它，绝不对外。
      bindHost: "127.0.0.1",
      port: runtime.port,
      cleanup: [() => runtime.stopTimers(), () => closeDb(runtime.database)],
    };
  },
});
