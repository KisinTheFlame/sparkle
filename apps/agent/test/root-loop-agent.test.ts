import { describe, expect, it, vi } from "vitest";
import {
  InMemoryQueue,
  NoopEffectInterpreter,
  ToolCatalog,
  type ReActModel,
  type ReActKernelRunRoundInput,
} from "@sparkle/agent-runtime";
import type { AgentEvent } from "../src/agent/events/event.js";
import { InMemoryAgentContext } from "../src/agent/context/in-memory-agent-context.js";
import { EndTool, END_TOOL_NAME } from "../src/agent/tools/end.tool.js";
import { RootLoopAgent } from "../src/agent/runtime/root-loop-agent.js";
import type { RootAgentCompletion, RootAgentUsage } from "../src/agent/runtime/types.js";

async function waitFor(predicate: () => boolean, timeoutMs = 2000): Promise<void> {
  const start = Date.now();
  while (!predicate()) {
    if (Date.now() - start > timeoutMs) {
      throw new Error("waitFor timed out");
    }
    await new Promise(resolve => setTimeout(resolve, 5));
  }
}

describe("RootLoopAgent — 主循环端到端：两条事件触发两轮，证明 loop 在转", () => {
  it("drain→跑轮→commit→挂起→被新事件唤醒→再跑轮", async () => {
    const queue = new InMemoryQueue<AgentEvent>();
    const context = new InMemoryAgentContext({ systemPrompt: "SYS" });
    const tools = new ToolCatalog([new EndTool()]).pick([END_TOOL_NAME]);
    const interpreter = new NoopEffectInterpreter();
    const logger = { info: vi.fn(), errorWithCause: vi.fn() };

    const calls: ReActKernelRunRoundInput<RootAgentUsage>["usage"][] = [];
    const seenTools: string[][] = [];
    const seenToolChoice: string[] = [];
    const seenSystem: (string | undefined)[] = [];
    const model: ReActModel<RootAgentUsage, RootAgentCompletion> = {
      chat: async (request, options) => {
        calls.push(options.usage);
        seenTools.push(request.tools.map(tool => tool.name));
        seenToolChoice.push(request.toolChoice);
        seenSystem.push(request.system);
        return {
          message: {
            role: "assistant",
            content: `reply ${calls.length}`,
            toolCalls: [{ id: `c${calls.length}`, name: END_TOOL_NAME, arguments: {} }],
          },
        };
      },
    };

    const agent = new RootLoopAgent({ model, interpreter, context, queue, tools, logger });

    // 事件先入队，再启动：第一轮 drain 就能拿到它。
    queue.enqueue({ type: "user_message", content: "hi" });
    void agent.start();

    // 第一轮：模型被调一次、回复 commit，随后 loop 挂起等下一个事件。
    await waitFor(() => calls.length >= 1);
    expect(calls[0]).toBe("agent");
    expect(seenToolChoice[0]).toBe("required");
    expect(seenTools[0]).toEqual([END_TOOL_NAME]);
    expect(seenSystem[0]).toBe("SYS");

    // 投递第二条事件唤醒挂起的 loop → 第二轮运行。
    queue.enqueue({ type: "user_message", content: "again" });
    await waitFor(() => calls.length >= 2);

    await agent.stop();

    // 两轮都跑过 → loop 确实在转。
    expect(calls.length).toBeGreaterThanOrEqual(2);

    const contents = context
      .getSnapshot()
      .messages.map(message => ("content" in message ? message.content : ""));
    expect(contents).toContain("hi");
    expect(contents).toContain("reply 1");
    expect(contents).toContain("again");
    expect(contents).toContain("reply 2");

    expect(logger.info).toHaveBeenCalledWith("agent loop started", { event: "agent.loop.started" });
  });

  it("单条消息即 commit 回复、无需第二个事件（Codex P2 回归）", async () => {
    const queue = new InMemoryQueue<AgentEvent>();
    const context = new InMemoryAgentContext({ systemPrompt: "SYS" });
    const tools = new ToolCatalog([new EndTool()]).pick([END_TOOL_NAME]);
    const interpreter = new NoopEffectInterpreter();
    const logger = { info: vi.fn(), errorWithCause: vi.fn() };

    let callCount = 0;
    const model: ReActModel<RootAgentUsage, RootAgentCompletion> = {
      chat: async () => {
        callCount += 1;
        return {
          message: {
            role: "assistant",
            content: "the reply",
            toolCalls: [{ id: "c1", name: END_TOOL_NAME, arguments: {} }],
          },
        };
      },
    };

    const agent = new RootLoopAgent({ model, interpreter, context, queue, tools, logger });
    queue.enqueue({ type: "user_message", content: "hi" });
    void agent.start();

    // 关键：只发一条消息，回复应在挂起前就 commit，transcript 立刻可见——不用第二个事件。
    await waitFor(() =>
      context.getSnapshot().messages.some(m => "content" in m && m.content === "the reply"),
    );
    // 再等一会，确认空闲不会重复调 LLM（无新输入 → 挂起）。
    await new Promise(resolve => setTimeout(resolve, 60));
    await agent.stop();

    const contents = context
      .getSnapshot()
      .messages.map(message => ("content" in message ? message.content : ""));
    expect(contents).toContain("hi");
    expect(contents).toContain("the reply");
    expect(callCount).toBe(1);
  });

  it("boot 后无事件时不调 LLM（阻塞等首个事件），首个事件到达才跑第一轮", async () => {
    const queue = new InMemoryQueue<AgentEvent>();
    const context = new InMemoryAgentContext({ systemPrompt: "SYS" });
    const tools = new ToolCatalog([new EndTool()]).pick([END_TOOL_NAME]);
    const interpreter = new NoopEffectInterpreter();
    const logger = { info: vi.fn(), errorWithCause: vi.fn() };

    let callCount = 0;
    const model: ReActModel<RootAgentUsage, RootAgentCompletion> = {
      chat: async () => {
        callCount += 1;
        return {
          message: {
            role: "assistant",
            content: "hello",
            toolCalls: [{ id: "c1", name: END_TOOL_NAME, arguments: {} }],
          },
        };
      },
    };

    const agent = new RootLoopAgent({ model, interpreter, context, queue, tools, logger });
    void agent.start();

    // 没有事件：给它一点时间，确认 LLM 一次都没被调（空轮被挡住）。
    await new Promise(resolve => setTimeout(resolve, 50));
    expect(callCount).toBe(0);

    // 首个事件到达 → 第一轮真正运行。
    queue.enqueue({ type: "user_message", content: "hi" });
    await waitFor(() => callCount >= 1);

    await agent.stop();
    expect(callCount).toBeGreaterThanOrEqual(1);
  });

  it("assistant content 为空时不记 agent.turn 日志（logTurn 空内容分支）", async () => {
    const queue = new InMemoryQueue<AgentEvent>();
    const context = new InMemoryAgentContext({ systemPrompt: "SYS" });
    const tools = new ToolCatalog([new EndTool()]).pick([END_TOOL_NAME]);
    const interpreter = new NoopEffectInterpreter();
    const logger = { info: vi.fn(), errorWithCause: vi.fn() };

    let callCount = 0;
    const model: ReActModel<RootAgentUsage, RootAgentCompletion> = {
      chat: async () => {
        callCount += 1;
        return {
          message: {
            role: "assistant",
            content: "",
            toolCalls: [{ id: "c1", name: END_TOOL_NAME, arguments: {} }],
          },
        };
      },
    };

    const agent = new RootLoopAgent({ model, interpreter, context, queue, tools, logger });
    queue.enqueue({ type: "user_message", content: "hi" });
    void agent.start();
    await waitFor(() => callCount >= 1);
    await agent.stop();

    const turnLogged = logger.info.mock.calls.some(call => call[0] === "agent turn");
    expect(turnLogged).toBe(false);
  });

  it("model.chat 抛错时不杀死常驻 loop：记录 errorWithCause 并退避后重试", async () => {
    const queue = new InMemoryQueue<AgentEvent>();
    const context = new InMemoryAgentContext({ systemPrompt: "SYS" });
    const tools = new ToolCatalog([new EndTool()]).pick([END_TOOL_NAME]);
    const interpreter = new NoopEffectInterpreter();
    const logger = { info: vi.fn(), errorWithCause: vi.fn() };

    let callCount = 0;
    const model: ReActModel<RootAgentUsage, RootAgentCompletion> = {
      chat: async () => {
        callCount += 1;
        throw new Error("boom");
      },
    };

    const agent = new RootLoopAgent({
      model,
      interpreter,
      context,
      queue,
      tools,
      logger,
      errorBackoffMs: 5,
    });

    let loopRejected = false;
    queue.enqueue({ type: "user_message", content: "hi" });
    void agent.start().catch(() => {
      loopRejected = true;
    });

    // 重试到第二次 → 证明第一次错误没让 loop 永久死亡。
    await waitFor(() => callCount >= 2);
    await agent.stop();

    expect(loopRejected).toBe(false);
    const failLogged = logger.errorWithCause.mock.calls.some(
      call => call[0] === "agent round failed",
    );
    expect(failLogged).toBe(true);
  });
});
