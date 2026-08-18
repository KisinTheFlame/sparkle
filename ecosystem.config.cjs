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
      // 主循环崩溃时 agent 会 fail-fast 非零退出（见 apps/agent/src/index.ts fatalExit），靠 PM2
      // 拉起干净新进程重放快照。指数退避重启：反复崩溃（如上下文被毒化的确定性 crash）时重启间隔从
      // 100ms 逐步拉长，避免暴力 crash-loop 打满 CPU / 刷爆日志；恢复正常后自动清零。
      exp_backoff_restart_delay: 100,
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
      // 前门网关：纯反向代理——/api 按前缀分流到各后端，其余转给 sparkle-web（#578）。监听端口
      // 与上游地址全部自读 config.yaml 的 services 块，ecosystem 不再持有任何端口/地址（见 issue #162）。
      name: "sparkle-gateway",
      cwd: path.join(__dirname, "apps/gateway"),
      script: "dist/index.js",
      interpreter: "node",
      exec_mode: "fork",
      instances: 1,
      env: {
        NODE_ENV: "production",
      },
    },
    {
      // 管理台前端进程：自持静态托管（dist/server 发 dist/client），只绑回环、只由 gateway 反代。
      // 与 gateway 拆开后两者生命周期独立：重载前端不动网关，反之亦然（#578）。
      name: "sparkle-web",
      cwd: path.join(__dirname, "apps/web"),
      script: "dist/server/index.js",
      interpreter: "node",
      exec_mode: "fork",
      instances: 1,
      env: {
        NODE_ENV: "production",
      },
    },
    {
      name: "sparkle-oss",
      cwd: path.join(__dirname, "apps/oss"),
      script: "dist/index.js",
      interpreter: "node",
      exec_mode: "fork",
      instances: 1,
      env: {
        NODE_ENV: "production",
      },
    },
    {
      // metric 领域进程：独立 PM2 生命周期，一手包办 metric 摄取（agent HTTP 上报）+ metric-chart
      // 查询。监听端口自读 config.yaml 的 services.metric（默认 20010，仅 localhost）。
      name: "sparkle-metric",
      cwd: path.join(__dirname, "apps/metric"),
      script: "dist/index.js",
      interpreter: "node",
      exec_mode: "fork",
      instances: 1,
      env: {
        NODE_ENV: "production",
      },
    },
    {
      // 浏览器进程：独立 PM2 生命周期，agent 重启不杀它（issue #173）。cwd 固定为仓库根，
      // 让 userDataDir(data/browser/default) 落在仓库根 data/ 下，登录态跨 agent 重启留存。
      name: "sparkle-browser",
      cwd: __dirname,
      script: "apps/browser/dist/index.js",
      interpreter: "node",
      exec_mode: "fork",
      instances: 1,
      env: {
        NODE_ENV: "production",
      },
    },
    {
      // LLM 网关 + OAuth 凭据中心：独立 PM2 生命周期，agent 重启不打断它与登录态。持有全部
      // provider + OAuth callback server（绑 1455/54545），未来多个 Agent 进程共享它。cwd 固定
      // 仓库根，让任何相对数据路径（DB / secret store）落在仓库根 data/ 下。
      name: "sparkle-llm",
      cwd: __dirname,
      script: "apps/llm/dist/index.js",
      interpreter: "node",
      exec_mode: "fork",
      instances: 1,
      env: {
        NODE_ENV: "production",
      },
    },
    {
      // 飞书接入：独立 PM2 生命周期，agent 重启不断到飞书开放平台的 WS 长连接。
      // 持有出站 RPC + 入站事件落库/SSE；cwd 固定仓库根，读同一 config.yaml / 自有 SQLite。
      name: "sparkle-feishu",
      cwd: __dirname,
      script: "apps/feishu/dist/index.js",
      interpreter: "node",
      exec_mode: "fork",
      instances: 1,
      env: {
        NODE_ENV: "production",
      },
    },
    {
      // 通用定时调度服务：独立 PM2 生命周期，agent 重启不打断计时节奏（issue #428）。通用薄时钟，
      // 无 DB、无业务语义——使用方（agent）经 SchedulerClient 注册任务、经 SSE 收 tick，业务逻辑全在
      // 使用方。cwd 固定仓库根，读同一 config.yaml（services.scheduler 端口）。
      name: "sparkle-scheduler",
      cwd: __dirname,
      script: "apps/scheduler/dist/index.js",
      interpreter: "node",
      exec_mode: "fork",
      instances: 1,
      env: {
        NODE_ENV: "production",
      },
    },
  ],
};
