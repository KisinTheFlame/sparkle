import { defineJsonRoute } from "@sparkle/http/contract";
import { LlmProviderOptionSchema } from "./llm-chat.js";
import {
  LlmGetChatCallRequestSchema,
  LlmGetChatCallResponseSchema,
  LlmQueryChatCallsRequestSchema,
  LlmQueryChatCallsResponseSchema,
} from "./query.js";
import { z } from "zod";

// chat-direct 的 10 分钟客户端超时用于连接异常兜底；网关每次只执行一个 provider 调用，
// 默认 5 分钟的 provider 超时先返回规整错误，避免调用方先超时重试而上游仍在执行。
const CHAT_TIMEOUT_MS = 600_000;
const QUERY_TIMEOUT_MS = 30_000;
const EMBED_TIMEOUT_MS = 60_000;
// 生图是多秒级操作（模型思考 + 渲染），给 5 分钟兜底超时，远高于现实单次生图时长。
const GENERATE_IMAGE_TIMEOUT_MS = 300_000;

/**
 * chat-direct / embed 的 `request` 是复杂 union（LlmMessage / Tool / EmbeddingRequest），刻意
 * 用 `z.unknown()` 只校验信封外壳、不逐字段 zod —— 这是既有设计（见 internal-llm.handler 注释），非
 * 技术债。output 同理留 `z.unknown()`：**信封级**，服务端返回结构不进 Zod，消费端门面按类型断言。
 * 这些路由的价值是统一 HTTP 管线 + 错误通道 + 超时，而非给复杂 union 加编译期字段校验（那属
 * listProviders 这类真 JSON schema 的路由）。
 */
const EnvelopeRequest = z.unknown();

/**
 * sparkle-llm 进程对 agent 暴露的内部 RPC 契约（单一事实源）。服务端 handler 与 agent 侧 client
 * 都从这里派生类型 —— 改 output，两端一起编译报错（issue #230）。
 *
 * - `listProviders`：真 JSON schema，output 全类型化，是编译期强制的样板。
 * - `chatDirect` / `embed`：信封级（output `z.unknown()`），复杂 union 不逐字段校验，见上。
 */
export const llmApiContract = {
  listProviders: defineJsonRoute({
    method: "GET",
    path: "/internal/providers",
    input: z.object({}),
    output: z.array(LlmProviderOptionSchema),
    // providers 是轻查询：服务真挂/半开的兜底超时，非每次调用时限。
    timeoutMs: QUERY_TIMEOUT_MS,
  }),
  chatDirect: defineJsonRoute({
    method: "POST",
    path: "/internal/chat-direct",
    input: z.object({
      request: EnvelopeRequest,
      providerId: z.string().min(1),
      model: z.string().min(1),
      recordCall: z.boolean().optional(),
      // 归因由调用方携带，网关不按 usage/scene 选择配置。
      trace: z
        .object({
          requestId: z.string().min(1),
          seq: z.number().int().positive(),
          usage: z.string().trim().min(1),
          scene: z.string().trim().min(1),
        })
        .optional(),
    }),
    output: z.unknown(),
    timeoutMs: CHAT_TIMEOUT_MS,
  }),
  embed: defineJsonRoute({
    method: "POST",
    path: "/internal/embed",
    input: z.object({ request: EnvelopeRequest }),
    output: z.unknown(),
    timeoutMs: EMBED_TIMEOUT_MS,
  }),
  // request 是 ImageGenerationRequest（信封级 z.unknown()，同 chat/embed）；output 是 base64 化的
  // GenerateImageResult（见 llm-api/image），亦走信封级、消费端按类型断言。
  generateImage: defineJsonRoute({
    method: "POST",
    path: "/internal/generate-image",
    input: z.object({ request: EnvelopeRequest }),
    output: z.unknown(),
    timeoutMs: GENERATE_IMAGE_TIMEOUT_MS,
  }),
  // —— console 只读查询（epic #539 子 issue 3：llm 独占库后，llm_chat_call 经此查询）——
  queryLlmChatCalls: defineJsonRoute({
    method: "POST",
    path: "/llm/chat-calls/query",
    input: LlmQueryChatCallsRequestSchema,
    output: LlmQueryChatCallsResponseSchema,
    timeoutMs: QUERY_TIMEOUT_MS,
  }),
  getLlmChatCall: defineJsonRoute({
    method: "POST",
    path: "/llm/chat-calls/get",
    input: LlmGetChatCallRequestSchema,
    output: LlmGetChatCallResponseSchema,
    timeoutMs: QUERY_TIMEOUT_MS,
  }),
};
