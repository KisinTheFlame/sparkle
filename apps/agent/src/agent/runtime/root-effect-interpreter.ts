import {
  HandlerEffectInterpreter,
  type EffectInterpreter,
  type Queue,
} from "@sparkle/agent-runtime";
import type { AgentEvent } from "../events/event.js";
import { WaitForEventHandler } from "./wait-for-event.handler.js";

/**
 * 主循环的 EffectInterpreter。v1 只认 `wait_for_event`（End 工具产的挂起信号）。
 * 后续接入 apps/invoke、context 压缩时，往这里加对应 handler 即可（见 issue 的
 * Out of Scope）。
 */
export function createRootEffectInterpreter({
  queue,
}: {
  queue: Queue<AgentEvent>;
}): EffectInterpreter {
  return new HandlerEffectInterpreter([new WaitForEventHandler({ queue })]);
}
