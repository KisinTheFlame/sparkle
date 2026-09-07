import { describe, expect, it, vi, type Mock } from "vitest";
import type { Config } from "@sparkle/kernel/config/config.loader";
import { BizError } from "@sparkle/kernel/errors/biz-error";

// llm-client 对 @sparkle/persistence 零依赖，测试也不例外：这里只按 recordSuccess/recordError
// 的调用面定义一个本地 mock DAO 类型，避免把 persistence 拖进本包的测试图。
type LlmChatCallDaoMock = {
  countByQuery: Mock;
  listPage: Mock;
  findById: Mock;
  recordSuccess: Mock;
  recordError: Mock;
};
import { createLlmClient, type LlmChatCallObservation, type LlmClient } from "../src/client.js";
import {
  attachLlmProviderFailureContext,
  type LlmProvider,
  type LlmProviderChatResult,
} from "../src/provider.js";
import type { LlmProviderId } from "@sparkle/llm";
import type { LlmChatResponsePayload } from "../src/types.js";

type LlmProviderConfig = {
  apiKey?: string;
  baseUrl: string;
  models: string[];
  keepAliveReplayIntervalMinutes?: number;
  timeoutMs: number;
};

type OpenAiCodexConfig = Config["server"]["llm"]["providers"]["openaiCodex"] & {
  timeoutMs: Config["server"]["llm"]["timeoutMs"];
};

function createLlmChatCallDaoMock(): LlmChatCallDaoMock {
  return {
    countByQuery: vi.fn().mockResolvedValue(0),
    listPage: vi.fn().mockResolvedValue([]),
    findById: vi.fn().mockResolvedValue(null),
    recordSuccess: vi.fn().mockResolvedValue(undefined),
    recordError: vi.fn().mockResolvedValue(undefined),
  };
}

// 落库改为「client 发 observation、装配层订阅落库」后，测试用这个转发器把 observation
// 直接喂给 mock DAO —— 它与 agent server-runtime 里的订阅 handler 逻辑一致，因此既保留了
// 原有对 recordSuccess/recordError 的断言，又顺带验证 observation 字段足以完整重放落库。
function recordObservationToDao(
  dao: LlmChatCallDaoMock,
): (observation: LlmChatCallObservation) => void {
  return observation => {
    if (observation.status === "success") {
      void dao.recordSuccess({
        provider: observation.provider,
        model: observation.model,
        extension: observation.extension,
        requestId: observation.requestId,
        seq: observation.seq,
        latencyMs: observation.latencyMs,
        request: observation.request,
        response: observation.response,
        nativeRequestPayload: observation.nativeRequestPayload,
        nativeResponsePayload: observation.nativeResponsePayload,
      });
      return;
    }

    void dao.recordError({
      provider: observation.provider,
      model: observation.model,
      extension: observation.extension,
      requestId: observation.requestId,
      seq: observation.seq,
      latencyMs: observation.latencyMs,
      request: observation.request,
      ...(observation.response ? { response: observation.response } : {}),
      nativeRequestPayload: observation.nativeRequestPayload,
      nativeResponsePayload: observation.nativeResponsePayload,
      nativeError: observation.nativeError,
      error: observation.error,
    });
  };
}

function createProviderConfigs(): Record<LlmProviderId, LlmProviderConfig | OpenAiCodexConfig> {
  return {
    deepseek: {
      apiKey: undefined,
      baseUrl: "https://api.deepseek.com",
      models: ["deepseek-chat", "deepseek-reasoner"],
      timeoutMs: 45_000,
    },
    openai: {
      apiKey: undefined,
      baseUrl: "https://api.openai.com/v1",
      models: ["gpt-4o-mini", "gpt-5.4"],
      timeoutMs: 45_000,
    },
    "openai-codex": {
      baseUrl: "https://chatgpt.com/backend-api/codex/responses",
      models: ["gpt-5.3-codex"],
      timeoutMs: 45_000,
    },
    "claude-code": {
      apiKey: undefined,
      baseUrl: "https://api.anthropic.com",
      models: ["claude-sonnet-4-20250514"],
      keepAliveReplayIntervalMinutes: 30,
      timeoutMs: 45_000,
    },
  };
}

function createClient(params?: {
  llmChatCallDao?: LlmChatCallDaoMock;
  providers?: Partial<Record<LlmProviderId, LlmProvider>>;
  providerConfigs?: Record<LlmProviderId, LlmProviderConfig | OpenAiCodexConfig>;
}): { client: LlmClient; llmChatCallDao: LlmChatCallDaoMock } {
  const llmChatCallDao = params?.llmChatCallDao ?? createLlmChatCallDaoMock();

  return {
    client: createLlmClient({
      providers: params?.providers ?? {},
      providerConfigs: params?.providerConfigs ?? createProviderConfigs(),
      recordObservation: recordObservationToDao(llmChatCallDao),
    }),
    llmChatCallDao,
  };
}

function createChatResponse(
  overrides: Partial<LlmChatResponsePayload> = {},
): LlmChatResponsePayload {
  return {
    provider: "openai",
    model: "gpt-4o-mini",
    message: {
      role: "assistant",
      content: "pong",
      toolCalls: [],
    },
    ...overrides,
  };
}

function createProviderChatResult(
  response: LlmChatResponsePayload,
  overrides: Partial<LlmProviderChatResult> = {},
): LlmProviderChatResult {
  return {
    response,
    nativeRequestPayload: {
      model: response.model,
      messages: [],
    },
    nativeResponsePayload: {
      id: `native-${response.model}`,
      model: response.model,
    },
    ...overrides,
  };
}

describe("createLlmClient single-attempt gateway", () => {
  it("treats caller attribution as opaque and keeps native payloads off the response", async () => {
    const recordObservation = vi.fn();
    const request = { messages: [], tools: [], toolChoice: "required" as const };
    const chat = vi.fn().mockResolvedValue(createProviderChatResult(createChatResponse()));
    const client = createLlmClient({
      providers: { openai: { id: "openai", chat } },
      providerConfigs: createProviderConfigs(),
      recordObservation,
    });
    const trace = { requestId: "call-1", seq: 3, usage: "another-agent", scene: "another-task" };
    const result = await client.chatDirect(request, {
      providerId: "openai",
      model: "gpt-4o-mini",
      trace,
    });
    expect(result).toEqual(createChatResponse());
    expect(chat).toHaveBeenCalledExactlyOnceWith({ ...request, model: "gpt-4o-mini" });
    expect(recordObservation).toHaveBeenCalledWith(
      expect.objectContaining({
        ...trace,
        status: "success",
        nativeRequestPayload: expect.any(Object),
      }),
    );
    const failure = new Error("upstream failed");
    chat.mockRejectedValueOnce(failure);
    await expect(
      client.chatDirect(request, {
        providerId: "openai",
        model: "gpt-4o-mini",
        trace: { ...trace, seq: 4 },
      }),
    ).rejects.toBe(failure);
    expect(chat).toHaveBeenCalledTimes(2);
    expect(recordObservation).toHaveBeenLastCalledWith(
      expect.objectContaining({
        ...trace,
        seq: 4,
        status: "failed",
        error: failure,
      }),
    );
  });

  it("lists available providers without caller configuration", async () => {
    const { client } = createClient({
      providers: {
        openai: { id: "openai", chat: vi.fn() },
        deepseek: { id: "deepseek", chat: vi.fn() },
        "openai-codex": { id: "openai-codex", chat: vi.fn(), isAvailable: async () => false },
      },
    });
    expect((await client.listAvailableProviders()).map(provider => provider.id)).toEqual([
      "deepseek",
      "openai",
    ]);
  });

  it("should skip persistence when recordCall is false in direct mode", async () => {
    const provider: LlmProvider = {
      id: "openai",
      chat: vi
        .fn()
        .mockResolvedValue(createProviderChatResult(createChatResponse({ provider: "openai" }))),
    };
    const { client, llmChatCallDao } = createClient({
      providers: {
        openai: provider,
      },
    });

    await client.chatDirect(
      {
        messages: [{ role: "user", content: "ping" }],
        tools: [],
        toolChoice: "none",
      },
      {
        providerId: "openai",
        model: "gpt-4o-mini",
        recordCall: false,
      },
    );

    expect(llmChatCallDao.recordSuccess).not.toHaveBeenCalled();
    expect(llmChatCallDao.recordError).not.toHaveBeenCalled();
  });

  it("should persist native request and response payloads on success", async () => {
    const provider: LlmProvider = {
      id: "openai",
      chat: vi.fn().mockResolvedValue(
        createProviderChatResult(createChatResponse({ provider: "openai" }), {
          nativeRequestPayload: {
            model: "gpt-4o-mini",
            messages: [{ role: "user", content: "ping" }],
          },
          nativeResponsePayload: {
            id: "chatcmpl_test",
            model: "gpt-4o-mini",
          },
        }),
      ),
    };
    const { client, llmChatCallDao } = createClient({
      providers: {
        openai: provider,
      },
    });

    await expect(
      client.chatDirect(
        {
          messages: [{ role: "user", content: "ping" }],
          tools: [],
          toolChoice: "none",
        },
        {
          providerId: "openai",
          model: "gpt-4o-mini",
        },
      ),
    ).resolves.toEqual({
      provider: "openai",
      model: "gpt-4o-mini",
      message: { role: "assistant", content: "pong", toolCalls: [] },
    });

    expect(llmChatCallDao.recordSuccess).toHaveBeenCalledWith(
      expect.objectContaining({
        model: "gpt-4o-mini",
        extension: {
          metadata: {
            actualModel: "gpt-4o-mini",
          },
        },
        nativeRequestPayload: {
          model: "gpt-4o-mini",
          messages: [{ role: "user", content: "ping" }],
        },
        nativeResponsePayload: {
          id: "chatcmpl_test",
          model: "gpt-4o-mini",
        },
      }),
    );
  });

  it("should persist native failure context when provider throws with native payloads", async () => {
    const provider: LlmProvider = {
      id: "openai",
      chat: vi.fn().mockRejectedValue(
        attachLlmProviderFailureContext(new Error("upstream failed"), {
          nativeRequestPayload: {
            model: "gpt-4o-mini",
            messages: [{ role: "user", content: "ping" }],
          },
          nativeResponsePayload: {
            id: "response_partial",
          },
          nativeError: {
            status: 500,
            message: "provider boom",
          },
        }),
      ),
    };
    const { client, llmChatCallDao } = createClient({
      providers: {
        openai: provider,
      },
    });

    await expect(
      client.chatDirect(
        {
          messages: [{ role: "user", content: "ping" }],
          tools: [],
          toolChoice: "none",
        },
        {
          providerId: "openai",
          model: "gpt-4o-mini",
        },
      ),
    ).rejects.toThrow("upstream failed");

    expect(llmChatCallDao.recordError).toHaveBeenCalledWith(
      expect.objectContaining({
        extension: null,
        nativeRequestPayload: {
          model: "gpt-4o-mini",
          messages: [{ role: "user", content: "ping" }],
        },
        nativeResponsePayload: {
          id: "response_partial",
        },
        nativeError: {
          status: 500,
          message: "provider boom",
        },
      }),
    );
  });

  it("should reject unavailable providers in direct mode", async () => {
    const { client } = createClient();

    await expect(
      client.chatDirect(
        {
          messages: [{ role: "user", content: "ping" }],
          tools: [],
          toolChoice: "none",
        },
        {
          providerId: "deepseek",
          model: "deepseek-chat",
        },
      ),
    ).rejects.toMatchObject({
      name: "BizError",
      message: "所选 LLM provider 当前不可用",
      meta: {
        provider: "deepseek",
      },
    } satisfies Partial<BizError>);
  });

  it("should reject direct chat when the model is not configured for the provider", async () => {
    const { client } = createClient({
      providers: {
        openai: {
          id: "openai",
          chat: vi.fn(),
        },
      },
    });

    await expect(
      client.chatDirect(
        {
          messages: [{ role: "user", content: "ping" }],
          tools: [],
          toolChoice: "none",
        },
        {
          providerId: "openai",
          model: "deepseek-chat",
        },
      ),
    ).rejects.toMatchObject({
      name: "BizError",
      message: "所选 LLM 模型未在当前 provider 中配置",
      meta: {
        provider: "openai",
        model: "deepseek-chat",
      },
    } satisfies Partial<BizError>);
  });

  it("should require explicit model for direct chat", async () => {
    const { client } = createClient({
      providers: {
        openai: {
          id: "openai",
          chat: vi.fn(),
        },
      },
    });

    await expect(
      client.chatDirect(
        {
          messages: [{ role: "user", content: "ping" }],
          tools: [],
          toolChoice: "none",
        },
        {
          providerId: "openai",
          model: "",
        },
      ),
    ).rejects.toThrow("requires model");
  });
});
