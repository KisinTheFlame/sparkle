-- CreateTable
CREATE TABLE "feishu_event" (
    "seq" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "message_id" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateIndex
CREATE UNIQUE INDEX "feishu_event_message_id_key" ON "feishu_event"("message_id");

-- CreateIndex
CREATE INDEX "feishu_event_created_at_idx" ON "feishu_event"("created_at");
