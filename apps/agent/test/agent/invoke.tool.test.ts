import {
  AppManager,
  createAppSubtoolOwner,
  ZodToolComponent,
  type App,
  type JsonSchema,
  type ToolComponent,
  type ToolContext,
  type ToolKind,
} from "@sparkle/agent-runtime";
import { z } from "zod";
import { describe, expect, it } from "vitest";
import { InvokeTool } from "../../src/agent/runtime/root-agent/tools/invoke.tool.js";

const TEST_APP_ID = "echo";

const EchoArgumentsSchema = z.object({ message: z.string() });

/** 最小业务子工具：回显 message；空串时返回自带文案的失败结果，供透传断言用。 */
class EchoTool extends ZodToolComponent<typeof EchoArgumentsSchema> {
  public readonly name = "echo";
  public readonly description = "回显一段文本。";
  public readonly parameters: JsonSchema = {
    type: "object",
    properties: {
      message: { type: "string", description: "要回显的文本。" },
    },
  };
  public readonly kind: ToolKind = "business";
  protected readonly inputSchema = EchoArgumentsSchema;

  protected async executeTyped(args: z.infer<typeof EchoArgumentsSchema>): Promise<string> {
    if (args.message.trim() === "") {
      return JSON.stringify({
        ok: false,
        error: "ECHO_EMPTY_MESSAGE",
        message: "message 是空的，先填内容再 echo。",
      });
    }
    return JSON.stringify({ ok: true, echoed: args.message.trim() });
  }
}

/** 最小测试 App：手机 OS 模型下子工具都由 App 拥有。 */
function createTestApp(tools: ToolComponent[]): App {
  return {
    id: TEST_APP_ID,
    displayName: "回声",
    description: "回显文本的测试 App。",
    tools,
    canInvoke: () => true,
    help: async () => "",
  };
}

/**
 * 测试用 InvokeTool 工厂。手机 OS 模型下所有子工具都由 App 拥有，gate 走
 * createAppSubtoolOwner（按 ctx 里 mock session 的 getCurrentApp）。
 */
function createTestInvokeTool(opts: { appTools?: ToolComponent[] }): InvokeTool {
  const appManager = new AppManager();
  if (opts.appTools && opts.appTools.length > 0) {
    appManager.register(createTestApp(opts.appTools));
  }
  return new InvokeTool({
    owners: [
      createAppSubtoolOwner({
        appManager,
        getCurrentApp: (ctx: ToolContext) => {
          const session = (
            ctx as ToolContext & {
              rootAgentSession?: { getCurrentApp(): string | undefined };
            }
          ).rootAgentSession;
          return session?.getCurrentApp();
        },
      }),
    ],
  });
}

describe("invoke tool", () => {
  it("should expose minimal invoke parameters that do not depend on subtool list", () => {
    // 暴露给 LLM 的 schema 只声明 tool 字段，子工具参数走 additionalProperties。
    // 这条不变量保住主 Agent 顶层 tools 数组的 KV cache 稳定性——加 / 删 / 改子工具
    // 不会让这一份 schema 漂移。
    const tool = createTestInvokeTool({
      appTools: [new EchoTool()],
    });

    expect(tool.parameters).toEqual({
      type: "object",
      properties: {
        tool: {
          type: "string",
          description: "要调用的子工具名。",
        },
      },
      additionalProperties: true,
    });
  });

  it("should invoke an App-owned subtool when inside the owning App", async () => {
    const tool = createTestInvokeTool({
      appTools: [new EchoTool()],
    });

    const result = await tool.execute({ tool: "echo", message: "  hello  " }, {
      rootAgentSession: {
        getCurrentApp: () => TEST_APP_ID,
      },
    } as Parameters<typeof tool.execute>[1]);

    expect(JSON.parse(result.content)).toMatchObject({ ok: true, echoed: "hello" });
  });

  it("should describe available tools when invoke subtool does not exist", async () => {
    const tool = createTestInvokeTool({
      appTools: [new EchoTool()],
    });

    const result = await tool.execute(
      {
        tool: "unknown_tool",
      },
      {
        rootAgentSession: {
          getCurrentApp: () => TEST_APP_ID,
        },
      } as Parameters<typeof tool.execute>[1],
    );

    // NOT_FOUND 回带的可用清单按 owner.canInvokeNow 过滤成"当前真正可调"的子集。
    // 当前在所属 App 里，echo 可调，所以仍会出现在清单里。
    expect(JSON.parse(result.content)).toMatchObject({
      ok: false,
      error: "INVOKE_TOOL_NOT_FOUND",
      availableTools: ["echo"],
    });
    expect(JSON.parse(result.content).message).toContain("invoke 子工具 unknown_tool 不存在。");
    expect(JSON.parse(result.content).message).toContain("当前可用的 invoke 工具说明：");
    expect(JSON.parse(result.content).message).toContain("`echo`");
  });

  it("should treat App-owned tool as NOT_FOUND when not in the owning App", async () => {
    // 「子工具存在但当前不允许调用」与「子工具不存在」合并：没进所属 App 时调
    // echo，统一按 NOT_FOUND 返回，且该工具不会出现在可用清单里。
    const tool = createTestInvokeTool({
      appTools: [new EchoTool()],
    });

    const result = await tool.execute({ tool: "echo", message: "hi" }, {
      rootAgentSession: {
        // 没在所属 App 里
        getCurrentApp: () => undefined,
      },
    } as Parameters<typeof tool.execute>[1]);

    const parsed = JSON.parse(result.content);
    expect(parsed).toMatchObject({
      ok: false,
      error: "INVOKE_TOOL_NOT_FOUND",
      availableTools: [],
    });
    expect(parsed.message).toContain("invoke 子工具 echo 不存在。");
  });

  it("preserves the subtool's own failure message instead of synthesizing app-specific text", async () => {
    // 抽象边界回归：子工具失败时自带 message（这里 echo 空串→ECHO_EMPTY_MESSAGE + 自带文案），
    // InvokeTool 只负责原样透传 + 追加该子工具 schema 文档，绝不按错误码硬编码 App 专属文案。
    const tool = createTestInvokeTool({
      appTools: [new EchoTool()],
    });

    const result = await tool.execute({ tool: "echo", message: "   " }, {
      rootAgentSession: {
        getCurrentApp: () => TEST_APP_ID,
      },
    } as Parameters<typeof tool.execute>[1]);

    const parsed = JSON.parse(result.content);
    expect(parsed.error).toBe("ECHO_EMPTY_MESSAGE");
    // 子工具自己的文案被原样保留在最前
    expect(parsed.message.startsWith("message 是空的，先填内容再 echo。")).toBe(true);
    // 只追加当前子工具的 schema 文档
    expect(parsed.message).toContain("`echo`");
  });

  it("still synthesizes the structural INVALID_ARGUMENTS hint (not an App concept)", async () => {
    // INVALID_ARGUMENTS 是 ZodToolComponent 的结构性通用错误，由 InvokeTool 合成参数提示
    // 这条分支保留——它不是 App 业务语义。message 传错类型触发 Zod 校验失败。
    const tool = createTestInvokeTool({
      appTools: [new EchoTool()],
    });

    const result = await tool.execute({ tool: "echo", message: 123 }, {
      rootAgentSession: {
        getCurrentApp: () => TEST_APP_ID,
      },
    } as Parameters<typeof tool.execute>[1]);

    const parsed = JSON.parse(result.content);
    expect(parsed.error).toBe("INVALID_ARGUMENTS");
    expect(parsed.message).toContain("参数不合法");
  });
});
