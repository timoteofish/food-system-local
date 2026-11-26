CREATE TABLE IF NOT EXISTS "payment_terminals" (
  "id" TEXT NOT NULL,
  "business_id" TEXT NOT NULL,
  "provider" TEXT NOT NULL CHECK ("provider" IN ('stone','pagbank','getnet','cielo','rede','sicredi','sicoob','generic')),
  "display_name" TEXT NOT NULL,
  "endpoint_url" TEXT NOT NULL,
  "active" INTEGER NOT NULL DEFAULT 1,
  "created_at" TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  CONSTRAINT "fk_payment_terminal_business" FOREIGN KEY ("business_id") REFERENCES "businesses" ("id") ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS `idx_payment_terminals_business` ON `payment_terminals` (`business_id`,`active`);

CREATE TABLE IF NOT EXISTS "payment_gateways" (
  "id" TEXT NOT NULL,
  "business_id" TEXT NOT NULL,
  "provider" TEXT NOT NULL CHECK ("provider" IN ('mercadopago','pagbank','asaas','stripe','pagarme')),
  "display_name" TEXT NOT NULL,
  "active" INTEGER NOT NULL DEFAULT 1,
  "created_at" TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  CONSTRAINT "fk_payment_gateway_business" FOREIGN KEY ("business_id") REFERENCES "businesses" ("id") ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS `idx_payment_gateways_business` ON `payment_gateways` (`business_id`,`active`);

CREATE TABLE IF NOT EXISTS "card_payments" (
  "id" TEXT NOT NULL,
  "business_id" TEXT NOT NULL,
  "order_id" TEXT NOT NULL,
  "source_type" TEXT NOT NULL CHECK ("source_type" IN ('terminal','gateway')),
  "source_id" TEXT NOT NULL,
  "amount" NUMERIC NOT NULL,
  "installments" INTEGER NOT NULL DEFAULT 1,
  "status" TEXT NOT NULL DEFAULT 'pending' CHECK ("status" IN ('pending','approved','declined','voided','error')),
  "external_id" TEXT DEFAULT NULL,
  "request_payload" TEXT DEFAULT NULL CHECK (json_valid("request_payload")),
  "response_payload" TEXT DEFAULT NULL CHECK (json_valid("response_payload")),
  "error_message" TEXT DEFAULT NULL,
  "created_at" TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "settled_at" TEXT DEFAULT NULL,
  PRIMARY KEY (`id`),
  CONSTRAINT "fk_card_payment_business" FOREIGN KEY ("business_id") REFERENCES "businesses" ("id") ON DELETE CASCADE,
  CONSTRAINT "fk_card_payment_order" FOREIGN KEY ("order_id") REFERENCES "orders" ("id") ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS `idx_card_payments_business_order` ON `card_payments` (`business_id`,`order_id`);
CREATE INDEX IF NOT EXISTS `idx_card_payments_business_status` ON `card_payments` (`business_id`,`status`,`created_at`);

ALTER TABLE "order_payments" ADD COLUMN "card_payment_id" TEXT DEFAULT NULL REFERENCES "card_payments" ("id") ON DELETE SET NULL;
