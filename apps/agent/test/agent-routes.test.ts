import { describe, expect, it } from "vitest";
import Fastify from "fastify";
import { InMemoryQueue } from "@sparkle/agent-runtime";
import type { AgentEvent } from "../src/agent/events/event.js";
import { InMemoryAgentContext } from "../src/agent/context/in-memory-agent-context.js";
import { AgentEventSchema, registerAgentRoutes } from "../src/agent/http/agent-routes.js";

function buildApp(): {
  app: ReturnType<typeof Fastify>;
  queue: InMemoryQueue<AgentEvent>;
  context: InMemoryAgentContext;
} {
  const app = Fastify();
  const queue = new InMemoryQueue<AgentEvent>();
  const context = new InMemoryAgentContext({ systemPrompt: "SYS" });
  registerAgentRoutes(app, { queue, context });
  return { app, queue, context };
}

describe("agent routes", () => {
  it("POST /agent/event 接受 user_message：202 且事件入队", async () => {
    const { app, queue } = buildApp();
    const response = await app.inject({
      method: "POST",
      url: "/agent/event",
      payload: { type: "user_message", content: "hi" },
    });

    expect(response.statusCode).toBe(202);
    expect(response.json()).toEqual({ accepted: true });
    expect(queue.size()).toBe(1);
    expect(queue.dequeue()).toEqual({ type: "user_message", content: "hi" });
  });

  it("GET /agent/transcript 返回内存 context 的消息列表", async () => {
    const { app, context } = buildApp();
    context.appendUserMessage("hello");

    const response = await app.inject({ method: "GET", url: "/agent/transcript" });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ messages: [{ role: "user", content: "hello" }] });
  });

  it("AgentEventSchema 只接受 user_message；wake 与非法输入都被拒（内部信号不走 HTTP）", () => {
    expect(AgentEventSchema.safeParse({ type: "user_message", content: "hi" }).success).toBe(true);
    // wake 是内部信号，不接受外部 HTTP 投递（防 LLM 放大器 / 空 context 忙等）。
    expect(AgentEventSchema.safeParse({ type: "wake" }).success).toBe(false);
    // 空 content 与未知 type 都应被拒。
    expect(AgentEventSchema.safeParse({ type: "user_message", content: "" }).success).toBe(false);
    expect(AgentEventSchema.safeParse({ type: "nope" }).success).toBe(false);
  });
});
