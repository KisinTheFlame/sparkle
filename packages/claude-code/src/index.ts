import { noopLogger } from "./logger.js";
import type { Logger } from "./logger.js";
import { createClaudeCodeProvider } from "./llm/providers/claude-code-provider.js";
import type { LlmProviderConfig } from "./llm/providers/claude-code-provider.js";
import { ClaudeCodeAuthStore } from "./llm/providers/claude-code-auth.js";
import type { ClaudeCodeAuth } from "./llm/providers/claude-code-auth.js";
import { createClaudeCodeAuthService } from "./factory.js";
import type { ClaudeCodeAuthModule, CreateClaudeCodeAuthInput } from "./factory.js";
import {
  assertInternalAuthProvider,
  createEmptyAuthStatusResponse,
  DefaultOAuthAuthService,
} from "./auth/application/oauth-auth.service.js";
import type { OAuthAuthService } from "./auth/application/oauth-auth.service.js";
import type {
  ClaudeCodeAuthService,
  HandleClaudeCodeAuthCallbackInput,
  HandleClaudeCodeAuthCallbackResult,
} from "./auth/application/claude-code-auth.service.js";
import { SharedOAuthServiceCore } from "./auth/shared/service.js";
import { buildOAuthCallbackUrl, SharedOAuthCallbackServer } from "./auth/shared/callback-server.js";
import { InMemoryOAuthDao } from "./auth/shared/in-memory-dao.js";
import { createPkcePair } from "./auth/shared/pkce.js";
import type { PkcePair } from "./auth/shared/pkce.js";
import type {
  CreateOAuthStateInput,
  OAuthCallbackHandler,
  OAuthCallbackInput,
  OAuthCallbackResult,
  OAuthCallbackServerLike,
  OAuthDao,
  OAuthLoginUrlResponse,
  OAuthLogoutResponse,
  OAuthProviderAuth,
  OAuthRuntimeConfig,
  OAuthSecretStore,
  OAuthSessionRecord,
  OAuthStateRecord,
  OAuthStatus,
  OAuthTokenResponse,
  UpsertOAuthSessionInput,
} from "./auth/shared/types.js";
import {
  AUTH_PROVIDER_PAIRS,
  toInternalAuthProvider,
  toPublicAuthProvider,
} from "./auth/domain/auth-provider.js";
import type { InternalAuthProvider } from "./auth/domain/auth-provider.js";
import {
  buildClaudeCodeAuthorizeUrl,
  exchangeCodeForTokens,
  refreshClaudeCodeTokens,
} from "./auth/claude-code/oauth.js";
import type { ClaudeCodePkcePair } from "./auth/claude-code/oauth.js";
import type {
  ClaudeCodeAuthSessionRecord,
  ClaudeCodeAuthStatus,
  ClaudeCodeOAuthStateRecord,
  ClaudeCodeProviderAuth,
  ClaudeCodeTokenResponse,
} from "./auth/claude-code/types.js";
import { PlainTextClaudeCodeAuthSecretStore } from "./auth/claude-code/secret-store.js";
import type { ClaudeCodeAuthSecretStore } from "./auth/claude-code/secret-store.js";

export {
  AUTH_PROVIDER_PAIRS,
  assertInternalAuthProvider,
  buildClaudeCodeAuthorizeUrl,
  buildOAuthCallbackUrl,
  ClaudeCodeAuthStore,
  createClaudeCodeAuthService,
  createClaudeCodeProvider,
  createEmptyAuthStatusResponse,
  createPkcePair,
  DefaultOAuthAuthService,
  exchangeCodeForTokens,
  InMemoryOAuthDao,
  noopLogger,
  PlainTextClaudeCodeAuthSecretStore,
  refreshClaudeCodeTokens,
  SharedOAuthCallbackServer,
  SharedOAuthServiceCore,
  toInternalAuthProvider,
  toPublicAuthProvider,
  type ClaudeCodeAuth,
  type ClaudeCodeAuthModule,
  type ClaudeCodeAuthSecretStore,
  type ClaudeCodeAuthService,
  type ClaudeCodeAuthSessionRecord,
  type ClaudeCodeAuthStatus,
  type ClaudeCodeOAuthStateRecord,
  type ClaudeCodePkcePair,
  type ClaudeCodeProviderAuth,
  type ClaudeCodeTokenResponse,
  type CreateClaudeCodeAuthInput,
  type CreateOAuthStateInput,
  type HandleClaudeCodeAuthCallbackInput,
  type HandleClaudeCodeAuthCallbackResult,
  type InternalAuthProvider,
  type LlmProviderConfig,
  type Logger,
  type OAuthAuthService,
  type OAuthCallbackHandler,
  type OAuthCallbackInput,
  type OAuthCallbackResult,
  type OAuthCallbackServerLike,
  type OAuthDao,
  type OAuthLoginUrlResponse,
  type OAuthLogoutResponse,
  type OAuthProviderAuth,
  type OAuthRuntimeConfig,
  type OAuthSecretStore,
  type OAuthSessionRecord,
  type OAuthStateRecord,
  type OAuthStatus,
  type OAuthTokenResponse,
  type PkcePair,
  type UpsertOAuthSessionInput,
};
