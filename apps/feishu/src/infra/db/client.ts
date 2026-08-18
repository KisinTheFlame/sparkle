import { mkdirSync } from "node:fs";
import { sqliteFilePathFromUrl } from "@sparkle/kernel/utils/sqlite-path";
import path from "node:path";
import {
  getPrismaClientClass,
  type PrismaClient as PrismaClientInstance,
} from "../../generated/prisma/internal/class.js";
import { PrismaBetterSqlite3 } from "@prisma/adapter-better-sqlite3";

// feishu 独占的 SQLite 库（与 agent 主库物理分离）。镜像 scheduler 的 db client：
// better-sqlite3 adapter + busy_timeout + WAL + 建父目录。

const SQLITE_BUSY_TIMEOUT_MS = 5000;

export type Database = PrismaClientInstance;

const PrismaClient = getPrismaClientClass();

export function createDbClient({ databaseUrl }: { databaseUrl: string }): Database {
  const filePath = sqliteFilePathFromUrl(databaseUrl);
  if (filePath !== ":memory:") {
    mkdirSync(path.dirname(filePath), { recursive: true });
  }
  const adapter = new PrismaBetterSqlite3({
    url: `file:${filePath}`,
    timeout: SQLITE_BUSY_TIMEOUT_MS,
  });
  return new PrismaClient({ adapter });
}

/** 开启 WAL 并兜底 busy_timeout；两条 PRAGMA 分开调用（prepared statement 一次只执行首条）。 */
export async function configureSqlite(database: Database): Promise<void> {
  await database.$queryRawUnsafe("PRAGMA journal_mode = WAL;");
  await database.$queryRawUnsafe(`PRAGMA busy_timeout = ${SQLITE_BUSY_TIMEOUT_MS};`);
}

export async function closeDb(database: Database): Promise<void> {
  await database.$disconnect();
}
