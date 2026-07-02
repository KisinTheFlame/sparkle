# How-to：运行并驱动 agent 主循环

本文带你把 agent 后端跑起来,给主循环投递一条消息,并确认它产出了回复。端点契约见
[参考文档](reference-agent-main-loop.md),设计动机见 [解释文档](explanation-agent-main-loop.md)。

## 前置

- 已装依赖:仓库根 `pnpm install`。
- 有 `config.yaml`:`cp config.yaml.example config.yaml`(按需改)。
- 数据库已建表:`pnpm --filter @sparkle/db db:migrate:deploy`(日志/调用落库需要)。
- **已完成 claude-code OAuth 登录**(主循环第一轮就会真调 LLM,没登录会失败)。登录见下。

## 步骤

1. 启动 agent 后端(dev,tsx watch):

   ```bash
   pnpm --filter @sparkle/agent dev
   ```

   启动后日志会出现 `event: "server.started"`(端口 `services.agent.port`,默认 20003)和
   `event: "agent.loop.started"`。此时主循环已在跑,但因为还没有用户输入,阻塞在事件队列上、
   不调 LLM。

2. 完成 claude-code 登录(若尚未登录)。可用前端面板,或直接打端点:

   ```bash
   curl -s -XPOST localhost:20003/auth/claude-code/login   # 返回授权 URL
   curl -s localhost:20003/auth/claude-code/status          # 轮询状态
   ```

   在浏览器打开返回的授权 URL 完成授权(回调落在同机 `localhost:54545`)。

3. 向主循环投递一条用户消息:

   ```bash
   curl -s -XPOST localhost:20003/agent/event \
     -H 'content-type: application/json' \
     -d '{"type":"user_message","content":"你好,自我介绍一下"}'
   ```

   返回 `202` + `{"accepted":true}`。事件进队列 → 唤醒 loop → drain → 跑一轮 → 模型回复 →
   `End` 结束本轮 → commit(回复写进 context)→ 再次挂起等下一条。

## 验证

读 transcript,应能看到 user 消息和对应的 assistant 回复:

```bash
curl -s localhost:20003/agent/transcript | jq
```

期望 `messages` 里按顺序有 `{"role":"user",...}`、`{"role":"assistant",...}`、以及 `End` 的
`{"role":"tool",...}`。发一条消息即可看到回复,**不需要**再发第二条。后端日志里每次助手发言
也会有 `event: "agent.turn"`。

## Troubleshooting

- **`agent.loop.crashed` 日志、loop 没反应。** 通常是没登录 claude-code 或额度/网络问题导致
  第一轮 LLM 调用抛错。loop 本身对单轮错误有韧性(记 `agent.round.failed` 后退避重试),但若
  provider 持续失败会一直重试。先确认 `GET /auth/claude-code/status` 已登录。
- **`POST /agent/event` 返回错误。** body 必须是 `{"type":"user_message","content":"..."}`,
  `content` 不能为空;`{"type":"wake"}` 会被拒(内部信号不走 HTTP)。
- **transcript 只有 user 消息、没有 assistant 回复。** 说明那一轮没成功 commit —— 多半是 LLM
  调用报错(见第一条)。查后端日志的 `agent.round.failed`。
- **改了代码但没生效。** dev 是 `tsx watch`,一般自动重载;`@sparkle/agent-runtime` 等 workspace
  包若改了源码,按需 `pnpm -r build`。
- **停止。** `Ctrl+C`(SIGINT)会优雅停机:先停 loop 再关 HTTP,超时 10s 强退。

## Related

- [参考:Agent 主循环](reference-agent-main-loop.md)
- [解释:Agent 主循环的设计](explanation-agent-main-loop.md)
