import { createClient, type JsonClient } from "@sparkle/rpc-client/client";
import { llmApiContract } from "@sparkle/llm-api/contract";
import { llmUpstreamCallFailedError } from "@sparkle/llm-client";
import type {
  LlmClient,
  LlmChatDirectOptions,
  LlmChatResponsePayload,
  LlmChatRequest,
} from "@sparkle/llm-client";
import type { LlmProviderOption } from "@sparkle/llm-api/llm-chat";

// createClient 的默认超时（服务真挂/半开兜底）。chat-direct 的 600s、providers 的 30s
// 都由 llmApiContract 的 timeoutMs 逐路由覆盖，此默认只在契约未指定时兜底。
const DEFAULT_CLIENT_TIMEOUT_MS = 30_000;

type FetchLike = typeof fetch;

/** 单次 LLM 调用的 HTTP Adapter；选模型与重试策略由 agent/runtime/llm-client 持有。 */
export class HttpLlmClient implements LlmClient {
  private readonly api: JsonClient<typeof llmApiContract>;

  public constructor({ baseUrl, fetch: fetchImpl }: { baseUrl: string; fetch?: FetchLike }) {
    // 兜底错误（不可达/超时/非 2xx 无富信封/响应体无效）统一走 llmUpstreamCallFailedError 工厂，
    // 盖 meta.retryable 标记让 isRetryableLlmFailure 判定退避重试；富错误信封 { error: BizErrorWire }
    // 由 createClient 默认 decodeError 重建成等价 BizError（marker 随 meta 穿越 wire）。见 #435。
    this.api = createClient(llmApiContract, {
      baseUrl,
      ...(fetchImpl === undefined ? {} : { fetch: fetchImpl }),
      timeoutMs: DEFAULT_CLIENT_TIMEOUT_MS,
      mapFallbackError: info =>
        llmUpstreamCallFailedError({
          meta: {
            reason: info.reason,
            ...(info.reason === "bad_status" ? { status: info.status } : {}),
          },
          ...(info.reason === "bad_status" ? {} : { cause: info.cause }),
        }),
    });
  }

  public async chatDirect(
    request: LlmChatRequest,
    options: LlmChatDirectOptions,
  ): Promise<LlmChatResponsePayload> {
    return (await this.api.chatDirect(
      {
        request,
        providerId: options.providerId,
        model: options.model,
        ...(options.trace === undefined ? {} : { trace: options.trace }),
        ...(options.recordCall === undefined ? {} : { recordCall: options.recordCall }),
      },
      { signal: options.signal },
    )) as LlmChatResponsePayload;
  }

  public async listAvailableProviders(): Promise<LlmProviderOption[]> {
    return this.api.listProviders({});
  }
}
