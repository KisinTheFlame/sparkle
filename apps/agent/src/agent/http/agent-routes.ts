import type { FastifyInstance } from "fastify";
import { z } from "zod";
import type { Queue } from "@sparkle/agent-runtime";
import type { AgentEvent } from "../events/event.js";
import type { AgentContext } from "../context/in-memory-agent-context.js";

/**
 * HTTP 只接受 `user_message`。`wake` 是内部信号（End 超时定时器 / 停机），由进程
 * 内部直接 enqueue——刻意不暴露给外部：否则每个 HTTP `wake` 都会触发一轮对不变
 * 上下文的 LLM 调用（无意义的放大器），还会在空 context 时诱发忙等。
 */
export const AgentEventSchema = z.object({
  type: z.literal("user_message"),
  content: z.string().min(1),
});

/**
 * 注册主循环的 HTTP 端点。与组装根解耦——只依赖事件 Queue 和 context 两个端口，
 * 便于单测直接 inject，不必启动整套 composition root。
 *
 * - `POST /agent/event`：投递事件进 Queue（唤醒/喂给 loop），返回 202。本轮是
 *   debug 注入口，未来由飞书事件取代。
 * - `GET /agent/transcript`：读内存 context 消息列表，供验证 loop 真的转了。
 */
export function registerAgentRoutes(
  app: FastifyInstance,
  { queue, context }: { queue: Queue<AgentEvent>; context: AgentContext },
): void {
  app.post("/agent/event", async (request, reply) => {
    const event = AgentEventSchema.parse(request.body);
    queue.enqueue(event);
    return reply.code(202).send({ accepted: true });
  });

  app.get("/agent/transcript", () => {
    return { messages: context.getSnapshot().messages };
  });
}
