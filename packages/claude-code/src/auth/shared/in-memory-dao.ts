import type {
  CreateOAuthStateInput,
  OAuthDao,
  OAuthSessionRecord,
  OAuthStateRecord,
  UpsertOAuthSessionInput,
} from "./types.js";

/**
 * 进程内（非持久化）OAuthDao 默认实现。原 kagami 走 Prisma 持久化；本包将持久化作为
 * 注入点，默认提供内存实现，便于不依赖数据库即可跑通登录流程。会话仅保留单条（按 provider
 * 覆盖），state 以 Map 暂存。进程重启即丢失，生产请注入持久化实现。
 */
export class InMemoryOAuthDao<TProvider extends string>
  implements OAuthDao<TProvider, OAuthSessionRecord<TProvider>, OAuthStateRecord>
{
  private session: OAuthSessionRecord<TProvider> | null = null;
  private readonly states = new Map<string, OAuthStateRecord>();
  private nextId = 1;

  public async findSession(provider: TProvider): Promise<OAuthSessionRecord<TProvider> | null> {
    return this.session && this.session.provider === provider ? this.session : null;
  }

  public async upsertSession(
    input: UpsertOAuthSessionInput<TProvider>,
  ): Promise<OAuthSessionRecord<TProvider>> {
    const now = new Date();
    const existing =
      this.session && this.session.provider === input.provider ? this.session : null;
    const record: OAuthSessionRecord<TProvider> = {
      id: existing?.id ?? this.nextId++,
      provider: input.provider,
      accountId: input.accountId,
      email: input.email,
      accessToken: input.accessToken,
      refreshToken: input.refreshToken,
      idToken: input.idToken,
      expiresAt: input.expiresAt,
      lastRefreshAt: input.lastRefreshAt,
      status: input.status,
      lastError: input.lastError,
      createdAt: existing?.createdAt ?? now,
      updatedAt: now,
    };
    this.session = record;
    return record;
  }

  public async createOAuthState(input: CreateOAuthStateInput): Promise<OAuthStateRecord> {
    const record: OAuthStateRecord = {
      id: this.nextId++,
      state: input.state,
      codeVerifier: input.codeVerifier,
      redirectUri: input.redirectUri,
      expiresAt: input.expiresAt,
      usedAt: null,
      createdAt: new Date(),
    };
    this.states.set(record.state, record);
    return record;
  }

  public async findOAuthState(state: string): Promise<OAuthStateRecord | null> {
    return this.states.get(state) ?? null;
  }

  public async markOAuthStateUsed(state: string, usedAt: Date): Promise<void> {
    const record = this.states.get(state);
    if (record) {
      record.usedAt = usedAt;
    }
  }

  public async deleteExpiredOAuthStates(before: Date): Promise<void> {
    for (const [key, record] of this.states) {
      if (record.expiresAt.getTime() < before.getTime() || record.usedAt) {
        this.states.delete(key);
      }
    }
  }
}
