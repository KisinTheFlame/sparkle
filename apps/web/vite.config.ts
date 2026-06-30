import react from "@vitejs/plugin-react";
import path from "node:path";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
      "@sparkle/shared": path.resolve(__dirname, "../../packages/shared/src"),
    },
  },
  server: {
    // 开发期把后端路由代理到 agent 后端，避免跨域；生产同源部署时无需此配置。
    proxy: {
      "/auth": "http://localhost:20003",
      "/llm": "http://localhost:20003",
      "/health": "http://localhost:20003",
    },
  },
});
