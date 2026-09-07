import { createClient } from "@sparkle/rpc-client/client";
import { llmApiContract } from "@sparkle/llm-api/contract";
import type { LlmProviderOption } from "@sparkle/llm-api/llm-chat";
import { describe, expect, it } from "vitest";

/**
 * 契约编译期强制的「试金石」（issue #230）。这些断言主要靠 `tsc --noEmit`（agent typecheck，经
 * tsconfig paths 对 @sparkle/llm-api **源码**解析）把关：改 llmApiContract.listProviders 的 output，
 * 下面的类型断言与 @ts-expect-error 会立即失败 —— 证明「上游改契约、下游编译报错」。
 * vitest 只跑运行时那一行 expect，类型块用 `void (async …)` 包住不执行。
 */
describe("llm-api 契约：编译期类型强制", () => {
  it("createClient 派生的 listProviders 返回类型 == 契约 output（LlmProviderOption[]）", () => {
    const api = createClient(llmApiContract, { baseUrl: "http://llm" });
    // 门面 == 契约：返回类型必须精确赋给 Promise<LlmProviderOption[]>，否则编译失败。
    const assertReturnType = (): Promise<LlmProviderOption[]> => api.listProviders({});
    void assertReturnType;
    expect(typeof api.listProviders).toBe("function");
  });

  it("读不存在的 output 字段 → 编译期报错", () => {
    const api = createClient(llmApiContract, { baseUrl: "http://llm" });
    void (async (): Promise<void> => {
      const providers = await api.listProviders({});
      // @ts-expect-error output 元素是 { id, models }，无 nonExistent 字段
      void providers[0]?.nonExistent;
    });
    expect(typeof api.listProviders).toBe("function");
  });

  it("chatDirect/embed 保持信封级，模型选择必填，归因可选且结构明确", () => {
    const api = createClient(llmApiContract, { baseUrl: "http://llm" });
    void (async (): Promise<void> => {
      await api.chatDirect({ request: { whatever: true }, providerId: "openai", model: "gpt" });
      // @ts-expect-error 单次执行必须由调用方指定 model
      await api.chatDirect({ request: {}, providerId: "openai" });
      // @ts-expect-error 单次执行必须由调用方指定 providerId
      await api.chatDirect({ request: {}, model: "gpt" });
      // @ts-expect-error 旧 usage 选模型入口已移除
      await api.chat({ request: {}, usage: "agent", scene: "agent" });
      const res: unknown = await api.chatDirect({
        request: {},
        providerId: "openai",
        model: "gpt",
        trace: { requestId: "request-1", seq: 2, usage: "caller", scene: "work" },
      });
      void res;
      await api.embed({ request: { content: "hi" } });
    });
    expect(typeof api.chatDirect).toBe("function");
    expect(typeof api.embed).toBe("function");
  });
});
