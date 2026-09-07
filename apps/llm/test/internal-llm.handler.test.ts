import { afterEach, describe, expect, it, vi } from "vitest";
import type { FastifyInstance } from "fastify";
import { BizError } from "@sparkle/kernel/errors/biz-error";
import { isBizErrorWire } from "@sparkle/kernel/errors/biz-error-wire";
import type { LlmClient } from "@sparkle/llm-client";
import type { EmbeddingClient } from "@sparkle/llm-client/embedding";
import type { ImageClient } from "@sparkle/llm-client/image";
import { createLlmServiceApp } from "../src/app/llm-service-runtime.js";
import { InternalLlmHandler } from "../src/http/internal-llm.handler.js";
import { initLoggerRuntime } from "@sparkle/kernel/logger/runtime";

initLoggerRuntime({ sinks: [{ write: () => {} }] });

function buildApp(overrides?: {
  llmClient?: Partial<LlmClient>;
  embeddingClient?: Partial<EmbeddingClient>;
  imageClient?: Partial<ImageClient>;
}): FastifyInstance {
  const llmClient = {
    chatDirect: vi.fn(),
    listAvailableProviders: vi.fn(),
    ...overrides?.llmClient,
  } as unknown as LlmClient;
  const embeddingClient = {
    embed: vi.fn(),
    ...overrides?.embeddingClient,
  } as unknown as EmbeddingClient;
  const imageClient = {
    generate: vi.fn(),
    ...overrides?.imageClient,
  } as unknown as ImageClient;
  return createLlmServiceApp({
    handlers: [new InternalLlmHandler({ llmClient, embeddingClient, imageClient })],
  });
}

let app: FastifyInstance | null = null;
afterEach(async () => {
  if (app) {
    await app.close();
    app = null;
  }
});

describe("InternalLlmHandler", () => {
  it("rejects incomplete trace envelopes before execution and exposes no usage-routing endpoint", async () => {
    const chatDirect = vi.fn();
    app = buildApp({ llmClient: { chatDirect } });
    const malformed = await app.inject({
      method: "POST",
      url: "/internal/chat-direct",
      payload: {
        request: {},
        providerId: "openai",
        model: "m",
        trace: { requestId: "call-1", seq: 0 },
      },
    });
    expect(malformed.statusCode).toBe(400);
    expect(chatDirect).not.toHaveBeenCalled();
    const retired = await app.inject({
      method: "POST",
      url: "/internal/chat",
      payload: { request: {}, usage: "agent", scene: "agent" },
    });
    expect(retired.statusCode).toBe(404);
  });

  it("routes /internal/chat-direct to LlmClient.chatDirect and returns the payload", async () => {
    const chatDirect = vi
      .fn()
      .mockResolvedValue({ provider: "openai", model: "m", message: { role: "assistant" } });
    app = buildApp({ llmClient: { chatDirect } });

    const response = await app.inject({
      method: "POST",
      url: "/internal/chat-direct",
      payload: {
        request: { messages: [{ role: "user", content: "ping" }], tools: [], toolChoice: "none" },
        providerId: "openai",
        model: "m",
        trace: { requestId: "request-1", seq: 2, usage: "custom-caller", scene: "work" },
      },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({ provider: "openai", model: "m" });
    expect(chatDirect).toHaveBeenCalledWith(
      { messages: [{ role: "user", content: "ping" }], tools: [], toolChoice: "none" },
      {
        signal: expect.any(AbortSignal),
        providerId: "openai",
        model: "m",
        trace: { requestId: "request-1", seq: 2, usage: "custom-caller", scene: "work" },
      },
    );
  });

  it("serializes a thrown BizError into the rich error envelope", async () => {
    const chatDirect = vi.fn().mockRejectedValue(
      new BizError({
        message: "所选 LLM provider 当前不可用",
        meta: { provider: "openai" },
        statusCode: 503,
      }),
    );
    app = buildApp({ llmClient: { chatDirect } });

    const response = await app.inject({
      method: "POST",
      url: "/internal/chat-direct",
      payload: { request: {}, providerId: "openai", model: "m" },
    });

    expect(response.statusCode).toBe(503);
    const body = response.json() as { error?: unknown };
    expect(isBizErrorWire(body.error)).toBe(true);
    expect(body.error).toMatchObject({
      name: "BizError",
      message: "所选 LLM provider 当前不可用",
      meta: { provider: "openai" },
      statusCode: 503,
    });
  });

  it("routes /internal/embed to EmbeddingClient.embed", async () => {
    const embed = vi.fn().mockResolvedValue({ provider: "google", model: "e", embedding: [0.1] });
    app = buildApp({ embeddingClient: { embed } });

    const response = await app.inject({
      method: "POST",
      url: "/internal/embed",
      payload: {
        request: { content: "hi", taskType: "RETRIEVAL_QUERY", outputDimensionality: 768 },
      },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ provider: "google", model: "e", embedding: [0.1] });
  });

  it("routes /internal/generate-image and base64-encodes the raw bytes", async () => {
    const generate = vi.fn().mockResolvedValue({
      provider: "openai-codex",
      model: "gpt-5.4",
      image: { data: new Uint8Array([1, 2, 3]), mimeType: "image/png" },
      revisedPrompt: "a red circle",
      size: "1024x1024",
    });
    app = buildApp({ imageClient: { generate } });

    const response = await app.inject({
      method: "POST",
      url: "/internal/generate-image",
      payload: { request: { prompt: "a red circle" } },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({
      provider: "openai-codex",
      model: "gpt-5.4",
      mimeType: "image/png",
      imageBase64: Buffer.from([1, 2, 3]).toString("base64"),
      revisedPrompt: "a red circle",
      size: "1024x1024",
    });
    expect(generate).toHaveBeenCalledWith({ prompt: "a red circle" });
  });
});

it("HTTP 调用方断开时取消网关正在执行的模型请求", async () => {
  let upstreamSignal!: AbortSignal;
  const chatDirect = vi.fn((_request, options) => {
    upstreamSignal = options.signal;
    return new Promise<never>((_resolve, reject) => {
      upstreamSignal.addEventListener("abort", () => reject(upstreamSignal.reason), { once: true });
    });
  });
  app = buildApp({ llmClient: { chatDirect } });
  const address = await app.listen({ host: "127.0.0.1", port: 0 });
  const controller = new AbortController();
  const pending = fetch(`${address}/internal/chat-direct`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ request: {}, providerId: "openai", model: "m" }),
    signal: controller.signal,
  }).catch(error => error);
  await vi.waitFor(() => expect(chatDirect).toHaveBeenCalledTimes(1));
  expect(upstreamSignal.aborted).toBe(false);
  controller.abort();
  await pending;
  await vi.waitFor(() => expect(upstreamSignal.aborted).toBe(true));
  expect(chatDirect).toHaveBeenCalledTimes(1);
});
