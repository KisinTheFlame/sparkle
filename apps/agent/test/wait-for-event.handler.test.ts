import { describe, expect, it } from "vitest";
import { InMemoryQueue } from "@sparkle/agent-runtime";
import type { AgentEvent } from "../src/agent/events/event.js";
import {
  WAIT_FOR_EVENT_EFFECT_TYPE,
  WaitForEventHandler,
} from "../src/agent/runtime/wait-for-event.handler.js";

const tick = (ms = 10): Promise<void> => new Promise(resolve => setTimeout(resolve, ms));

describe("WaitForEventHandler — 主循环的挂起机制", () => {
  it("空 Queue 上阻塞，直到 enqueue 唤醒；且不消费唤醒它的事件", async () => {
    const queue = new InMemoryQueue<AgentEvent>();
    const handler = new WaitForEventHandler({ queue });

    let resolved = false;
    const pending = handler
      .handle({ type: WAIT_FOR_EVENT_EFFECT_TYPE, maxWaitMs: 60_000 })
      .then(() => {
        resolved = true;
      });

    await tick();
    expect(resolved).toBe(false); // 仍阻塞

    queue.enqueue({ type: "user_message", content: "x" });
    await pending;
    expect(resolved).toBe(true);

    // waitNonEmpty 不消费：唤醒它的事件留给下一轮 drain。
    expect(queue.size()).toBe(1);
    expect(queue.dequeue()).toEqual({ type: "user_message", content: "x" });
  });

  it("Queue 已非空时立即返回", async () => {
    const queue = new InMemoryQueue<AgentEvent>();
    queue.enqueue({ type: "user_message", content: "ready" });
    const handler = new WaitForEventHandler({ queue });

    await expect(
      handler.handle({ type: WAIT_FOR_EVENT_EFFECT_TYPE, maxWaitMs: 60_000 }),
    ).resolves.toEqual({});
    expect(queue.size()).toBe(1);
  });

  it("maxWaitMs 到点自塞一个 wake 解除阻塞（周期性唤醒）", async () => {
    const queue = new InMemoryQueue<AgentEvent>();
    const handler = new WaitForEventHandler({ queue });

    await handler.handle({ type: WAIT_FOR_EVENT_EFFECT_TYPE, maxWaitMs: 20 });

    expect(queue.size()).toBe(1);
    expect(queue.dequeue()).toEqual({ type: "wake" });
  });
});
