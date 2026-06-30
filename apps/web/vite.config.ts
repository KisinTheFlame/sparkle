import react from "@vitejs/plugin-react";
import path from "node:path";
import { defineConfig } from "vite";

const AGENT_BACKEND = "http://localhost:20003";
const BACKEND_PROXY = {
  "/auth": AGENT_BACKEND,
  "/llm": AGENT_BACKEND,
  "/health": AGENT_BACKEND,
};

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
      "@sparkle/shared": path.resolve(__dirname, "../../packages/shared/src"),
    },
  },
  // dev（vite）与 preview（pm2 生产托管）都把后端路由反代到 agent 后端，避免跨域。
  server: { proxy: BACKEND_PROXY },
  preview: { proxy: BACKEND_PROXY },
});
