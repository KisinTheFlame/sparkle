import { describe, expect, it } from "vitest";
import { EndTool, END_TOOL_NAME } from "../src/agent/tools/end.tool.js";

describe("EndTool — 结束发言信号（不产 effect、不在工具内阻塞）", () => {
  it("返回非空 content 且不产任何 effect（挂起交给 loop，工具内不阻塞）", async () => {
    const tool = new EndTool();
    const result = await tool.execute({}, {});

    expect(result.content.length).toBeGreaterThan(0);
    expect(result.effects).toBeUndefined();
  });

  it("容忍模型塞多余参数（非 strict，strip 掉），仍正常返回", async () => {
    const tool = new EndTool();
    const result = await tool.execute({ reason: "done" }, {});
    expect(result.content.length).toBeGreaterThan(0);
    expect(result.effects).toBeUndefined();
  });

  it("name 为 End，kind 为 control，无参数", () => {
    const tool = new EndTool();
    expect(tool.name).toBe(END_TOOL_NAME);
    expect(tool.kind).toBe("control");
    expect(tool.parameters).toEqual({
      type: "object",
      properties: {},
      additionalProperties: false,
    });
  });
});
