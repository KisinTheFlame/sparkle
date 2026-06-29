/**
 * LLM 协议层的消息表示。OpenAI 风格的 user / assistant / tool 三态，完全通用，
 * 不含任何具体 provider 或项目（Kagami / napcat）语义。
 *
 * 这是 Agent Runtime 与 LLM 之间流动的基本单元——`@sparkle/agent-runtime` 的
 * ReAct kernel、Tool、Effect 等都直接用它，不再用 `TMessage` 泛型抽象。
 */

export type LlmToolCall = {
  id: string;
  name: string;
  arguments: Record<string, unknown>;
};

export type LlmTextContentPart = {
  type: "text";
  text: string;
};

export type LlmImageContentPart = {
  type: "image";
  /**
   * 图片内容的 **base64 字符串**（裸 base64，不含 `data:` 前缀）。
   *
   * 刻意用 string 而非 Buffer：图片内容部件会进入主 Agent 的持久上下文（快照 / ledger
   * 都按 JSON 存），而 Buffer 经 JSON 往返会变成 `{ type:"Buffer", data:[...] }` 不再是
   * Buffer——provider 侧 `.toString("base64")` 就会产出 "[object Object]" 这种无效 base64。
   * string 是 JSON 原生、往返不变、且正是各 provider wire 格式所需。生产者在边缘用
   * `buffer.toString("base64")` 转一次即可。
   */
  content: string;
  mimeType: string;
  filename?: string;
};

export type LlmContentPart = LlmTextContentPart | LlmImageContentPart;

/**
 * 把图片内容归一成 base64 字符串。防御性：兼容三种历史/运行时形态——
 * - base64 字符串（当前契约）：原样返回；
 * - Node Buffer（同进程内存中的图，如 vision/playground 同请求构造）：toString("base64")；
 * - JSON 往返后的 Buffer 残骸 `{ type:"Buffer", data:number[] }`（旧持久化数据 / 已中毒的
 *   历史消息）：Buffer.from(data) 还原后转 base64。
 *
 * 这让 provider 对"已经被 JSON 毒过的历史图片消息"也能恢复，无需手动改库。
 */
export function imageContentToBase64(content: unknown): string {
  if (typeof content === "string") {
    return content;
  }
  if (Buffer.isBuffer(content)) {
    return content.toString("base64");
  }
  if (
    content !== null &&
    typeof content === "object" &&
    Array.isArray((content as { data?: unknown }).data)
  ) {
    return Buffer.from((content as { data: number[] }).data).toString("base64");
  }
  return "";
}

export type LlmMessage =
  | { role: "user"; content: string | LlmContentPart[] }
  | { role: "assistant"; content: string; toolCalls: LlmToolCall[] }
  | { role: "tool"; toolCallId: string; content: string };

/** 工具参数的 JSON Schema（仅支持 object 顶层）。 */
export type JsonSchema = {
  type: "object";
  properties: Record<string, unknown>;
  additionalProperties?: boolean | Record<string, unknown>;
};

/**
 * 一个工具对 LLM 的定义（name / description / parameters）。这是 LLM 协议层的
 * "工具定义"——Agent Runtime 的 kernel 把它塞进 chat 请求的 tools 字段，LLM
 * 据此决定调哪个工具。不含执行逻辑（执行是 agent-runtime 的 ToolComponent）。
 */
export type Tool = {
  name: string;
  description?: string;
  parameters: JsonSchema;
};

// ───────────────────────────── Provider 契约 ─────────────────────────────
// LLM provider 的执行契约：协议层之上、具体 provider 实现（如 @sparkle/claude-code）
// 与编排层（@sparkle/llm-client）共同依赖的中立接口。放在 @sparkle/llm 避免重复定义、
// 也避免 claude-code ↔ llm-client 互相依赖。

/** LLM provider 标识。保留完整 union 以便 OAuth 层通用；目前仅实现 claude-code。 */
export type LlmProviderId = "deepseek" | "openai" | "openai-codex" | "claude-code";

/** LLM 用途标识：驱动 client 的多 attempt 路由与配置。AI 员工目前只有主 agent 一个用途。 */
export type LlmUsageId = "agent";

export type LlmToolChoice = "required" | "auto" | "none" | { tool_name: string };

export type LlmUsage = {
  promptTokens?: number;
  completionTokens?: number;
  totalTokens?: number;
  cacheHitTokens?: number;
  cacheMissTokens?: number;
};

/** 进入 provider 边缘的图片输入（内存中的原始字节，发送前转 base64）。 */
export type LlmImageInput = {
  content: Buffer;
  mimeType: string;
  filename?: string;
};

export type LlmChatRequest = {
  system?: string;
  messages: LlmMessage[];
  tools: Tool[];
  toolChoice: LlmToolChoice;
  model?: string;
};

export type LlmChatResponsePayload = {
  provider: LlmProviderId;
  model: string;
  message: Extract<LlmMessage, { role: "assistant" }>;
  usage?: LlmUsage;
};

export type LlmProviderChatResult = {
  response: LlmChatResponsePayload;
  nativeRequestPayload: Record<string, unknown>;
  nativeResponsePayload: Record<string, unknown> | null;
};

export type LlmProviderFailureContext = {
  nativeRequestPayload?: Record<string, unknown> | null;
  nativeResponsePayload?: Record<string, unknown> | null;
  nativeError?: Record<string, unknown> | null;
};

const LLM_PROVIDER_FAILURE_CONTEXT = Symbol("llmProviderFailureContext");

type ErrorWithLlmProviderFailureContext = Error & {
  [LLM_PROVIDER_FAILURE_CONTEXT]?: LlmProviderFailureContext;
};

export interface LlmProvider {
  id: LlmProviderId;
  isAvailable?(): Promise<boolean>;
  chat(request: LlmChatRequest): Promise<LlmProviderChatResult>;
  close?(): void | Promise<void>;
}

export function attachLlmProviderFailureContext<TError extends Error>(
  error: TError,
  context: LlmProviderFailureContext,
): TError {
  const target = error as ErrorWithLlmProviderFailureContext;
  target[LLM_PROVIDER_FAILURE_CONTEXT] = {
    nativeRequestPayload: context.nativeRequestPayload ?? null,
    nativeResponsePayload: context.nativeResponsePayload ?? null,
    nativeError: context.nativeError ?? null,
  };
  return error;
}

export function getLlmProviderFailureContext(error: unknown): LlmProviderFailureContext | null {
  if (!(error instanceof Error)) {
    return null;
  }

  const context = (error as ErrorWithLlmProviderFailureContext)[LLM_PROVIDER_FAILURE_CONTEXT];
  return context ?? null;
}

export function toSerializableLlmNativeRecord(value: unknown): Record<string, unknown> {
  const serialized = toSerializableLlmNativeValue(value);
  if (isRecordValue(serialized)) {
    return serialized;
  }

  return {
    value: serialized,
  };
}

export function toSerializableLlmNativeRecordOrNull(
  value: unknown,
): Record<string, unknown> | null {
  if (value === null || value === undefined) {
    return null;
  }

  return toSerializableLlmNativeRecord(value);
}

function toSerializableLlmNativeValue(value: unknown): unknown {
  try {
    const serialized = JSON.stringify(value, (_key, currentValue) => {
      if (currentValue instanceof Error) {
        const withStatus = currentValue as Error & { status?: unknown; code?: unknown };
        return {
          name: currentValue.name,
          message: currentValue.message,
          stack: currentValue.stack,
          status: typeof withStatus.status === "number" ? withStatus.status : undefined,
          code: typeof withStatus.code === "string" ? withStatus.code : undefined,
        };
      }

      if (currentValue instanceof Date) {
        return currentValue.toISOString();
      }

      if (typeof currentValue === "bigint") {
        return currentValue.toString();
      }

      if (typeof currentValue === "function") {
        return `[Function ${currentValue.name || "anonymous"}]`;
      }

      if (typeof currentValue === "symbol") {
        return currentValue.toString();
      }

      return currentValue;
    });

    if (serialized === undefined) {
      return "undefined";
    }

    return JSON.parse(serialized) as unknown;
  } catch {
    return String(value);
  }
}

function isRecordValue(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
