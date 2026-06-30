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
      // 前端：vite preview 托管 apps/web/dist（含 /auth、/llm、/health 反代到 agent）。
      // 监听端口与上游地址全部自读 config.yaml 的 services 块（见 vite.config.ts），
      // ecosystem 不再持任何端口/地址（服务寻址单源）。
      name: "sparkle-web",
      cwd: path.join(__dirname, "apps/web"),
      script: "node_modules/.bin/vite",
      args: "preview",
      interpreter: "none",
      exec_mode: "fork",
      instances: 1,
      env: {
        NODE_ENV: "production",
      },
    },
  ],
};
