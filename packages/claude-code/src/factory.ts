import { type AuthUsageLimitsResponse } from "@sparkle/shared/schemas/auth";
import {
  buildClaudeCodeAuthorizeUrl,
  exchangeCodeForTokens as exchangeClaudeCodeTokens,
  refreshClaudeCodeTokens,
} from "./auth/claude-code/oauth.js";
import { PlainTextClaudeCodeAuthSecretStore } from "./auth/claude-code/secret-store.js";
import type { ClaudeCodeAuthSessionRecord } from "./auth/claude-code/types.js";
import type { ClaudeCodeAuthService } from "./auth/application/claude-code-auth.service.js";
import {
  DefaultOAuthAuthService,
  type OAuthAuthService,
} from "./auth/application/oauth-auth.service.js";
import { SharedOAuthCallbackServer } from "./auth/shared/callback-server.js";
import { InMemoryOAuthDao } from "./auth/shared/in-memory-dao.js";
import type { OAuthDao, OAuthRuntimeConfig, OAuthSecretStore } from "./auth/shared/types.js";

const CLAUDE_CODE_CALLBACK_PORT = 54545;
const CLAUDE_CODE_CALLBACK_PATH = "/callback";

export type CreateClaudeCodeAuthInput = {
  config: OAuthRuntimeConfig;
  /** 持久化注入点；默认进程内内存实现（重启即丢，生产请注入持久化实现）。 */
  dao?: OAuthDao<"claude-code", ClaudeCodeAuthSessionRecord>;
  /** 票据加密注入点；默认明文（不加密）。 */
  secretStore?: OAuthSecretStore;
  callbackServer?: {
    host?: string;
    port?: number;
    path?: string;
  };
};

export type ClaudeCodeAuthModule = {
  authService: ClaudeCodeAuthService;
  callbackServer: SharedOAuthCallbackServer<OAuthAuthService>;
};

/**
 * 装配 Claude Code 的 OAuth 登录服务（含本地回调服务器）。原 kagami 的 createAuthModule
 * 把 codex / usage 缓存 / 刷新调度 / Prisma / HTTP handler 一并装配；这里只聚焦 claude-code，
 * 并将 config / dao / secretStore 全部作为注入点。
 */
export function createClaudeCodeAuthService(input: CreateClaudeCodeAuthInput): ClaudeCodeAuthModule {
  const port = input.callbackServer?.port ?? CLAUDE_CODE_CALLBACK_PORT;
  const path = input.callbackServer?.path ?? CLAUDE_CODE_CALLBACK_PATH;

  const callbackServer = new SharedOAuthCallbackServer<OAuthAuthService>({
    host: input.callbackServer?.host ?? "127.0.0.1",
    port,
    path,
    displayName: "Claude Code",
  });

  const authService = new DefaultOAuthAuthService({
    publicProvider: "claude-code",
    internalProvider: "claude-code",
    displayName: "Claude Code",
    managementPath: "/auth/claude-code",
    autoRefreshOnGetAuth: false,
    dao: input.dao ?? new InMemoryOAuthDao<"claude-code">(),
    config: input.config,
    callbackServer,
    secretStore: input.secretStore ?? new PlainTextClaudeCodeAuthSecretStore(),
    protocolAdapter: {
      buildAuthorizeUrl: buildClaudeCodeAuthorizeUrl,
      exchangeCodeForTokens: adapterInput =>
        exchangeClaudeCodeTokens({
          code: adapterInput.code,
          state: adapterInput.state,
          codeVerifier: adapterInput.codeVerifier,
          redirectUri: adapterInput.redirectUri,
          config: adapterInput.config,
        }),
      refreshTokens: refreshClaudeCodeTokens,
      getRedirectUri: () => `http://localhost:${port}${path}`,
    },
    createEmptyUsageLimits: () =>
      ({
        provider: "claude-code",
        limits: {
          five_hour: null,
          seven_day: null,
          extra_usage: null,
        },
      }) satisfies AuthUsageLimitsResponse,
  });
  callbackServer.setAuthService(authService);

  return { authService, callbackServer };
}
