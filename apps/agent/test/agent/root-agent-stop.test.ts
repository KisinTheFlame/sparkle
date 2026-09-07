import { describe, expect, it, vi } from "vitest";
import { InMemoryQueue, type ToolExecutor } from "@sparkle/agent-runtime";
import { llmUpstreamCallFailedError, type LlmMessage } from "@sparkle/llm-client";
import { RootLoopAgent } from "../../src/agent/runtime/root-agent/root-agent-runtime.js";
import { initTestLoggerRuntime } from "../helpers/logger.js";

initTestLoggerRuntime();
const response = {
  provider: "openai",
  model: "m",
  message: { role: "assistant", content: "done", toolCalls: [] },
};
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(r => {
    resolve = r;
  });
  return { promise, resolve };
}
function makeAgent() {
  const messages: LlmMessage[] = [{ role: "user", content: "task" }];
  let revision = 0;
  const initializeContext = vi.fn(async () => {});
  const chat = vi.fn().mockResolvedValue(response);
  const invoke = vi.fn().mockResolvedValue("summary");
  const save = vi.fn(async (_snapshot: unknown) => {});
  const execute = vi
    .fn<ToolExecutor["execute"]>()
    .mockResolvedValue({ content: "done", kind: "business" });
  const agent = new RootLoopAgent({
    llmClient: { chat, listAvailableProviders: async () => [] },
    context: {
      getSnapshot: async () => ({ systemPrompt: "sys", messages: [...messages] }),
      getLastMessage: async () => messages.at(-1),
      getRevision: () => revision,
      exportPersistedSnapshot: async () => ({ messages: structuredClone(messages) }),
      appendMessages: async (items: LlmMessage[]) => {
        messages.push(...items);
        revision++;
      },
      appendAssistantTurn: async (message: LlmMessage) => {
        messages.push(message);
        revision++;
      },
      appendToolResult: async (result: { toolCallId: string; content: string }) => {
        messages.push({ role: "tool", ...result });
        revision++;
      },
    },
    eventQueue: new InMemoryQueue(),
    session: {
      initializeContext,
      consumeIncomingEvent: async () => {},
      flushPendingIncomingEffects: async () => ({ shouldTriggerRound: false }),
      setSuspended: () => {},
    },
    tools: { definitions: () => [], getKind: () => "business", execute },
    contextSummarizer: { invoke },
    snapshotRepository: { save },
  } as unknown as ConstructorParameters<typeof RootLoopAgent>[0]);
  return { agent, chat, invoke, save, execute, messages, initializeContext };
}

describe("RootLoopAgent stop", () => {
  it("取消在途模型调用，正常结束循环且不再执行工具", async () => {
    const { agent, chat, execute } = makeAgent();
    chat.mockImplementation(
      (_request, { signal }) =>
        new Promise((_resolve, reject) => {
          signal.addEventListener("abort", () => reject(signal.reason), { once: true });
        }),
    );
    const run = agent.run();
    await vi.waitFor(() => expect(chat).toHaveBeenCalledTimes(1));
    await agent.stop();
    await expect(run).resolves.toBeUndefined();
    expect(execute).not.toHaveBeenCalled();
    expect(chat).toHaveBeenCalledTimes(1);
  });

  it("模型退避期间停止会清除等待，不把正常停止记为崩溃", async () => {
    vi.useFakeTimers();
    const { agent, chat } = makeAgent();
    chat.mockRejectedValue(llmUpstreamCallFailedError());
    try {
      const run = agent.run();
      await vi.advanceTimersByTimeAsync(0);
      expect(chat).toHaveBeenCalledTimes(1);
      expect(vi.getTimerCount()).toBe(1);
      await agent.stop();
      await run;
      expect(vi.getTimerCount()).toBe(0);
      await vi.advanceTimersByTimeAsync(60_000);
      expect(chat).toHaveBeenCalledTimes(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it("当前工具完成后提交其结果、跳过后续工具，再存最终快照", async () => {
    const { agent, chat, execute, save, messages } = makeAgent();
    const gate = deferred<{ content: string; kind: "business" }>();
    chat.mockResolvedValue({
      ...response,
      message: {
        ...response.message,
        toolCalls: [
          { id: "one", name: "write", arguments: {} },
          { id: "two", name: "write", arguments: {} },
        ],
      },
    });
    execute.mockImplementationOnce(() => gate.promise);
    const run = agent.run();
    await vi.waitFor(() => expect(execute).toHaveBeenCalledTimes(1));
    save.mockClear();
    let stopped = false;
    const stopping = agent.stop().then(() => {
      stopped = true;
    });
    await Promise.resolve();
    expect(stopped).toBe(false);
    expect(save).not.toHaveBeenCalled();
    gate.resolve({ content: "write completed", kind: "business" });
    await Promise.all([run, stopping]);
    expect(execute).toHaveBeenCalledTimes(1);
    expect(chat).toHaveBeenCalledTimes(1);
    expect(messages.slice(-2)).toEqual([
      { role: "tool", toolCallId: "one", content: "write completed" },
      { role: "tool", toolCallId: "two", content: expect.stringContaining("stopping") },
    ]);
    expect(save).toHaveBeenLastCalledWith(
      expect.objectContaining({ contextSnapshot: { messages } }),
    );
  });

  it("停止涵盖未启动主循环的手动摘要，晚到摘要不得覆盖上下文", async () => {
    const { agent, invoke, messages } = makeAgent();
    const gate = deferred<string>();
    invoke.mockImplementation(() => gate.promise);
    const compacting = agent.compactContextByRatio(100).catch(error => error);
    await vi.waitFor(() => expect(invoke).toHaveBeenCalledTimes(1));
    const signal = invoke.mock.calls[0][1].signal as AbortSignal;
    const stopping = agent.stop();
    expect(signal.aborted).toBe(true);
    gate.resolve("late summary");
    expect(await compacting).toBe(signal.reason);
    await stopping;
    expect(messages).toEqual([{ role: "user", content: "task" }]);
    await expect(agent.compactContextByRatio(100)).rejects.toBe(signal.reason);
    await expect(agent.resetContext()).rejects.toBe(signal.reason);
  });
});

it("stop 等待启动中的初始化完成，不能提前存档关闭资源", async () => {
  const { agent, initializeContext, save } = makeAgent();
  const gate = deferred<void>();
  initializeContext.mockImplementation(() => gate.promise);
  const initializing = agent.initialize();
  await vi.waitFor(() => expect(initializeContext).toHaveBeenCalledTimes(1));
  let stopped = false;
  const stopping = agent.stop().then(() => {
    stopped = true;
  });
  await Promise.resolve();
  expect(stopped).toBe(false);
  expect(save).not.toHaveBeenCalled();
  gate.resolve();
  await Promise.all([initializing, stopping]);
  expect(stopped).toBe(true);
  expect(save).toHaveBeenCalled();
});

it("停止取消自动摘要，并把压缩前已经完成的轮次存档", async () => {
  const { agent, chat, invoke, save, messages } = makeAgent();
  chat.mockResolvedValue({ ...response, usage: { totalTokens: 200_000 } });
  invoke.mockImplementation(
    (_input, { signal }) =>
      new Promise((_resolve, reject) => {
        signal.addEventListener("abort", () => reject(signal.reason), { once: true });
      }),
  );
  const run = agent.run();
  await vi.waitFor(() => expect(invoke).toHaveBeenCalledTimes(1));
  save.mockClear();
  await agent.stop();
  await run;
  expect(invoke).toHaveBeenCalledTimes(1);
  expect(chat).toHaveBeenCalledTimes(1);
  expect(messages.at(-1)).toMatchObject({ role: "assistant", content: "done" });
  expect(save).toHaveBeenCalledWith(expect.objectContaining({ contextSnapshot: { messages } }));
});

it("最终快照写入失败必须让 stop 失败，不能误报干净退出", async () => {
  const { agent, save } = makeAgent();
  const error = new Error("database unavailable");
  save.mockRejectedValue(error);
  await expect(agent.stop()).rejects.toBe(error);
});
