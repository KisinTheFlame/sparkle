import type { FastifyInstance } from "fastify";
import { registerJsonRoute } from "@sparkle/http/register";
import { llmProvidersViewContract } from "@sparkle/llm-api/providers-view";
import type { LlmProviderListResponse } from "@sparkle/llm-api/llm-chat";
import type { LlmClient } from "@sparkle/llm-client";

/**
 * 管理台「LLM 调用历史」按 provider 过滤用的 provider 列举路由（console-facing，经 gateway
 * `/llm/providers` 前缀直连 sparkle-llm，取代原 agent 中转）。只列举网关可用 provider，不参与调用方的偏好排序。契约 output 是 `{ providers }`，而 listAvailableProviders 回的是数组，故显式包壳。
 */
export class LlmProvidersViewHandler {
  private readonly llmClient: LlmClient;

  public constructor({ llmClient }: { llmClient: LlmClient }) {
    this.llmClient = llmClient;
  }

  public register(app: FastifyInstance): void {
    registerJsonRoute(
      app,
      llmProvidersViewContract.listProviders,
      async (): Promise<LlmProviderListResponse> => {
        return { providers: await this.llmClient.listAvailableProviders() };
      },
    );
  }
}
