import type { Effect, EffectHandler, EffectHandlerResult, Queue } from "@sparkle/agent-runtime";
import type { AgentEvent } from "../events/event.js";

/** `End` 工具产出的"挂起等待事件" Effect 的 type 字面量。 */
export const WAIT_FOR_EVENT_EFFECT_TYPE = "wait_for_event";

export interface WaitForEventEffect extends Effect {
  readonly type: typeof WAIT_FOR_EVENT_EFFECT_TYPE;
  /** 最长等待毫秒数；到点自 enqueue 一个 `wake` 解除本轮阻塞（每轮一次性超时，非固定间隔）。 */
  readonly maxWaitMs: number;
}

/**
 * 处理 `wait_for_event` Effect：阻塞在事件 Queue 上直到非空，是主循环"无事可做
 * 就挂起"的全部机制——没有轮询、没有 tick。
 *
 * 用 `waitNonEmpty()`（不消费）而非 `take()`：唤醒它的那条事件留在 Queue 里，
 * 由下一轮 `runOnce` 的 drain 步骤消费。任何 producer 都能唤醒它——真实事件、
 * maxWaitMs 超时定时器塞的 `wake`、或优雅停机塞的 `wake`，对等待方无差别。
 */
export class WaitForEventHandler implements EffectHandler {
  private readonly queue: Queue<AgentEvent>;

  public constructor({ queue }: { queue: Queue<AgentEvent> }) {
    this.queue = queue;
  }

  public matches(effect: Effect): boolean {
    return effect.type === WAIT_FOR_EVENT_EFFECT_TYPE;
  }

  public async handle(effect: Effect): Promise<EffectHandlerResult> {
    const wait = effect as WaitForEventEffect;
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      timer = setTimeout(() => {
        this.queue.enqueue({ type: "wake" });
      }, wait.maxWaitMs);
      await this.queue.waitNonEmpty();
    } finally {
      if (timer !== undefined) {
        clearTimeout(timer);
      }
    }
    return {};
  }
}
