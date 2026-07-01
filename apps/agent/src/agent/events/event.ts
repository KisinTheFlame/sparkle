/**
 * 主循环的输入事件。外部 producer（本轮是 debug 注入端点，未来是飞书）把事件
 * enqueue 进事件 Queue，loop 在每轮开头 drain 它们。
 *
 * - `user_message`：外部用户消息，drain 时转成一条 user message 进 context。
 * - `wake`：纯唤醒信号（来自 End 工具的 maxWaitMs 超时定时器、或优雅停机）。
 *   drain 时不产生任何 context 变更——它的唯一作用是让阻塞在 Queue 上的
 *   `wait_for_event` 解除阻塞，使本轮收尾、loop 进入下一轮。
 */
export type AgentEvent =
  | { readonly type: "user_message"; readonly content: string }
  | { readonly type: "wake" };
