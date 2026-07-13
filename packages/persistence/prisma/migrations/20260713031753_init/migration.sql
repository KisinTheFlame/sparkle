-- CreateTable
CREATE TABLE "app_log" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "trace_id" TEXT NOT NULL,
    "level" TEXT NOT NULL,
    "message" TEXT NOT NULL,
    "metadata" JSONB NOT NULL,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateTable
CREATE TABLE "oauth_session" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "provider" TEXT NOT NULL,
    "account_id" TEXT,
    "email" TEXT,
    "access_token" TEXT,
    "refresh_token" TEXT,
    "id_token" TEXT,
    "expires_at" DATETIME,
    "last_refresh_at" DATETIME,
    "status" TEXT NOT NULL,
    "last_error" TEXT,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateTable
CREATE TABLE "oauth_state" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "state" TEXT NOT NULL,
    "code_verifier" TEXT NOT NULL,
    "redirect_uri" TEXT NOT NULL,
    "expires_at" DATETIME NOT NULL,
    "used_at" DATETIME,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateIndex
CREATE INDEX "app_log_trace_id_created_at_idx" ON "app_log"("trace_id", "created_at");

-- CreateIndex
CREATE INDEX "app_log_level_created_at_idx" ON "app_log"("level", "created_at");

-- CreateIndex
CREATE INDEX "app_log_created_at_idx" ON "app_log"("created_at");

-- CreateIndex
CREATE INDEX "oauth_session_status_updated_at_idx" ON "oauth_session"("status", "updated_at");

-- CreateIndex
CREATE UNIQUE INDEX "oauth_session_provider_uq" ON "oauth_session"("provider");

-- CreateIndex
CREATE UNIQUE INDEX "oauth_state_state_uq" ON "oauth_state"("state");

-- CreateIndex
CREATE INDEX "oauth_state_expires_at_idx" ON "oauth_state"("expires_at");
