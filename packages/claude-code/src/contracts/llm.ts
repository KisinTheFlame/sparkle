// LLM provider 标识。保留完整 union 以便 OAuth 层（codex / claude-code）通用；
// 本包仅实现 claude-code。
export type LlmProviderId = "deepseek" | "openai" | "openai-codex" | "claude-code";
