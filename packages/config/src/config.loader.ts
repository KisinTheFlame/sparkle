import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parse } from "yaml";
import { z } from "zod";
import { BizError } from "@sparkle/shared/errors";
import { LlmProviderIdSchema } from "@sparkle/shared/schemas/llm-chat";
import type { LlmUsageId } from "@sparkle/llm";

const DEFAULT_LLM_TIMEOUT_MS = 45_000;
const DEFAULT_CLAUDE_CODE_BASE_URL = "https://api.anthropic.com";
const DEFAULT_CLAUDE_CODE_MODEL = "claude-sonnet-4-20250514";
const DEFAULT_CLAUDE_CODE_KEEP_ALIVE_REPLAY_INTERVAL_MINUTES = 30;
const DEFAULT_CLAUDE_CODE_AUTH_ENABLED = true;
const DEFAULT_CLAUDE_CODE_AUTH_REDIRECT_PATH = "/callback";
const DEFAULT_CLAUDE_CODE_AUTH_STATE_TTL_MS = 10 * 60 * 1000;
const DEFAULT_CLAUDE_CODE_REFRESH_LEEWAY_MS = 7_200_000;
const DEFAULT_CLAUDE_CODE_REFRESH_CHECK_INTERVAL_MS = 300_000;

const UrlSchema = z.string().url();
const DatabaseUrlSchema = z.string().trim().min(1);
const NonEmptyStringSchema = z.string().trim().min(1);
const PositiveIntSchema = z.preprocess(value => {
  if (typeof value === "string" && value.trim().length > 0) {
    const parsed = Number(value);
    return Number.isNaN(parsed) ? value : parsed;
  }
  return value;
}, z.number().int().positive());
const NonEmptyStringArraySchema = z.array(NonEmptyStringSchema).min(1);

// 服务寻址单源（参考 kagami issue #162）：host 是「别的服务/前端如何 reach 它」，
// 不是绑定地址——各进程一律绑 0.0.0.0，监听端口取自自己的条目。
const ServiceEndpointSchema = z
  .object({
    host: NonEmptyStringSchema,
    port: PositiveIntSchema,
  })
  .strict();

const ServicesSchema = z
  .object({
    agent: ServiceEndpointSchema,
    console: ServiceEndpointSchema,
    web: ServiceEndpointSchema,
  })
  .strict();

const LlmUsageAttemptConfigSchema = z.object({
  provider: LlmProviderIdSchema,
  model: NonEmptyStringSchema,
  times: PositiveIntSchema.default(1),
});

const LlmUsageConfigSchema = z.object({
  attempts: z.array(LlmUsageAttemptConfigSchema).min(1),
});

const ConfigSchema = z.object({
  services: ServicesSchema,
  server: z.object({
    databaseUrl: DatabaseUrlSchema,
    llm: z.object({
      timeoutMs: PositiveIntSchema.default(DEFAULT_LLM_TIMEOUT_MS),
      claudeCodeAuth: z
        .object({
          enabled: z.boolean().default(DEFAULT_CLAUDE_CODE_AUTH_ENABLED),
          // 缺省时在 loadStaticConfig 派生为 http://localhost:${services.web.port}（前门）。
          publicBaseUrl: UrlSchema.optional(),
          oauthRedirectPath: NonEmptyStringSchema.default(DEFAULT_CLAUDE_CODE_AUTH_REDIRECT_PATH),
          oauthStateTtlMs: PositiveIntSchema.default(DEFAULT_CLAUDE_CODE_AUTH_STATE_TTL_MS),
          refreshLeewayMs: PositiveIntSchema.default(DEFAULT_CLAUDE_CODE_REFRESH_LEEWAY_MS),
          refreshCheckIntervalMs: PositiveIntSchema.default(
            DEFAULT_CLAUDE_CODE_REFRESH_CHECK_INTERVAL_MS,
          ),
        })
        .default({}),
      providers: z.object({
        claudeCode: z
          .object({
            baseUrl: UrlSchema.default(DEFAULT_CLAUDE_CODE_BASE_URL),
            models: NonEmptyStringArraySchema,
            keepAliveReplayIntervalMinutes: PositiveIntSchema.default(
              DEFAULT_CLAUDE_CODE_KEEP_ALIVE_REPLAY_INTERVAL_MINUTES,
            ),
          })
          .default({
            models: [DEFAULT_CLAUDE_CODE_MODEL],
            keepAliveReplayIntervalMinutes: DEFAULT_CLAUDE_CODE_KEEP_ALIVE_REPLAY_INTERVAL_MINUTES,
          }),
      }),
      usages: z
        .object({
          agent: LlmUsageConfigSchema,
        })
        .strict(),
    }),
    /**
     * 每个 App 的配置切片，key 是 App.id。结构由各 App 自己的 schema 校验，
     * loader 这一层不解读。
     */
    apps: z.record(z.string(), z.unknown()).default({}),
  }),
});

type RawConfig = z.infer<typeof ConfigSchema>;
type RawClaudeCodeAuth = RawConfig["server"]["llm"]["claudeCodeAuth"];

export type ServiceEndpoint = z.infer<typeof ServiceEndpointSchema>;

export type LlmUsageAttemptConfig = {
  provider: z.infer<typeof LlmProviderIdSchema>;
  model: string;
  times: number;
};

export type LlmUsageConfig = {
  attempts: LlmUsageAttemptConfig[];
};

export type Config = Omit<RawConfig, "server"> & {
  server: Omit<RawConfig["server"], "llm"> & {
    llm: Omit<RawConfig["server"]["llm"], "usages" | "claudeCodeAuth"> & {
      claudeCodeAuth: Omit<RawClaudeCodeAuth, "publicBaseUrl"> & { publicBaseUrl: string };
      usages: Record<LlmUsageId, LlmUsageConfig>;
    };
  };
};

type LoadStaticConfigOptions = {
  configPath?: string;
};

export async function loadStaticConfig(options: LoadStaticConfigOptions = {}): Promise<Config> {
  const configPath = options.configPath ?? resolveConfigPath();

  let fileContent: string;
  try {
    fileContent = await readFile(configPath, "utf8");
  } catch (error) {
    throw new BizError({
      message: "读取配置文件失败",
      meta: { key: configPath, reason: "CONFIG_READ_FAILED" },
      cause: error,
    });
  }

  let parsedYaml: unknown;
  try {
    parsedYaml = parse(fileContent);
  } catch (error) {
    throw new BizError({
      message: "配置文件不是合法的 YAML",
      meta: { key: configPath, reason: "CONFIG_INVALID" },
      cause: error,
    });
  }

  const parsedConfig = ConfigSchema.safeParse(parsedYaml);
  if (!parsedConfig.success) {
    const issue = parsedConfig.error.issues[0];
    const key = issue?.path.length ? issue.path.join(".") : configPath;
    throw new BizError({
      message: "配置值不合法",
      meta: { key, reason: "CONFIG_INVALID" },
      cause: parsedConfig.error,
    });
  }

  const configDir = path.dirname(configPath);
  const data = parsedConfig.data;

  return {
    ...data,
    server: {
      ...data.server,
      databaseUrl: resolveSqliteFileUrl(configDir, data.server.databaseUrl),
      llm: {
        ...data.server.llm,
        claudeCodeAuth: {
          ...data.server.llm.claudeCodeAuth,
          // 前门 origin 默认派生自 services.web 端口（host 固定 localhost：
          // reachable host ≠ 浏览器可访问的 public origin）；可被显式覆盖。
          publicBaseUrl:
            data.server.llm.claudeCodeAuth.publicBaseUrl ??
            `http://localhost:${data.services.web.port}`,
        },
        usages: {
          agent: data.server.llm.usages.agent,
        },
      },
    },
  };
}

function resolveSqliteFileUrl(baseDir: string, value: string): string {
  if (!value.startsWith("file:") || value === "file::memory:") {
    return value;
  }

  const raw = value.slice("file:".length);
  const absolute = path.isAbsolute(raw) ? raw : path.resolve(baseDir, raw);
  return `file:${absolute}`;
}

function resolveConfigPath(): string {
  const candidates = [
    path.resolve(process.cwd(), "config.yaml"),
    path.resolve(process.cwd(), "../../config.yaml"),
    fileURLToPath(new URL("../../../../config.yaml", import.meta.url)),
  ];

  for (const candidate of candidates) {
    if (existsSync(candidate)) {
      return candidate;
    }
  }

  throw new BizError({
    message: "未找到 config.yaml",
    meta: { key: "config.yaml", reason: "CONFIG_NOT_FOUND" },
  });
}
