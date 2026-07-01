import { describe, expect, it, vi } from "vitest";
import type { LlmClient } from "@sparkle/llm-client";
import { createAgentReActModel } from "../src/agent/model/llm-client-react-model.js";

describe("createAgentReActModel — LlmClient → ReActModel 适配", () => {
  it("把请求与 usage 透传给 llmClient.chat，并回传其结果", async () => {
    const chat = vi.fn(async () => ({
      provider: "claude-code" as const,
      model: "claude-opus-4-8",
      message: { role: "assistant" as const, content: "hi", toolCalls: [] },
    }));
    const llmClient = { chat } as unknown as LlmClient;

    const model = createAgentReActModel({ llmClient });
    const request = { system: "s", messages: [], tools: [], toolChoice: "required" as const };
    const result = await model.chat(request, { usage: "agent" });

    expect(chat).toHaveBeenCalledWith(request, { usage: "agent" });
    expect(result.message.content).toBe("hi");
  });
});
