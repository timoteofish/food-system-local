-- SQLite cannot ALTER a CHECK constraint. Recreate integration_connections with
-- ai_model allowed. legacy_alter_table keeps child-table foreign keys pointing
-- at the original table name while the old copy is renamed.
PRAGMA legacy_alter_table = ON;

ALTER TABLE "integration_connections" RENAME TO "integration_connections_ai_old";

CREATE TABLE "integration_connections" (
  "id" TEXT NOT NULL,
  "business_id" TEXT NOT NULL,
  "provider" TEXT NOT NULL CHECK ("provider" IN ('ifood', '99food', 'keeta', 'delivery_logistics', 'payment', 'ai_model')),
  "display_name" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'disconnected' CHECK ("status" IN ('disconnected', 'pending', 'reachable', 'error', 'disabled')),
  "settings" TEXT NOT NULL CHECK (json_valid("settings")),
  "last_error" TEXT DEFAULT NULL,
  "last_checked_at" TEXT DEFAULT NULL,
  "created_at" TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  CONSTRAINT `uq_integration_business_provider` UNIQUE (`business_id`,`provider`),
  CONSTRAINT "fk_integration_connection_business" FOREIGN KEY ("business_id") REFERENCES "businesses" ("id") ON DELETE CASCADE
);

INSERT INTO "integration_connections" ("id", "business_id", "provider", "display_name", "status", "settings", "last_error", "last_checked_at", "created_at", "updated_at")
SELECT "id", "business_id", "provider", "display_name", "status", "settings", "last_error", "last_checked_at", "created_at", "updated_at"
FROM "integration_connections_ai_old";

DROP TABLE "integration_connections_ai_old";

CREATE TRIGGER IF NOT EXISTS "trg_integration_connections_updated_at" AFTER UPDATE OF "id", "business_id", "provider", "display_name", "status", "settings", "last_error", "last_checked_at", "created_at" ON "integration_connections" FOR EACH ROW WHEN NEW."updated_at" IS OLD."updated_at" BEGIN UPDATE "integration_connections" SET "updated_at"=CURRENT_TIMESTAMP WHERE "id"=OLD."id"; END;

PRAGMA legacy_alter_table = OFF;
