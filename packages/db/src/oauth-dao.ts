import type {
  CreateOAuthStateInput,
  InternalAuthProvider,
  OAuthDao,
  OAuthSessionRecord,
  OAuthStateRecord,
  UpsertOAuthSessionInput,
} from "@sparkle/claude-code";
import type { Database } from "./client.js";

type OauthSessionRow = {
  id: number;
  provider: string;
  accountId: string | null;
  email: string | null;
  accessToken: string | null;
  refreshToken: string | null;
  idToken: string | null;
  expiresAt: Date | null;
  lastRefreshAt: Date | null;
  status: string;
  lastError: string | null;
  createdAt: Date;
  updatedAt: Date;
};

type OauthStateRow = {
  id: number;
  state: string;
  codeVerifier: string;
  redirectUri: string;
  expiresAt: Date;
  usedAt: Date | null;
  createdAt: Date;
};

/**
 * Prisma + SQLite 实现的 OAuthDao，对接 @sparkle/claude-code 留出的持久化注入点，
 * 替换默认的 InMemoryOAuthDao。
 */
export class PrismaOAuthDao<TProvider extends InternalAuthProvider>
  implements OAuthDao<TProvider, OAuthSessionRecord<TProvider>, OAuthStateRecord>
{
  private readonly database: Database;

  public constructor({ database }: { database: Database }) {
    this.database = database;
  }

  public async findSession(provider: TProvider): Promise<OAuthSessionRecord<TProvider> | null> {
    const row = await this.database.oauthSession.findUnique({ where: { provider } });
    return row ? toSessionRecord<TProvider>(row) : null;
  }

  public async upsertSession(
    input: UpsertOAuthSessionInput<TProvider>,
  ): Promise<OAuthSessionRecord<TProvider>> {
    const row = await this.database.oauthSession.upsert({
      where: { provider: input.provider },
      update: {
        accountId: input.accountId,
        email: input.email,
        accessToken: input.accessToken,
        refreshToken: input.refreshToken,
        idToken: input.idToken,
        expiresAt: input.expiresAt,
        lastRefreshAt: input.lastRefreshAt,
        status: input.status,
        lastError: input.lastError,
        updatedAt: new Date(),
      },
      create: {
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
      },
    });
    return toSessionRecord<TProvider>(row);
  }

  public async createOAuthState(input: CreateOAuthStateInput): Promise<OAuthStateRecord> {
    const row = await this.database.oauthState.create({ data: input });
    return toOAuthStateRecord(row);
  }

  public async findOAuthState(state: string): Promise<OAuthStateRecord | null> {
    const row = await this.database.oauthState.findUnique({ where: { state } });
    return row ? toOAuthStateRecord(row) : null;
  }

  public async markOAuthStateUsed(state: string, usedAt: Date): Promise<void> {
    await this.database.oauthState.update({ where: { state }, data: { usedAt } });
  }

  public async deleteExpiredOAuthStates(before: Date): Promise<void> {
    await this.database.oauthState.deleteMany({
      where: {
        OR: [{ expiresAt: { lt: before } }, { usedAt: { not: null } }],
      },
    });
  }
}

function toSessionRecord<TProvider extends InternalAuthProvider>(
  row: OauthSessionRow,
): OAuthSessionRecord<TProvider> {
  return {
    id: row.id,
    provider: row.provider as TProvider,
    accountId: row.accountId,
    email: row.email,
    accessToken: row.accessToken,
    refreshToken: row.refreshToken,
    idToken: row.idToken,
    expiresAt: row.expiresAt,
    lastRefreshAt: row.lastRefreshAt,
    status: row.status as OAuthSessionRecord<TProvider>["status"],
    lastError: row.lastError,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

function toOAuthStateRecord(row: OauthStateRow): OAuthStateRecord {
  return {
    id: row.id,
    state: row.state,
    codeVerifier: row.codeVerifier,
    redirectUri: row.redirectUri,
    expiresAt: row.expiresAt,
    usedAt: row.usedAt,
    createdAt: row.createdAt,
  };
}
