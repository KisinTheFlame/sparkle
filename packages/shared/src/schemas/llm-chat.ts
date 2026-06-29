import { z } from "zod";
import { JsonRecordSchema } from "./base.js";

export const LlmProviderIdSchema = z.enum(["deepseek", "openai", "openai-codex", "claude-code"]);

export type LlmProviderId = z.infer<typeof LlmProviderIdSchema>;

export const LlmToolCallPayloadSchema = z
  .object({
    id: z.string().min(1),
    name: z.string().min(1),
    arguments: JsonRecordSchema,
  })
  .strict();

export type LlmToolCallPayload = z.infer<typeof LlmToolCallPayloadSchema>;

export const LlmToolDefinitionSchema = z
  .object({
    name: z.string().min(1),
    description: z.string().optional(),
    // parameters 是开放式 JSON Schema：真实工具普遍带 required / enum / $defs 等关键字，
    // 故只校验 object 顶层骨架、不加 .strict()。
    parameters: z.object({
      type: z.literal("object"),
      properties: JsonRecordSchema,
    }),
  })
  .strict();

export type LlmToolDefinition = z.infer<typeof LlmToolDefinitionSchema>;

export const LlmRequestTextContentPartSchema = z
  .object({
    type: z.literal("text"),
    text: z.string(),
  })
  .strict();

/**
 * user 消息里的图片内容块在落库前已剥掉 base64 原图（见 llm-client 侧
 * `toRecordableChatRequest`），只留元数据：`mimeType` + 可选 `filename` + 原图字节数。
 */
export const LlmRequestImageContentPartSchema = z
  .object({
    type: z.literal("image"),
    mimeType: z.string(),
    filename: z.string().optional(),
    sizeBytes: z.number().int().nonnegative(),
  })
  .strict();

export const LlmRequestUserContentPartSchema = z.discriminatedUnion("type", [
  LlmRequestTextContentPartSchema,
  LlmRequestImageContentPartSchema,
]);

export type LlmRequestUserContentPart = z.infer<typeof LlmRequestUserContentPartSchema>;

export const LlmRequestMessageSchema = z.discriminatedUnion("role", [
  z
    .object({
      role: z.literal("user"),
      content: z.union([z.string(), z.array(LlmRequestUserContentPartSchema)]),
    })
    .strict(),
  z
    .object({
      role: z.literal("assistant"),
      content: z.string(),
      toolCalls: z.array(LlmToolCallPayloadSchema),
    })
    .strict(),
  z
    .object({
      role: z.literal("tool"),
      toolCallId: z.string().min(1),
      content: z.string(),
    })
    .strict(),
]);

export type LlmRequestMessage = z.infer<typeof LlmRequestMessageSchema>;

export const LlmChatRequestPayloadSchema = z
  .object({
    system: z.string().optional(),
    messages: z.array(LlmRequestMessageSchema),
    tools: z.array(LlmToolDefinitionSchema),
    toolChoice: z.union([
      z.literal("required"),
      z.literal("auto"),
      z.literal("none"),
      z
        .object({
          tool_name: z.string().min(1),
        })
        .strict(),
    ]),
    model: z.string().min(1).optional(),
  })
  .strict();

export type LlmChatRequestPayload = z.infer<typeof LlmChatRequestPayloadSchema>;

export const LlmChatResponsePayloadSchema = z
  .object({
    provider: LlmProviderIdSchema,
    model: z.string().min(1),
    message: z
      .object({
        role: z.literal("assistant"),
        content: z.string(),
        toolCalls: z.array(LlmToolCallPayloadSchema),
      })
      .strict(),
    usage: z
      .object({
        promptTokens: z.number().int().nonnegative().optional(),
        completionTokens: z.number().int().nonnegative().optional(),
        totalTokens: z.number().int().nonnegative().optional(),
        cacheHitTokens: z.number().int().nonnegative().optional(),
        cacheMissTokens: z.number().int().nonnegative().optional(),
      })
      .strict()
      .optional(),
  })
  .strict();

export type LlmChatResponsePayload = z.infer<typeof LlmChatResponsePayloadSchema>;

export const LlmChatErrorPayloadSchema = z
  .object({
    name: z.string().min(1),
    message: z.string().min(1),
    code: z.string().min(1).optional(),
  })
  .strict();

export type LlmChatErrorPayload = z.infer<typeof LlmChatErrorPayloadSchema>;

export const LlmChatCallStatusSchema = z.enum(["success", "failed"]);

export type LlmChatCallStatus = z.infer<typeof LlmChatCallStatusSchema>;

export const LlmProviderOptionSchema = z
  .object({
    id: LlmProviderIdSchema,
    models: z.array(z.string().min(1)).min(1),
  })
  .strict();

export type LlmProviderOption = z.infer<typeof LlmProviderOptionSchema>;
