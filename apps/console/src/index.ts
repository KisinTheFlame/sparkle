import Fastify from "fastify";
import { createHealthResponse } from "@sparkle/shared/utils";

const SERVICE_NAME = "console";
const PORT = Number(process.env.PORT ?? 3002);

const app = Fastify({ logger: true });

app.get("/health", () => createHealthResponse(SERVICE_NAME));

async function main() {
  try {
    await app.listen({ port: PORT, host: "0.0.0.0" });
  } catch (err) {
    app.log.error(err);
    process.exit(1);
  }
}

void main();
