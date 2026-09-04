import { describe, expect, it } from "vitest";
import type { LlmMessage } from "@sparkle/llm";
import { InMemoryQueue, NoopEffectInterpreter, type ToolExecutor } from "@sparkle/agent-runtime";
import { RootAgentHost } from "../../src/agent/runtime/root-agent/root-agent-runtime.js";
import { DefaultAgentContext } from "../../src/agent/runtime/context/default-agent-context.js";
import { LinearMessageLedgerAgentContext } from "../../src/agent/runtime/context/linear-message-ledger-agent-context.js";
import { RootAgentSession } from "../../src/agent/runtime/root-agent/session/root-agent-session.js";
import type { Event } from "../../src/agent/runtime/event/event.js";

/**
 * 回归测试（针对 ithome 列表这类只走 append_message 的屏"看不到内容"的根因）：
 *
 * tool 的 `append_message` effect 经 kernel interpreter 翻译后挂在
 * `toolExecution.effectMessages` 上。`RootAgentHost.commitRoundResult` 必须把它
 * 持久化进上下文——否则这些"屏幕"内容只在回合内可见、不进 ledger，下一轮 Agent
 * 就只剩 tool_result 的那句简短状态（如 `{count:10}`），看不到榜单本身。
 *
 * 修复前：commitRoundResult 只落 tool 结果，丢掉 effectMessages，
 * 本测试的 `append_message` 断言失败。
 */
describe("RootAgentHost.commitRoundResult — append_message effect 持久化", () => {
  function makeHost() {
    const order: string[] = [];
    const appended: LlmMessage[] = [];

    const context = {
      appendAssistantTurn: async () => {
        order.push("assistant");
      },
      appendToolResult: async (input: { toolCallId: string; content: string }) => {
        order.push(`toolResult:${input.content}`);
      },
      appendMessages: async (messages: LlmMessage[]) => {
        order.push(`append:${messages.length}`);
        appended.push(...messages);
      },
    };

    const host = new RootAgentHost({
      context,
      eventQueue: {},
      session: {},
      interpreter: {},
    } as unknown as ConstructorParameters<typeof RootAgentHost>[0]);

    const tools = {
      getKind: () => "business",
      definitions: () => [],
      execute: async () => ({ content: "" }),
    } as unknown as Parameters<RootAgentHost["commitRoundResult"]>[1];

    return { host, tools, order, appended };
  }

  function makeRoundResult(
    effectMessages: LlmMessage[],
  ): Parameters<RootAgentHost["commitRoundResult"]>[0] {
    const assistantMessage = {
      role: "assistant" as const,
      content: "",
      toolCalls: [{ id: "tc1", name: "invoke", arguments: { tool: "view_time" } }],
    };
    return {
      completion: { message: assistantMessage },
      assistantMessage,
      toolExecutions: [
        {
          toolCall: { id: "tc1", name: "invoke", arguments: { tool: "view_time" } },
          result: { content: '{"ok":true,"feed":"top","count":10}', kind: "business" },
          appendedMessages: [
            { role: "tool", toolCallId: "tc1", content: '{"ok":true,"feed":"top","count":10}' },
          ],
          effectMessages,
        },
      ],
      appendedMessages: [],
      shouldCommit: true,
    } as unknown as Parameters<RootAgentHost["commitRoundResult"]>[0];
  }

  it("把 effectMessages（渲染好的榜单）append 进上下文，且排在 tool 结果之后", async () => {
    const { host, tools, order, appended } = makeHost();
    const frontPage: LlmMessage = {
      role: "user",
      content: '<hn_front_page feed="热榜">\n1. [id=1] Some HN Story\n</hn_front_page>',
    };

    await host.commitRoundResult(makeRoundResult([frontPage]), tools);

    // 榜单必须进上下文（修复前这里为空 → 失败）。
    expect(appended).toContainEqual(frontPage);
    // 顺序：assistant → tool 结果 → effect 屏幕。
    expect(order).toEqual([
      "assistant",
      'toolResult:{"ok":true,"feed":"top","count":10}',
      "append:1",
    ]);
  });

  it("没有 effectMessages 时不额外 append（不回归现有行为）", async () => {
    const { host, tools, order, appended } = makeHost();

    await host.commitRoundResult(makeRoundResult([]), tools);

    expect(appended).toHaveLength(0);
    expect(order).toEqual(["assistant", 'toolResult:{"ok":true,"feed":"top","count":10}']);
  });

  it("混合工具轮保留 wait、空结果和 control 屏幕，且前缀、账本批次与修订号不变", async () => {
    const ledgerBatches: LlmMessage[][] = [];
    const context = new LinearMessageLedgerAgentContext({
      inner: new DefaultAgentContext({ systemPrompt: "固定前缀" }),
      linearMessageLedgerDao: {
        insertMany: async entries => {
          ledgerBatches.push(entries.map(entry => entry.message));
          return [];
        },
      },
      runtimeKey: "test",
    });
    await context.appendMessages([{ role: "user", content: "已有历史" }]);
    const before = await context.getSnapshot();
    const revisionBefore = context.getRevision();
    ledgerBatches.length = 0;
    const host = new RootAgentHost({
      context,
      eventQueue: new InMemoryQueue<Event>(),
      session: new RootAgentSession({ context }),
      interpreter: new NoopEffectInterpreter(),
    });
    const tools: ToolExecutor = {
      definitions: () => [],
      getKind: name => (name === "invoke" ? "business" : "control"),
      execute: async () => {
        throw new Error("提交已执行的回合不应再次执行工具");
      },
    };
    const hiddenCall = { id: "hidden", name: "test_control", arguments: {} };
    const waitCall = { id: "wait", name: "wait", arguments: {} };
    const invokeCall = { id: "invoke", name: "invoke", arguments: { tool: "noop" } };
    const controlScreen: LlmMessage = { role: "user", content: "control 产生的屏幕" };
    const businessScreen: LlmMessage = { role: "user", content: "业务工具产生的屏幕" };
    const round = makeRoundResult([]);
    round.assistantMessage = {
      role: "assistant",
      content: "  保留原文空白  ",
      toolCalls: [hiddenCall, waitCall, invokeCall],
    };
    round.completion.message = round.assistantMessage;
    round.toolExecutions = [
      {
        toolCall: hiddenCall,
        result: { kind: "control", content: "隐藏结果" },
        appendedMessages: [],
        effectMessages: [controlScreen],
      },
      {
        toolCall: waitCall,
        result: { kind: "control", content: "" },
        appendedMessages: [],
        effectMessages: [],
      },
      {
        toolCall: invokeCall,
        result: { kind: "business", content: "" },
        appendedMessages: [],
        effectMessages: [businessScreen],
      },
    ];
    const roundBefore = JSON.stringify(round);

    await host.commitRoundResult(round, tools);

    const expected: LlmMessage[] = [
      {
        role: "assistant",
        content: "  保留原文空白  ",
        toolCalls: [waitCall, invokeCall],
      },
      controlScreen,
      { role: "tool", toolCallId: "wait", content: "" },
      { role: "tool", toolCallId: "invoke", content: "" },
      businessScreen,
    ];
    const after = await context.getSnapshot();
    expect(after.systemPrompt).toBe(before.systemPrompt);
    expect(JSON.stringify(after.messages)).toBe(JSON.stringify([...before.messages, ...expected]));
    expect(JSON.stringify(ledgerBatches)).toBe(JSON.stringify(expected.map(message => [message])));
    expect(context.getRevision()).toBe(revisionBefore + 5);
    expect(JSON.stringify(round)).toBe(roundBefore);
  });
});
