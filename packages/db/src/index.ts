import { closeDb, createDbClient } from "./client.js";
import type { Database } from "./client.js";
import { PrismaOAuthDao } from "./oauth-dao.js";
import { PrismaLogDao } from "./log-dao.js";
import { PrismaLlmChatCallDao } from "./chat-call-dao.js";

export {
  closeDb,
  createDbClient,
  PrismaLlmChatCallDao,
  PrismaLogDao,
  PrismaOAuthDao,
  type Database,
};
