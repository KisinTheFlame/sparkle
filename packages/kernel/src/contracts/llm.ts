// LLM 各调用点的用途标识（落库归因用）。provider 标识（`LlmProviderId`）的单源另在 @sparkle/llm。
// 骨架只保留通用的 "agent"；各 App 定义自己的用途时在此并集追加（config 的 usages 同步扩展）。
export type LlmUsageId = "agent";
