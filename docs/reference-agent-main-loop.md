# 参考：Agent 主循环

`apps/agent` 内的常驻 agent 主循环("AI 员工")的技术参考。列出 HTTP 端点、模块公开面、
关键类型与配置。设计动机见 [解释：Agent 主循环](explanation-agent-main-loop.md);
上手运行见 [How-to：运行并驱动 agent](howto-run-and-drive-agent.md)。

当前为 walking skeleton：内存态对话、单一 `End` 工具、事件从 debug HTTP 端点进(未来接飞书)。

## HTTP 端点

两个端点由 [`registerAgentRoutes`](../apps/agent/src/agent/http/agent-routes.ts) 注册在
agent 后端(默认 `services.agent.port` = 20003)。

### `POST /agent/event`

向主循环投递一个事件,唤醒(或喂给)loop。异步消费,不等 loop 处理完。

- 请求体(zod 校验,仅接受 `user_message`):

  ```json
  { "type": "user_message", "content": "你好" }
  ```

  | 字段      | 类型             | 约束                                          |
  | --------- | ---------------- | --------------------------------------------- |
  | `type`    | `"user_message"` | 字面量,必填。`wake` 是内部信号,不接受外部投递 |
  | `content` | string           | 必填,`min(1)`,空串被拒                        |

- 响应:`202 Accepted`,body `{ "accepted": true }`。
- 校验失败:请求体不匹配 schema 时 `AgentEventSchema.parse` 抛错,由后端错误处理器
  归一为 HTTP 错误响应。

### `GET /agent/transcript`

读取内存 context 的消息列表,用于验证 loop 真的在转、看到助手回复。

- 响应:`200`,body `{ "messages": LlmMessage[] }`。消息按追加顺序返回(user / assistant /
  tool 三态)。
- 因为回复在本轮 commit 后立即写入 context(见 [解释文档](explanation-agent-main-loop.md)
  的"commit 后挂起"),发一条 `user_message` 后再 GET 就能看到对应的助手回复,无需第二个事件。

## 模块公开面(`apps/agent/src/agent/`)

### `RootLoopAgent`

[`runtime/root-loop-agent.ts`](../apps/agent/src/agent/runtime/root-loop-agent.ts)。
继承 `@sparkle/agent-runtime` 的 `BaseLoopAgent`,是具体的常驻主循环。

构造入参(全部注入,便于测试):

| 参数              | 类型                                       | 说明                                           |
| ----------------- | ------------------------------------------ | ---------------------------------------------- |
| `model`           | `ReActModel<"agent", RootAgentCompletion>` | LLM 适配,通常由 `createAgentReActModel` 产出   |
| `interpreter`     | `EffectInterpreter`                        | v1 用 `NoopEffectInterpreter`(工具不产 effect) |
| `context`         | `AgentContext`                             | 对话上下文,v1 用 `InMemoryAgentContext`        |
| `queue`           | `Queue<AgentEvent>`                        | 事件队列,v1 用 `InMemoryQueue`                 |
| `tools`           | `ToolExecutor`                             | 工具集,v1 为 `[End]`                           |
| `logger`          | `AgentLogger`                              | 结构化日志端口(`AppLogger` 结构上满足)         |
| `errorBackoffMs?` | number                                     | 单轮失败后的退避毫秒,默认 `1000`               |

生命周期:

- `start(): Promise<void>` — 启动无限循环,日志 `event: "agent.loop.started"`。一直 await
  内部 runLoop,调用方用 `void agent.start()` fire-and-forget。
- `stop(): Promise<void>` — 请求停止(`onStopRequested` 向队列 enqueue 一个 `wake` 解除阻塞),
  await 循环退出。

一轮(`runOnce`)语义:drain 事件队列 → **仅当存在未处理用户输入时**跑一轮 ReAct → 本轮
commit(助手回复写入 context)→ 无未处理输入则阻塞在事件队列上等下一个事件。单轮抛错时
记 `event: "agent.round.failed"`、退避后重试(退避期间每 50ms 探 `stopRequested`)。

### `EndTool`

[`tools/end.tool.ts`](../apps/agent/src/agent/tools/end.tool.ts)。工具名 `End`,`kind: "control"`,
无参数(非 strict,模型塞多余字段会被 strip)。返回非空 content、**不产任何 effect、不在
工具内阻塞**。`toolChoice: "required"` 下模型每轮必调一个工具;v1 只有 `End`。

### `AgentEvent`

[`events/event.ts`](../apps/agent/src/agent/events/event.ts)。

```ts
type AgentEvent =
  | { readonly type: "user_message"; readonly content: string }
  | { readonly type: "wake" };
```

`wake` 仅进程内部产生(当前仅优雅停机),drain 时丢弃,不产生 context 变更。

### `AgentContext` / `InMemoryAgentContext`

[`context/in-memory-agent-context.ts`](../apps/agent/src/agent/context/in-memory-agent-context.ts)。

- `getSnapshot(): { systemPrompt?: string; messages: LlmMessage[] }` — 返回 messages 的拷贝。
- `appendUserMessage(content: string): void`
- `appendMessages(messages: readonly LlmMessage[]): void`

v1 为纯内存,重启即丢(持久化是 follow-up)。

### `createAgentReActModel({ llmClient })`

[`model/llm-client-react-model.ts`](../apps/agent/src/agent/model/llm-client-react-model.ts)。
把 `@sparkle/llm-client` 的 `LlmClient` 适配成 kernel 的 `ReActModel`,透传 `usage: "agent"`。

### `renderMainSystemPrompt()`

[`system-prompt/render.ts`](../apps/agent/src/agent/system-prompt/render.ts)。从 handlebars
模板 [`main-system-prompt.hbs`](../apps/agent/src/agent/system-prompt/main-system-prompt.hbs)
渲染 system prompt。v1 无动态变量;`build` 脚本把 `.hbs` 拷进 `dist`。

## 配置

- `server.llm.usages.agent`:主 agent 的多 attempt 路由(见 `config.yaml.example`)。
- system prompt 目前来自模板文件,非 config 字段。

## Related

- [解释:Agent 主循环](explanation-agent-main-loop.md) — 为什么这么设计、与 kagami 的关系、收敛路线
- [How-to:运行并驱动 agent](howto-run-and-drive-agent.md) — 跑起来、投递事件、验证
- 复用的 kernel 原语:`@sparkle/agent-runtime`(`ReActKernel` / `BaseLoopAgent` / `Queue` / effects)
