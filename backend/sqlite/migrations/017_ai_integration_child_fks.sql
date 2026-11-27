-- Repair child-table foreign keys after the 016 table rebuild. With
-- legacy_alter_table the child constraints kept the temporary table name, so
-- recreate them pointing at integration_connections and copy all rows back.
PRAGMA legacy_alter_table = ON;

DROP TRIGGER IF EXISTS "trg_external_orders_updated_at";

ALTER TABLE "external_orders" RENAME TO "external_orders_fk_old";
CREATE TABLE "external_orders" (
  "id" TEXT NOT NULL,
  "business_id" TEXT NOT NULL,
  "integration_connection_id" TEXT NOT NULL,
  "external_order_id" TEXT NOT NULL,
  "order_id" TEXT DEFAULT NULL,
  "status" TEXT NOT NULL DEFAULT 'received' CHECK ("status" IN ('received', 'accepted', 'preparing', 'ready', 'out_for_delivery', 'completed', 'cancelled', 'failed')),
  "payload" TEXT NOT NULL CHECK (json_valid("payload")),
  "last_error" TEXT DEFAULT NULL,
  "received_at" TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  CONSTRAINT `uq_external_order_provider_id` UNIQUE (`integration_connection_id`,`external_order_id`),
  CONSTRAINT "fk_external_order_business" FOREIGN KEY ("business_id") REFERENCES "businesses" ("id") ON DELETE CASCADE,
  CONSTRAINT "fk_external_order_connection" FOREIGN KEY ("integration_connection_id") REFERENCES "integration_connections" ("id") ON DELETE CASCADE,
  CONSTRAINT "fk_external_order_order" FOREIGN KEY ("order_id") REFERENCES "orders" ("id") ON DELETE SET NULL
);
INSERT INTO "external_orders" SELECT * FROM "external_orders_fk_old";
DROP TABLE "external_orders_fk_old";
CREATE TRIGGER "trg_external_orders_updated_at" AFTER UPDATE OF "id", "business_id", "integration_connection_id", "external_order_id", "order_id", "status", "payload", "last_error", "received_at" ON "external_orders" FOR EACH ROW WHEN NEW."updated_at" IS OLD."updated_at" BEGIN UPDATE "external_orders" SET "updated_at"=CURRENT_TIMESTAMP WHERE "id"=OLD."id"; END;

ALTER TABLE "integration_events" RENAME TO "integration_events_fk_old";
CREATE TABLE "integration_events" (
  "id" TEXT NOT NULL,
  "business_id" TEXT NOT NULL,
  "integration_connection_id" TEXT NOT NULL,
  "external_order_id" TEXT DEFAULT NULL,
  "direction" TEXT NOT NULL CHECK ("direction" IN ('inbound','outbound')),
  "event_type" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'pending' CHECK ("status" IN ('pending','processing','processed','failed')),
  "payload" TEXT NOT NULL CHECK (json_valid("payload")),
  "error_message" TEXT DEFAULT NULL,
  "attempts" INTEGER NOT NULL DEFAULT 0,
  "created_at" TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "processed_at" TEXT DEFAULT NULL,
  PRIMARY KEY (`id`),
  CONSTRAINT "fk_integration_event_business" FOREIGN KEY ("business_id") REFERENCES "businesses" ("id") ON DELETE CASCADE,
  CONSTRAINT "fk_integration_event_connection" FOREIGN KEY ("integration_connection_id") REFERENCES "integration_connections" ("id") ON DELETE CASCADE
);
INSERT INTO "integration_events" SELECT * FROM "integration_events_fk_old";
DROP TABLE "integration_events_fk_old";

ALTER TABLE "ai_requests" RENAME TO "ai_requests_fk_old";
CREATE TABLE "ai_requests" (
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
INSERT INTO "ai_requests" SELECT * FROM "ai_requests_fk_old";
DROP TABLE "ai_requests_fk_old";

PRAGMA legacy_alter_table = OFF;
