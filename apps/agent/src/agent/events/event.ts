/**
 * 主循环的输入事件。外部 producer（本轮是 debug 注入端点，未来是飞书）把事件
 * enqueue 进事件 Queue，loop 在每轮开头 drain 它们。
 *
 * - `user_message`：外部用户消息，drain 时转成一条 user message 进 context。
 * - `wake`：纯唤醒信号（当前仅来自优雅停机 stop()）。drain 时不产生任何 context
 *   变更——它的唯一作用是让阻塞在事件 Queue 上的 runOnce 解除阻塞，使 loop 能在
 *   stopRequested=true 后及时退出。
 */
export type AgentEvent =
  | { readonly type: "user_message"; readonly content: string }
  | { readonly type: "wake" };
