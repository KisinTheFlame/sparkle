import type { FastifyInstance } from "fastify";
import { registerJsonRoute } from "@sparkle/http/register";
import { llmApiContract } from "@sparkle/llm-api/contract";
import type { LlmProviderId } from "@sparkle/llm";
import type { LlmClient, LlmChatRequest } from "@sparkle/llm-client";
import type { EmbeddingClient, EmbeddingRequest } from "@sparkle/llm-client/embedding";
import type { ImageClient, ImageGenerationRequest } from "@sparkle/llm-client/image";
import type { GenerateImageResult } from "@sparkle/llm-api/image";

// Agent-facing 内部 RPC，全量走 @sparkle/llm-api 契约（单一事实源，与 agent 侧 createClient 共享 schema）。
// chat-direct/embed 的 request 是可信内部契约（agent 直连、仅 localhost）的复杂 union（LlmMessage/
// Tool/EmbeddingRequest），契约刻意用 z.unknown() 只校验信封、透传后按类型断言——见 llm-api/contract。
// 抛出的 BizError 由 runtime setErrorHandler 统一序列化成富错误信封，agent 侧据此重建 BizError。
export class InternalLlmHandler {
  private readonly llmClient: LlmClient;
  private readonly embeddingClient: EmbeddingClient;
  private readonly imageClient: ImageClient;

  public constructor({
    llmClient,
    embeddingClient,
    imageClient,
  }: {
    llmClient: LlmClient;
    embeddingClient: EmbeddingClient;
    imageClient: ImageClient;
  }) {
    this.llmClient = llmClient;
    this.embeddingClient = embeddingClient;
    this.imageClient = imageClient;
  }

  public register(app: FastifyInstance): void {
    registerJsonRoute(app, llmApiContract.chatDirect, async ({ input, request, reply }) => {
      const controller = new AbortController();
      const abort = (): void => {
        controller.abort();
      };
      const onClose = (): void => {
        if (!reply.raw.writableEnded) abort();
      };
      request.raw.on("aborted", abort);
      reply.raw.on("close", onClose);
      if (request.raw.aborted || reply.raw.destroyed) abort();
      try {
        return await this.llmClient.chatDirect(input.request as LlmChatRequest, {
          signal: controller.signal,
          providerId: input.providerId as LlmProviderId,
          model: input.model,
          ...(input.trace === undefined ? {} : { trace: input.trace }),
          ...(input.recordCall === undefined ? {} : { recordCall: input.recordCall }),
        });
      } finally {
        request.raw.off("aborted", abort);
        reply.raw.off("close", onClose);
      }
    });

    // providers 路由是编译期强制样板：input/output 由 llmApiContract.listProviders 反推，与 agent 侧
    // createClient 共享同一份 schema —— 改契约 output，此 execute 返回类型与 agent 调用点同时红。
    registerJsonRoute(app, llmApiContract.listProviders, async () => {
      return await this.llmClient.listAvailableProviders();
    });

    registerJsonRoute(app, llmApiContract.embed, async ({ input }) => {
      return await this.embeddingClient.embed(input.request as EmbeddingRequest);
    });

    // 生图：抽象层回原始字节，这里在 HTTP 边界 base64 化成 GenerateImageResult wire DTO。
    registerJsonRoute(app, llmApiContract.generateImage, async ({ input }) => {
      const result = await this.imageClient.generate(input.request as ImageGenerationRequest);
      const wire: GenerateImageResult = {
        provider: result.provider,
        model: result.model,
        mimeType: result.image.mimeType,
        imageBase64: Buffer.from(result.image.data).toString("base64"),
        ...(result.revisedPrompt ? { revisedPrompt: result.revisedPrompt } : {}),
        ...(result.size ? { size: result.size } : {}),
      };
      return wire;
    });
  }
}
