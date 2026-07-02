import { describe, expect, it } from "vitest";
import { InMemoryAgentContext } from "../src/agent/context/in-memory-agent-context.js";

describe("InMemoryAgentContext", () => {
  it("按顺序追加 user 消息与任意消息，getSnapshot 带 systemPrompt", () => {
    const context = new InMemoryAgentContext({ systemPrompt: "SYS" });
    context.appendUserMessage("hi");
    context.appendMessages([
      { role: "assistant", content: "reply", toolCalls: [] },
      { role: "tool", toolCallId: "c1", content: "done" },
    ]);

    const snapshot = context.getSnapshot();
    expect(snapshot.systemPrompt).toBe("SYS");
    expect(snapshot.messages).toEqual([
      { role: "user", content: "hi" },
      { role: "assistant", content: "reply", toolCalls: [] },
      { role: "tool", toolCallId: "c1", content: "done" },
    ]);
  });

  it("getSnapshot 返回拷贝：改返回值不污染内部状态", () => {
    const context = new InMemoryAgentContext();
    context.appendUserMessage("a");
    const snapshot = context.getSnapshot();
    snapshot.messages.push({ role: "user", content: "injected" });
    expect(context.getSnapshot().messages).toHaveLength(1);
  });
});
