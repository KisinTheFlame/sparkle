// PM2 进程编排（服务寻址单源：端口/上游地址由各 app 自读 config.yaml 的 services 块，
// 此文件不持有任何端口/地址）。当前 apps 目录为空——这是从 Kagami 复制过来的基建骨架，
// 新增 app 后在此登记一个条目（参考 Kagami 的 ecosystem.config.cjs 结构）：
//   { name: "sparkle-xxx", cwd: path.join(__dirname, "apps/xxx"),
//     script: "dist/index.js", interpreter: "node", exec_mode: "fork", instances: 1,
//     env: { NODE_ENV: "production" } }
module.exports = {
  apps: [],
};
