CREATE TABLE IF NOT EXISTS "ai_requests" (
  "id" TEXT NOT NULL,
  "business_id" TEXT NOT NULL,
  "integration_id" TEXT NOT NULL,
  "feature" TEXT NOT NULL DEFAULT 'chat',
  "model" TEXT DEFAULT NULL,
  "prompt_chars" INTEGER NOT NULL DEFAULT 0,
  "prompt_tokens" INTEGER NOT NULL DEFAULT 0,
  "completion_tokens" INTEGER NOT NULL DEFAULT 0,
  "total_tokens" INTEGER NOT NULL DEFAULT 0,
  "status" TEXT NOT NULL DEFAULT 'ok' CHECK ("status" IN ('ok','error')),
  "error_message" TEXT DEFAULT NULL,
  "duration_ms" INTEGER NOT NULL DEFAULT 0,
  "created_at" TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  CONSTRAINT "fk_ai_request_business" FOREIGN KEY ("business_id") REFERENCES "businesses" ("id") ON DELETE CASCADE,
  CONSTRAINT "fk_ai_request_integration" FOREIGN KEY ("integration_id") REFERENCES "integration_connections" ("id") ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS `idx_ai_requests_business_created` ON `ai_requests` (`business_id`,`created_at`);
