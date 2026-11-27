-- Repair delivery_assignments foreign key after the 017 external_orders rebuild.
PRAGMA legacy_alter_table = ON;

DROP TRIGGER IF EXISTS "trg_delivery_assignments_updated_at";

ALTER TABLE "delivery_assignments" RENAME TO "delivery_assignments_fk_old";
CREATE TABLE "delivery_assignments" (
  "id" TEXT NOT NULL,
  "business_id" TEXT NOT NULL,
  "external_order_id" TEXT DEFAULT NULL,
  "order_id" TEXT DEFAULT NULL,
  "provider" TEXT NOT NULL,
  "external_delivery_id" TEXT DEFAULT NULL,
  "status" TEXT NOT NULL DEFAULT 'requested' CHECK ("status" IN ('requested','assigned','picked_up','delivered','cancelled','failed')),
  "courier_name" TEXT DEFAULT NULL,
  "courier_id" TEXT DEFAULT NULL,
  "tracking_url" TEXT DEFAULT NULL,
  "payload" TEXT NOT NULL CHECK (json_valid("payload")),
  "created_at" TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "failure_reason" TEXT DEFAULT NULL,
  PRIMARY KEY (`id`),
  CONSTRAINT "fk_delivery_assignment_business" FOREIGN KEY ("business_id") REFERENCES "businesses" ("id") ON DELETE CASCADE,
  CONSTRAINT "fk_delivery_assignment_courier" FOREIGN KEY ("courier_id") REFERENCES "delivery_couriers" ("id") ON DELETE SET NULL,
  CONSTRAINT "fk_delivery_assignment_external_order" FOREIGN KEY ("external_order_id") REFERENCES "external_orders" ("id") ON DELETE SET NULL,
  CONSTRAINT "fk_delivery_assignment_order" FOREIGN KEY ("order_id") REFERENCES "orders" ("id") ON DELETE SET NULL
);
INSERT INTO "delivery_assignments" SELECT * FROM "delivery_assignments_fk_old";
DROP TABLE "delivery_assignments_fk_old";
CREATE TRIGGER "trg_delivery_assignments_updated_at" AFTER UPDATE OF "id", "business_id", "external_order_id", "order_id", "provider", "external_delivery_id", "status", "courier_name", "courier_id", "tracking_url", "payload", "created_at" ON "delivery_assignments" FOR EACH ROW WHEN NEW."updated_at" IS OLD."updated_at" BEGIN UPDATE "delivery_assignments" SET "updated_at"=CURRENT_TIMESTAMP WHERE "id"=OLD."id"; END;

PRAGMA legacy_alter_table = OFF;
