const path = require("node:path");

module.exports = {
  apps: [
    {
      name: "sparkle-agent",
      cwd: path.join(__dirname, "apps/agent"),
      script: "dist/index.js",
      interpreter: "node",
      exec_mode: "fork",
      instances: 1,
      env: {
        NODE_ENV: "production",
      },
    },
    {
      name: "sparkle-console",
      cwd: path.join(__dirname, "apps/console"),
      script: "dist/index.js",
      interpreter: "node",
      exec_mode: "fork",
      instances: 1,
      env: {
        NODE_ENV: "production",
      },
    },
    {
      // 前端：vite preview 托管 apps/web/dist（含 /auth、/llm、/health 反代到 agent，
      // 见 vite.config 的 preview.proxy）。未来若需独立静态网关进程，可替换这一项。
      name: "sparkle-web",
      cwd: path.join(__dirname, "apps/web"),
      script: "node_modules/.bin/vite",
      args: "preview --port 4173 --strictPort",
      interpreter: "none",
      exec_mode: "fork",
      instances: 1,
      env: {
        NODE_ENV: "production",
      },
    },
  ],
};
