import react from "@vitejs/plugin-react";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { parse } from "yaml";
import { defineConfig } from "vite";

// 服务寻址单源：web 的监听端口与 agent 上游地址都取自 config.yaml 的 services 块；
// config.yaml 缺失（如全新 clone）时回退到默认值，保证 dev 开箱可用。
const DEFAULTS = { webPort: 4173, agentTarget: "http://localhost:20003" };

function resolveServices(): { webPort: number; agentTarget: string } {
  const configPath = path.resolve(__dirname, "../../config.yaml");
  if (!existsSync(configPath)) {
    return DEFAULTS;
  }
  try {
    const raw = parse(readFileSync(configPath, "utf8")) as {
      services?: {
        web?: { port?: number };
        agent?: { host?: string; port?: number };
      };
    };
    const web = raw.services?.web;
    const agent = raw.services?.agent;
    return {
      webPort: web?.port ?? DEFAULTS.webPort,
      agentTarget:
        agent?.host && agent.port ? `http://${agent.host}:${agent.port}` : DEFAULTS.agentTarget,
    };
  } catch {
    return DEFAULTS;
  }
}

const { webPort, agentTarget } = resolveServices();

const BACKEND_PROXY = {
  "/auth": agentTarget,
  "/llm": agentTarget,
  "/health": agentTarget,
};

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
      "@sparkle/shared": path.resolve(__dirname, "../../packages/shared/src"),
    },
  },
  // dev（vite）与 preview（pm2 生产托管）都把后端路由反代到 agent，避免跨域。
  server: { port: webPort, strictPort: true, proxy: BACKEND_PROXY },
  preview: { port: webPort, strictPort: true, proxy: BACKEND_PROXY },
});
