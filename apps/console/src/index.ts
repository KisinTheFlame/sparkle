import Fastify from "fastify";
import { createHealthResponse } from "@sparkle/shared/utils";
import { loadStaticConfig } from "@sparkle/config";

const SERVICE_NAME = "console";

const app = Fastify({ logger: true });

app.get("/health", () => createHealthResponse(SERVICE_NAME));

async function main() {
  // 监听端口来自 config.yaml 的 services.console.port（服务寻址单源）。
  const config = await loadStaticConfig();
  try {
    await app.listen({ port: config.services.console.port, host: "0.0.0.0" });
  } catch (err) {
    app.log.error(err);
    process.exit(1);
  }
}

void main();
