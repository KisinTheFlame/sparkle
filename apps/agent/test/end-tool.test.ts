import { describe, expect, it } from "vitest";
import { EndTool, END_TOOL_NAME } from "../src/agent/tools/end.tool.js";
import { WAIT_FOR_EVENT_EFFECT_TYPE } from "../src/agent/runtime/wait-for-event.handler.js";

describe("EndTool — 挂起工具（= wait，仅命名不同）", () => {
  it("产一个带 maxWaitMs 的 wait_for_event Effect，且 content 非空（维护 ReAct 协议）", async () => {
    const tool = new EndTool({ maxWaitMs: 123_456 });
    const result = await tool.execute({}, {});

    expect(result.content.length).toBeGreaterThan(0);
    expect(result.effects).toEqual([{ type: WAIT_FOR_EVENT_EFFECT_TYPE, maxWaitMs: 123_456 }]);
  });

  it("name 为 End，kind 为 control，无参数", () => {
    const tool = new EndTool({ maxWaitMs: 1 });
    expect(tool.name).toBe(END_TOOL_NAME);
    expect(tool.kind).toBe("control");
    expect(tool.parameters).toEqual({
      type: "object",
      properties: {},
      additionalProperties: false,
    });
  });
});
