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
CREATE TABLE "llm_chat_call" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "request_id" TEXT NOT NULL,
    "seq" INTEGER NOT NULL DEFAULT 1,
    "provider" TEXT NOT NULL,
    "model" TEXT NOT NULL,
    "extension" JSONB,
    "status" TEXT NOT NULL,
    "request_payload" JSONB NOT NULL,
    "response_payload" JSONB,
    "native_request_payload" JSONB,
    "native_response_payload" JSONB,
    "error" JSONB,
    "native_error" JSONB,
    "latency_ms" INTEGER,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateIndex
CREATE INDEX "app_log_trace_id_created_at_idx" ON "app_log"("trace_id", "created_at");

-- CreateIndex
CREATE INDEX "app_log_level_created_at_idx" ON "app_log"("level", "created_at");

-- CreateIndex
CREATE INDEX "app_log_created_at_idx" ON "app_log"("created_at");

-- CreateIndex
CREATE INDEX "llm_chat_call_provider_model_idx" ON "llm_chat_call"("provider", "model");

-- CreateIndex
CREATE INDEX "llm_chat_call_created_at_idx" ON "llm_chat_call"("created_at");

-- CreateIndex
CREATE UNIQUE INDEX "llm_chat_call_request_id_seq_uq" ON "llm_chat_call"("request_id", "seq");
