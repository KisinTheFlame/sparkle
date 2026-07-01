# 解释：Agent 主循环的设计

这篇讲**为什么**主循环是现在这个样子:反应式循环、commit 后挂起、`pendingUserInput`
不变量,以及它跟参考实现 kagami 的关系与后续收敛路线。接口细节见
[参考文档](reference-agent-main-loop.md)。

## 要解决的问题

我们要一个常驻的"AI 员工":进程起来后一直在,有外部事件(用户消息)就醒来处理、没事就
挂起,不空转烧 token,也不因为一次故障就死掉。难点有三个,都很具体:

1. **不能空转。** 一个每隔几秒就调一次 LLM 的 while 循环会烧光额度。
2. **不能假死。** 常驻循环里任何一次 LLM 报错(429/500/网络)如果一路抛出去,循环就永久
   结束了 —— "常驻"就成了空话。
3. **回复要能被看到。** 发一条消息,用户(或验证用的 `GET /agent/transcript`)得能拿到回复。

## 采用的做法

### 反应式循环:只有新输入才跑一轮

循环体 [`RootLoopAgent.runOnce`](../apps/agent/src/agent/runtime/root-loop-agent.ts) 是:

```
drain 事件队列  →  有未处理用户输入?
                     ├─ 否 → 阻塞在事件队列上,等下一个事件(不调 LLM)
                     └─ 是 → 跑一轮 ReAct → commit → (回到顶部)
```

判据是一个显式标志 `pendingUserInput`:drain 到 `user_message` 置真,一轮成功 commit 后清零。
没有轮询、没有 tick、没有"心跳"。循环空闲 = 阻塞在事件队列上。这一条不变量同时挡掉三类
空转:boot 后没输入、上一轮已响应完、纯 `wake` 信号(无新输入)。

### commit 之后再挂起(不在工具里阻塞)

kernel 一轮的执行顺序是 `模型 → 执行工具 → 解释 effect → 返回 → commit`。一个很自然但错误的
写法是:让 `End`/`wait` 工具产一个"等事件"的 effect,在 effect 解释阶段阻塞。问题在于这个阻塞
发生在 commit **之前** —— 助手回复生成了却迟迟不写进 context,发一条消息后 transcript 半天
看不到回复,像卡住(这是 /review 里 Codex 抓到的真 bug)。

所以挂起点放在 commit **之后**的 `runOnce` 里:`End` 只是"结束发言"的信号,不产 effect、不阻塞,
本轮照常 commit(回复立即可见),然后循环回到顶部、无新输入就阻塞。

### 对错误有韧性

`runOnce` 里那一轮包在 try/catch 里:出错记 `agent.round.failed`、退避后继续,触发本轮的用户
消息因为没 commit 仍是"未处理",下一轮重试同一上下文。退避完整等满(provider 故障时不被
事件洪流冲垮成即时重试),但每 50ms 探一次 `stopRequested`,让停机及时退出。

## 取舍

- **反应式 vs 自主。** 现在只对用户输入起反应,不做自主/周期性工作。换来的是简单和零空转;
  代价是"AI 员工主动做事"要等后续(自己往队列 enqueue 事件)。
- **挂起在循环里 vs 挂起在工具里。** 我们选前者。好处:commit 先于挂起,回复即时可见,且不依赖
  输出是"推送"的。代价:偏离了 kagami "挂起活在工具里"的范式(见下),如果将来想让某个工具在
  turn 中途等一个异步结果,还得再引入轮内挂起机制。
- **内存态 vs 持久化。** walking skeleton 用内存,重启丢对话。换来最快跑通;持久化是 follow-up。

## 与 kagami 的关系

框架层(`@sparkle/agent-runtime`:`ReActKernel`、`BaseLoopAgent`、Tool/App、effects、`Queue`)
基本是从 kagami 的 `@kagami/agent-runtime` 港过来的,domain-agnostic,可直接复用。但**具体主
agent 不能直接抄** —— kagami 的主 agent 焊死在它的业务上:NapCat/QQ 网关、story agent + 向量
召回、Prisma/SQLite 的 ledger+snapshot 表、8 个具体 app、app 切换状态机。照搬等于把这一整套
拖进来。所以我们建了个跟当前形态匹配的薄骨架。

**一个关键差异**解释了为什么我们要在"commit 后挂起"上跟 kagami 分叉:

- **kagami 是 push 输出。** 回复经 `send_message` 工具**在轮内**直接推给 QQ,用户当场就看到。
  所以就算轮内阻塞、commit 晚一点,也无所谓 —— commit 延迟被推送掩盖了。
- **sparkle v1 是 pull 输出。** 没有推送通道,输出靠读**已 commit** 的 transcript。于是"轮内
  阻塞推迟 commit"在 kagami 里无害,到我们这就变成可见 bug。

顺带一提,"只有新输入才跑一轮"这条我们用 `pendingUserInput` 实现,和 kagami 的
`session.shouldTriggerRound`(纯 `wake` 返回 `false`、不触发轮)是殊途同归。

## 后续收敛路线(从 kagami 逐件移植)

随着飞书接入,会自然向 kagami 的形状靠拢。大致顺序:

1. **飞书通道(push 输出 + 事件 producer)** —— 加一个 push 式 `send_message`(飞书发消息),
   用飞书事件替换 debug 注入端点。这是解锁真实使用的第一步。
2. **Prisma ledger 持久化 + 启动快照恢复** —— 重启不丢对话。对应 kagami 的
   `LinearMessageLedgerAgentContext` + snapshot repository。
3. **context 压缩** —— 长对话下压缩最旧一段。`ReplaceLeadingMessagesEffect` 已在 agent-runtime,
   需接一个 SummaryOperation。
4. **apps/invoke 框架** —— `enter`/`switch`/`back`/`invoke` 元工具 + `AppManager`,让 agent 进 app
   用子工具。原语已有,缺具体 app 和 session 状态机。
5. **异步子 agent** —— `AsyncTaskManager` 接线 + `search_web` 类工具(隔离 context、只回摘要)。
6. **鉴权** —— 目前 debug 端点无鉴权、绑 `0.0.0.0`(与后端其它端点一致,本地 dev 用)。真正的
   鉴权层跟飞书接入一起做。

story agent + 向量召回那套跟 kagami 业务耦合最深,大概率不照搬 —— 要看我们要不要"记忆"能力。

## Related

- [参考:Agent 主循环](reference-agent-main-loop.md) — 端点与模块公开面
- [How-to:运行并驱动 agent](howto-run-and-drive-agent.md) — 跑起来验证
