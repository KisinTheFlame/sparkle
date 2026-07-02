import { describe, expect, it } from "vitest";
import { renderMainSystemPrompt } from "../src/agent/system-prompt/render.js";

describe("renderMainSystemPrompt", () => {
  it("从 .hbs 模板渲染出非空、已 trim 的 system prompt", () => {
    const prompt = renderMainSystemPrompt();
    expect(prompt.length).toBeGreaterThan(0);
    expect(prompt).toBe(prompt.trim());
    expect(prompt).toContain("End");
  });
});
