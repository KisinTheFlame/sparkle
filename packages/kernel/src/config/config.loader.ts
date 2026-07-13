import path from "node:path";
import { ConfigError } from "@sparkle/config/errors";
import { loadMergedRawConfig } from "@sparkle/config/source";
import { LLM_PROVIDER_IDS, type LlmProviderId } from "@sparkle/llm";
import { z } from "zod";
import type { LlmUsageId } from "../contracts/llm.js";

const DEFAULT_LLM_TIMEOUT_MS = 45_000;
const DEFAULT_AUTH_USAGE_REFRESH_INTERVAL_MS = 10 * 60 * 1000;
const DEFAULT_PUBLIC_BASE_URL = "http://localhost:4173";
const DEFAULT_DEEPSEEK_BASE_URL = "https://api.deepseek.com";
const DEFAULT_DEEPSEEK_MODEL = "deepseek-chat";
const DEFAULT_OPENAI_BASE_URL = "https://api.openai.com/v1";
const DEFAULT_OPENAI_MODEL = "gpt-5.4";
const DEFAULT_OPENAI_CODEX_BASE_URL = "https://chatgpt.com/backend-api/codex/responses";
const DEFAULT_OPENAI_CODEX_MODEL = "gpt-5.4-codex";
const DEFAULT_CLAUDE_CODE_BASE_URL = "https://api.anthropic.com";
const DEFAULT_CLAUDE_CODE_MODEL = "claude-sonnet-4-20250514";
const DEFAULT_CLAUDE_CODE_KEEP_ALIVE_REPLAY_INTERVAL_MINUTES = 30;
const DEFAULT_CODEX_AUTH_ENABLED = true;
const DEFAULT_CODEX_AUTH_REDIRECT_PATH = "/auth/callback";
const DEFAULT_CODEX_AUTH_STATE_TTL_MS = 10 * 60 * 1000;
const DEFAULT_OPENAI_CODEX_REFRESH_LEEWAY_MS = 60_000;
const DEFAULT_OPENAI_CODEX_REFRESH_CHECK_INTERVAL_MS = 60_000;
const DEFAULT_CODEX_AUTH_BINARY_PATH = "codex";
const DEFAULT_CLAUDE_CODE_AUTH_ENABLED = true;
const DEFAULT_CLAUDE_CODE_AUTH_REDIRECT_PATH = "/callback";
const DEFAULT_CLAUDE_CODE_AUTH_STATE_TTL_MS = 10 * 60 * 1000;
const DEFAULT_CLAUDE_CODE_REFRESH_LEEWAY_MS = 7_200_000;
const DEFAULT_CLAUDE_CODE_REFRESH_CHECK_INTERVAL_MS = 300_000;
const DEFAULT_GEMINI_EMBEDDING_BASE_URL = "https://generativelanguage.googleapis.com";
const DEFAULT_GEMINI_EMBEDDING_MODEL = "gemini-embedding-001";
const DEFAULT_GEMINI_EMBEDDING_OUTPUT_DIMENSIONALITY = 768;
const DEFAULT_OPENAI_CODEX_IMAGE_MODEL = "gpt-5.4";

const UrlSchema = z.string().url();
/**
 * `databaseUrl` 现为 SQLite 文件路径（`file:./data/sparkle.db`），不再是网络 URL，
 * 因此只校验非空字符串；绝对路径解析在 {@link loadStaticConfig} 中完成。
 */
const DatabaseUrlSchema = z.string().trim().min(1);
const NonEmptyStringSchema = z.string().trim().min(1);
const OptionalNonEmptyStringSchema = z
  .string()
  .trim()
  .transform(value => (value.length === 0 ? undefined : value))
  .optional();
const PositiveIntSchema = z.preprocess(value => {
  if (typeof value === "string" && value.trim().length > 0) {
    const parsed = Number(value);
    return Number.isNaN(parsed) ? value : parsed;
  }

  return value;
}, z.number().int().positive());
const OpenAiDefaultableStringSchema = z.preprocess(value => {
  if (typeof value === "string" && value.trim().length === 0) {
    return undefined;
  }

  return value;
}, z.string().trim().min(1).optional());
const NonEmptyStringArraySchema = z.array(NonEmptyStringSchema).min(1);
const LlmProviderSchema = z.enum(LLM_PROVIDER_IDS);
const GoogleEmbeddingConfigSchema = z.object({
  provider: z.literal("google"),
  apiKey: NonEmptyStringSchema,
  baseUrl: UrlSchema.default(DEFAULT_GEMINI_EMBEDDING_BASE_URL),
  model: NonEmptyStringSchema.default(DEFAULT_GEMINI_EMBEDDING_MODEL),
  outputDimensionality: PositiveIntSchema.default(DEFAULT_GEMINI_EMBEDDING_OUTPUT_DIMENSIONALITY),
});
const TeiEmbeddingGemmaConfigSchema = z.object({
  provider: z.literal("tei-embedding-gemma"),
  baseUrl: UrlSchema,
  model: NonEmptyStringSchema,
  outputDimensionality: PositiveIntSchema,
});
const EmbeddingConfigSchema = z.preprocess(
  value => {
    if (!value || typeof value !== "object" || Array.isArray(value)) {
      return value;
    }

    const record = value as Record<string, unknown>;
    if ("provider" in record) {
      return value;
    }

    return {
      ...record,
      provider: "google",
    };
  },
  z.discriminatedUnion("provider", [GoogleEmbeddingConfigSchema, TeiEmbeddingGemmaConfigSchema]),
);
// 生图 provider 配置。openai-codex 走 OAuth（同 chat 的 openaiCodex），故无 apiKey 字段——凭据由
// runtime 注入 authModule.authServices.codex。判别联合当前仅一个成员，未来加 openai 平台生图再补。
const OpenAiCodexImageConfigSchema = z.object({
  provider: z.literal("openai-codex"),
  baseUrl: UrlSchema.default(DEFAULT_OPENAI_CODEX_BASE_URL),
  model: NonEmptyStringSchema.default(DEFAULT_OPENAI_CODEX_IMAGE_MODEL),
});
const ImageConfigSchema = z.discriminatedUnion("provider", [OpenAiCodexImageConfigSchema]);
const LlmUsageAttemptConfigSchema = z.object({
  provider: LlmProviderSchema,
  model: NonEmptyStringSchema,
  times: PositiveIntSchema.default(1),
});
const LlmUsageConfigSchema = z.object({
  attempts: z.array(LlmUsageAttemptConfigSchema).min(1),
});

/**
 * Sparkle 基建骨架的配置契约（app-less 极简版）。
 *
 * 相比上游 Kagami 已裁掉整套业务/服务拓扑（services 端点、server.agent / ithome /
 * napcat / bot / oss / apps），只保留平台底座实际消费的部分：
 *   - server.databaseUrl —— @sparkle/persistence 的 SQLite 库。
 *   - server.publicBaseUrl —— OAuth 回调对外可访问的 origin（单源，替代原先从
 *     services.gateway 端口派生）。
 *   - server.llm —— LLM 网关能力（@sparkle/llm-client / @sparkle/auth 消费）。
 * App 落地时在此按需追加自己的 services / server 切片。
 */
const ConfigSchema = z.object({
  server: z.object({
    databaseUrl: DatabaseUrlSchema,
    publicBaseUrl: UrlSchema.default(DEFAULT_PUBLIC_BASE_URL),
    llm: z.object({
      timeoutMs: PositiveIntSchema.default(DEFAULT_LLM_TIMEOUT_MS),
      authUsageRefreshIntervalMs: PositiveIntSchema.default(DEFAULT_AUTH_USAGE_REFRESH_INTERVAL_MS),
      // 文本向量化配置：LLM 客户端持有 embedding client。与任何具体上层能力（记忆等）解耦。
      embedding: EmbeddingConfigSchema,
      // 生图配置：走 openai-codex OAuth（ChatGPT 订阅额度）。给默认，省略整段也能起。
      image: ImageConfigSchema.default({ provider: "openai-codex" }),
      codexAuth: z
        .object({
          enabled: z.boolean().default(DEFAULT_CODEX_AUTH_ENABLED),
          // 缺省时在 loadStaticConfig 里派生为 server.publicBaseUrl。可显式覆盖。
          publicBaseUrl: UrlSchema.optional(),
          oauthRedirectPath: z.string().trim().min(1).default(DEFAULT_CODEX_AUTH_REDIRECT_PATH),
          oauthStateTtlMs: PositiveIntSchema.default(DEFAULT_CODEX_AUTH_STATE_TTL_MS),
          refreshLeewayMs: PositiveIntSchema.default(DEFAULT_OPENAI_CODEX_REFRESH_LEEWAY_MS),
          refreshCheckIntervalMs: PositiveIntSchema.default(
            DEFAULT_OPENAI_CODEX_REFRESH_CHECK_INTERVAL_MS,
          ),
          binaryPath: NonEmptyStringSchema.default(DEFAULT_CODEX_AUTH_BINARY_PATH),
        })
        .default({}),
      claudeCodeAuth: z
        .object({
          enabled: z.boolean().default(DEFAULT_CLAUDE_CODE_AUTH_ENABLED),
          // 同 codexAuth：缺省派生 server.publicBaseUrl，可显式覆盖。
          publicBaseUrl: UrlSchema.optional(),
          oauthRedirectPath: z
            .string()
            .trim()
            .min(1)
            .default(DEFAULT_CLAUDE_CODE_AUTH_REDIRECT_PATH),
          oauthStateTtlMs: PositiveIntSchema.default(DEFAULT_CLAUDE_CODE_AUTH_STATE_TTL_MS),
          refreshLeewayMs: PositiveIntSchema.default(DEFAULT_CLAUDE_CODE_REFRESH_LEEWAY_MS),
          refreshCheckIntervalMs: PositiveIntSchema.default(
            DEFAULT_CLAUDE_CODE_REFRESH_CHECK_INTERVAL_MS,
          ),
        })
        .default({}),
      // 各 provider 均给默认（含 models 占位），整段 providers 可省略——骨架默认只需
      // claude-code 一条链路即可起；用到 deepseek / openai 时再填真实 models / apiKey。
      providers: z
        .object({
        deepseek: z
          .object({
            apiKey: OptionalNonEmptyStringSchema,
            baseUrl: UrlSchema.default(DEFAULT_DEEPSEEK_BASE_URL),
            models: NonEmptyStringArraySchema.default([DEFAULT_DEEPSEEK_MODEL]),
          })
          .default({}),
        openai: z
          .object({
            apiKey: OptionalNonEmptyStringSchema,
            baseUrl: OpenAiDefaultableStringSchema.default(DEFAULT_OPENAI_BASE_URL),
            models: NonEmptyStringArraySchema.default([DEFAULT_OPENAI_MODEL]),
          })
          .default({}),
        openaiCodex: z
          .object({
            baseUrl: UrlSchema.default(DEFAULT_OPENAI_CODEX_BASE_URL),
            models: NonEmptyStringArraySchema.default([DEFAULT_OPENAI_CODEX_MODEL]),
          })
          .default({}),
        claudeCode: z
          .object({
            baseUrl: UrlSchema.default(DEFAULT_CLAUDE_CODE_BASE_URL),
            models: NonEmptyStringArraySchema,
            keepAliveReplayIntervalMinutes: PositiveIntSchema.default(
              DEFAULT_CLAUDE_CODE_KEEP_ALIVE_REPLAY_INTERVAL_MINUTES,
            ),
            // 图片走 Anthropic Files API（上传拿 file_id，请求体不再随 base64 膨胀撞 ~32MB 上限）。
            // 关掉即回退全 base64。依赖 OAuth scope 含 user:file_upload。
            useFileApi: z.boolean().default(true),
            // File API 缓存的按最近使用时间 GC。File 文件 persist-until-deleted，不清理会撞组织存储配额。
            fileCacheGcEnabled: z.boolean().default(true),
            // 连续多少天未被使用即回收（idle）。
            fileCacheGcMaxIdleDays: PositiveIntSchema.default(3),
            // 单轮 GC 最多删多少个：防首轮积压一次性猛敲 API。
            fileCacheGcMaxDeletionsPerRun: PositiveIntSchema.default(2000),
          })
          .default({
            models: [DEFAULT_CLAUDE_CODE_MODEL],
            keepAliveReplayIntervalMinutes: DEFAULT_CLAUDE_CODE_KEEP_ALIVE_REPLAY_INTERVAL_MINUTES,
          }),
        })
        .default({}),
      usages: z
        .object({
          agent: LlmUsageConfigSchema,
        })
        .strict(),
    }),
  }),
});

type LlmUsageAttemptConfig = {
  provider: LlmProviderId;
  model: string;
  times: number;
};

type LlmUsageConfig = {
  attempts: LlmUsageAttemptConfig[];
};

type RawConfig = z.infer<typeof ConfigSchema>;
type RawServerLlm = RawConfig["server"]["llm"];

export type Config = Omit<RawConfig, "server"> & {
  server: Omit<RawConfig["server"], "llm"> & {
    llm: Omit<RawServerLlm, "usages" | "codexAuth" | "claudeCodeAuth"> & {
      usages: Record<LlmUsageId, LlmUsageConfig>;
      // publicBaseUrl 在 loader 里派生填充，对外恒为 string。
      codexAuth: Omit<RawServerLlm["codexAuth"], "publicBaseUrl"> & { publicBaseUrl: string };
      claudeCodeAuth: Omit<RawServerLlm["claudeCodeAuth"], "publicBaseUrl"> & {
        publicBaseUrl: string;
      };
    };
  };
};

type LoadStaticConfigOptions = {
  configPath?: string;
};

export async function loadStaticConfig(options: LoadStaticConfigOptions = {}): Promise<Config> {
  const { configPath, raw } = await loadMergedRawConfig({
    configPath: options.configPath,
    anchorUrl: import.meta.url,
    // secret（config.secret.yaml）可覆盖任意字段——单人项目，不再维护隐私路径白名单。
    // 凭据仍只放 gitignored 的 config.secret.yaml；原型污染由 @sparkle/config 的深合并兜底。
    secret: { required: true },
  });

  const parsedConfig = ConfigSchema.safeParse(raw);
  if (!parsedConfig.success) {
    const issue = parsedConfig.error.issues[0];
    const key = issue?.path.length ? issue.path.join(".") : configPath;
    throw new ConfigError({
      message: "配置值不合法",
      meta: {
        key,
        reason: "CONFIG_INVALID",
      },
      cause: parsedConfig.error,
    });
  }

  const configDir = path.dirname(configPath);
  const data = parsedConfig.data;
  // OAuth 回调 origin：缺省取 server.publicBaseUrl（单源）；各 auth 块可显式覆盖。
  const defaultPublicBaseUrl = data.server.publicBaseUrl;

  return {
    ...data,
    server: {
      ...data.server,
      databaseUrl: resolveSqliteFileUrl(configDir, data.server.databaseUrl),
      llm: {
        ...data.server.llm,
        usages: normalizeLlmUsages(data.server.llm),
        codexAuth: {
          ...data.server.llm.codexAuth,
          publicBaseUrl: data.server.llm.codexAuth.publicBaseUrl ?? defaultPublicBaseUrl,
        },
        claudeCodeAuth: {
          ...data.server.llm.claudeCodeAuth,
          publicBaseUrl: data.server.llm.claudeCodeAuth.publicBaseUrl ?? defaultPublicBaseUrl,
        },
      },
    },
  };
}

function stripFileScheme(value: string): string {
  return value.startsWith("file:") ? value.slice("file:".length) : value;
}

function resolveAbsolutePath(baseDir: string, value: string): string {
  const raw = stripFileScheme(value);
  return path.isAbsolute(raw) ? raw : path.resolve(baseDir, raw);
}

/**
 * 将 config 中相对仓库根的 SQLite 路径解析为绝对 `file:` URL，运行时与 Prisma CLI
 * 共用同一锚点（config.yaml 所在目录），避免在不同 cwd 下建出两个库。只处理 `file:`
 * 路径；`file::memory:`、`:memory:` 及其它 scheme 原样返回。
 */
function resolveSqliteFileUrl(baseDir: string, value: string): string {
  if (!value.startsWith("file:") || value === "file::memory:") {
    return value;
  }

  return `file:${resolveAbsolutePath(baseDir, value)}`;
}

function normalizeLlmUsages(input: RawConfig["server"]["llm"]): Record<LlmUsageId, LlmUsageConfig> {
  return {
    agent: normalizeUsageConfig(input.usages.agent),
  };
}

function normalizeUsageConfig(
  value: RawConfig["server"]["llm"]["usages"]["agent"],
): LlmUsageConfig {
  return {
    attempts: value.attempts.map(attempt => normalizeUsageAttempt(attempt)),
  };
}

function normalizeUsageAttempt(
  value: RawConfig["server"]["llm"]["usages"]["agent"]["attempts"][number],
): LlmUsageAttemptConfig {
  return {
    provider: value.provider,
    model: value.model,
    times: value.times,
  };
}
