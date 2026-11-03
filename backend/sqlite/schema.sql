-- SQLite schema for the current Food System database.
PRAGMA foreign_keys = OFF;

CREATE TABLE IF NOT EXISTS "audit_logs" (
  "id" TEXT NOT NULL,
  "business_id" TEXT DEFAULT NULL,
  "user_id" TEXT DEFAULT NULL,
  "action" TEXT NOT NULL,
  "resource_type" TEXT DEFAULT NULL,
  "resource_id" TEXT DEFAULT NULL,
  "ip_address" TEXT DEFAULT NULL,
  "metadata" TEXT NOT NULL CHECK (json_valid("metadata")),
  "created_at" TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
PRIMARY KEY (`id`),
CONSTRAINT "fk_audit_business" FOREIGN KEY ("business_id") REFERENCES "businesses" ("id") ON DELETE SET NULL,
CONSTRAINT "fk_audit_user" FOREIGN KEY ("user_id") REFERENCES "users" ("id") ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS `idx_audit_logs_idx_audit_business_created` ON `audit_logs` (`business_id`,`created_at`);

CREATE INDEX IF NOT EXISTS `idx_audit_logs_fk_audit_user` ON `audit_logs` (`user_id`);

CREATE TABLE IF NOT EXISTS "business_memberships" (
  "id" TEXT NOT NULL,
  "user_id" TEXT NOT NULL,
  "business_id" TEXT NOT NULL,
  "role" TEXT NOT NULL DEFAULT 'owner' CHECK ("role" IN ('owner', 'manager', 'staff')),
PRIMARY KEY (`id`),
CONSTRAINT `uq_membership_user_business` UNIQUE (`user_id`,`business_id`),
CONSTRAINT "fk_membership_business" FOREIGN KEY ("business_id") REFERENCES "businesses" ("id") ON DELETE CASCADE,
CONSTRAINT "fk_membership_user" FOREIGN KEY ("user_id") REFERENCES "users" ("id") ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS `idx_business_memberships_fk_membership_business` ON `business_memberships` (`business_id`);

CREATE TABLE IF NOT EXISTS "businesses" (
  "id" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "description" TEXT DEFAULT NULL,
  "primary_color" TEXT NOT NULL DEFAULT '#0f766e',
  "settings" TEXT NOT NULL CHECK (json_valid("settings")),
  "created_at" TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
PRIMARY KEY (`id`)
);

CREATE TABLE IF NOT EXISTS "cash_movements" (
  "id" TEXT NOT NULL,
  "business_id" TEXT NOT NULL,
  "session_id" TEXT DEFAULT NULL,
  "order_id" TEXT DEFAULT NULL,
  "type" TEXT NOT NULL CHECK ("type" IN ('sale', 'entry', 'withdrawal')),
  "amount" NUMERIC NOT NULL,
  "description" TEXT DEFAULT NULL,
  "created_at" TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
PRIMARY KEY (`id`),
CONSTRAINT "fk_cash_business" FOREIGN KEY ("business_id") REFERENCES "businesses" ("id") ON DELETE CASCADE,
CONSTRAINT "fk_cash_movement_session" FOREIGN KEY ("session_id") REFERENCES "cash_register_sessions" ("id") ON DELETE SET NULL,
CONSTRAINT "fk_cash_order" FOREIGN KEY ("order_id") REFERENCES "orders" ("id") ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS `idx_cash_movements_idx_cash_business_created` ON `cash_movements` (`business_id`,`created_at`);

CREATE INDEX IF NOT EXISTS `idx_cash_movements_fk_cash_order` ON `cash_movements` (`order_id`);

CREATE INDEX IF NOT EXISTS `idx_cash_movements_idx_cash_movements_session` ON `cash_movements` (`session_id`,`created_at`);

CREATE TABLE IF NOT EXISTS "cash_register_sessions" (
  "id" TEXT NOT NULL,
  "business_id" TEXT NOT NULL,
  "opened_by" TEXT DEFAULT NULL,
  "closed_by" TEXT DEFAULT NULL,
  "status" TEXT NOT NULL DEFAULT 'open' CHECK ("status" IN ('open', 'closed')),
  "opening_amount" NUMERIC NOT NULL DEFAULT 0.00,
  "closing_amount" NUMERIC DEFAULT NULL,
  "expected_amount" NUMERIC DEFAULT NULL,
  "difference_amount" NUMERIC DEFAULT NULL,
  "opened_at" TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "closed_at" TEXT DEFAULT NULL,
  "notes" TEXT DEFAULT NULL,
PRIMARY KEY (`id`),
CONSTRAINT "fk_cash_session_business" FOREIGN KEY ("business_id") REFERENCES "businesses" ("id") ON DELETE CASCADE,
CONSTRAINT "fk_cash_session_closed_by" FOREIGN KEY ("closed_by") REFERENCES "users" ("id") ON DELETE SET NULL,
CONSTRAINT "fk_cash_session_opened_by" FOREIGN KEY ("opened_by") REFERENCES "users" ("id") ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS `idx_cash_register_sessions_idx_cash_session_business_status` ON `cash_register_sessions` (`business_id`,`status`);

CREATE INDEX IF NOT EXISTS `idx_cash_register_sessions_fk_cash_session_opened_by` ON `cash_register_sessions` (`opened_by`);

CREATE INDEX IF NOT EXISTS `idx_cash_register_sessions_fk_cash_session_closed_by` ON `cash_register_sessions` (`closed_by`);

CREATE TABLE IF NOT EXISTS "categories" (
  "id" TEXT NOT NULL,
  "business_id" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "description" TEXT DEFAULT NULL,
  "position" INTEGER NOT NULL DEFAULT 0,
  "active" INTEGER NOT NULL DEFAULT 1,
  "created_at" TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
PRIMARY KEY (`id`),
CONSTRAINT `uq_categories_business_name` UNIQUE (`business_id`,`name`),
CONSTRAINT "fk_categories_business" FOREIGN KEY ("business_id") REFERENCES "businesses" ("id") ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS "courier_locations" (
  "id" TEXT NOT NULL,
  "courier_id" TEXT NOT NULL,
  "business_id" TEXT NOT NULL,
  "latitude" NUMERIC NOT NULL,
  "longitude" NUMERIC NOT NULL,
  "accuracy_m" NUMERIC DEFAULT NULL,
  "created_at" TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
PRIMARY KEY (`id`),
CONSTRAINT `uq_courier_locations_courier` UNIQUE (`courier_id`),
CONSTRAINT "fk_courier_location_business" FOREIGN KEY ("business_id") REFERENCES "businesses" ("id") ON DELETE CASCADE,
CONSTRAINT "fk_courier_location_courier" FOREIGN KEY ("courier_id") REFERENCES "delivery_couriers" ("id") ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS `idx_courier_locations_idx_courier_locations_latest` ON `courier_locations` (`courier_id`,`created_at`);

CREATE INDEX IF NOT EXISTS `idx_courier_locations_fk_courier_location_business` ON `courier_locations` (`business_id`);

CREATE TABLE IF NOT EXISTS "customers" (
  "id" TEXT NOT NULL,
  "business_id" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "phone" TEXT DEFAULT NULL,
  "email" TEXT DEFAULT NULL,
  "notes" TEXT DEFAULT NULL,
  "created_at" TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
PRIMARY KEY (`id`),
CONSTRAINT "fk_customer_business" FOREIGN KEY ("business_id") REFERENCES "businesses" ("id") ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS `idx_customers_idx_customers_business_name` ON `customers` (`business_id`,`name`);

CREATE INDEX IF NOT EXISTS `idx_customers_idx_customers_business_phone` ON `customers` (`business_id`,`phone`);

CREATE TABLE IF NOT EXISTS "delivery_assignments" (
  "id" TEXT NOT NULL,
  "business_id" TEXT NOT NULL,
  "external_order_id" TEXT DEFAULT NULL,
  "order_id" TEXT DEFAULT NULL,
  "provider" TEXT NOT NULL,
  "external_delivery_id" TEXT DEFAULT NULL,
  "status" TEXT NOT NULL DEFAULT 'requested' CHECK ("status" IN ('requested', 'assigned', 'picked_up', 'delivered', 'cancelled', 'failed')),
  "courier_name" TEXT DEFAULT NULL,
  "courier_id" TEXT DEFAULT NULL,
  "tracking_url" TEXT DEFAULT NULL,
  "payload" TEXT NOT NULL CHECK (json_valid("payload")),
  "created_at" TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
PRIMARY KEY (`id`),
CONSTRAINT "fk_delivery_assignment_business" FOREIGN KEY ("business_id") REFERENCES "businesses" ("id") ON DELETE CASCADE,
CONSTRAINT "fk_delivery_assignment_courier" FOREIGN KEY ("courier_id") REFERENCES "delivery_couriers" ("id") ON DELETE SET NULL,
CONSTRAINT "fk_delivery_assignment_external_order" FOREIGN KEY ("external_order_id") REFERENCES "external_orders" ("id") ON DELETE SET NULL,
CONSTRAINT "fk_delivery_assignment_order" FOREIGN KEY ("order_id") REFERENCES "orders" ("id") ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS `idx_delivery_assignments_idx_delivery_assignments_business_status` ON `delivery_assignments` (`business_id`,`status`,`created_at`);

CREATE INDEX IF NOT EXISTS `idx_delivery_assignments_fk_delivery_assignment_external_order` ON `delivery_assignments` (`external_order_id`);

CREATE INDEX IF NOT EXISTS `idx_delivery_assignments_fk_delivery_assignment_order` ON `delivery_assignments` (`order_id`);

CREATE INDEX IF NOT EXISTS `idx_delivery_assignments_fk_delivery_assignment_courier` ON `delivery_assignments` (`courier_id`);

CREATE TABLE IF NOT EXISTS "delivery_couriers" (
  "id" TEXT NOT NULL,
  "business_id" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "phone" TEXT DEFAULT NULL,
  "active" INTEGER NOT NULL DEFAULT 1,
  "created_at" TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "token_hash" TEXT DEFAULT NULL,
  "token_expires_at" TEXT DEFAULT NULL,
PRIMARY KEY (`id`),
CONSTRAINT `uq_delivery_courier_token` UNIQUE (`token_hash`),
CONSTRAINT "fk_courier_business" FOREIGN KEY ("business_id") REFERENCES "businesses" ("id") ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS `idx_delivery_couriers_idx_courier_business_active` ON `delivery_couriers` (`business_id`,`active`);

CREATE TABLE IF NOT EXISTS "dining_tabs" (
  "id" TEXT NOT NULL,
  "business_id" TEXT NOT NULL,
  "restaurant_table_id" TEXT NOT NULL,
  "customer_id" TEXT DEFAULT NULL,
  "status" TEXT NOT NULL DEFAULT 'open' CHECK ("status" IN ('open', 'closed', 'cancelled')),
  "opened_at" TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "closed_at" TEXT DEFAULT NULL,
  "notes" TEXT DEFAULT NULL,
PRIMARY KEY (`id`),
CONSTRAINT "fk_dining_tab_business" FOREIGN KEY ("business_id") REFERENCES "businesses" ("id") ON DELETE CASCADE,
CONSTRAINT "fk_dining_tab_customer" FOREIGN KEY ("customer_id") REFERENCES "customers" ("id") ON DELETE SET NULL,
CONSTRAINT "fk_dining_tab_table" FOREIGN KEY ("restaurant_table_id") REFERENCES "restaurant_tables" ("id")
);

CREATE INDEX IF NOT EXISTS `idx_dining_tabs_idx_dining_tabs_business_status` ON `dining_tabs` (`business_id`,`status`);

CREATE INDEX IF NOT EXISTS `idx_dining_tabs_fk_dining_tab_table` ON `dining_tabs` (`restaurant_table_id`);

CREATE INDEX IF NOT EXISTS `idx_dining_tabs_fk_dining_tab_customer` ON `dining_tabs` (`customer_id`);

CREATE TABLE IF NOT EXISTS "discounts" (
  "id" TEXT NOT NULL,
  "business_id" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "code" TEXT DEFAULT NULL,
  "type" TEXT NOT NULL CHECK ("type" IN ('percentage', 'fixed')),
  "value" NUMERIC NOT NULL,
  "active" INTEGER NOT NULL DEFAULT 1,
  "starts_at" TEXT DEFAULT NULL,
  "ends_at" TEXT DEFAULT NULL,
  "created_at" TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
PRIMARY KEY (`id`),
CONSTRAINT `uq_discount_business_code` UNIQUE (`business_id`,`code`),
CONSTRAINT "fk_discount_business" FOREIGN KEY ("business_id") REFERENCES "businesses" ("id") ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS `idx_discounts_idx_discounts_business_active` ON `discounts` (`business_id`,`active`);

CREATE TABLE IF NOT EXISTS "external_orders" (
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

CREATE INDEX IF NOT EXISTS `idx_external_orders_idx_external_orders_business_status` ON `external_orders` (`business_id`,`status`,`received_at`);

CREATE INDEX IF NOT EXISTS `idx_external_orders_fk_external_order_order` ON `external_orders` (`order_id`);

CREATE TABLE IF NOT EXISTS "fiscal_documents" (
  "id" TEXT NOT NULL,
  "business_id" TEXT NOT NULL,
  "order_id" TEXT DEFAULT NULL,
  "document_type" TEXT NOT NULL DEFAULT 'nfce' CHECK ("document_type" IN ('nfce', 'nfe', 'receipt')),
  "status" TEXT NOT NULL DEFAULT 'draft' CHECK ("status" IN ('draft', 'pending', 'authorized', 'rejected', 'cancelled')),
  "number" TEXT DEFAULT NULL,
  "access_key" TEXT DEFAULT NULL,
  "provider" TEXT DEFAULT NULL,
  "payload" TEXT NOT NULL CHECK (json_valid("payload")),
  "response_payload" TEXT DEFAULT NULL CHECK (json_valid("response_payload")),
  "error_message" TEXT DEFAULT NULL,
  "created_at" TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
PRIMARY KEY (`id`),
CONSTRAINT "fk_fiscal_business" FOREIGN KEY ("business_id") REFERENCES "businesses" ("id") ON DELETE CASCADE,
CONSTRAINT "fk_fiscal_order" FOREIGN KEY ("order_id") REFERENCES "orders" ("id") ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS `idx_fiscal_documents_idx_fiscal_business_status` ON `fiscal_documents` (`business_id`,`status`);

CREATE INDEX IF NOT EXISTS `idx_fiscal_documents_fk_fiscal_order` ON `fiscal_documents` (`order_id`);

CREATE TABLE IF NOT EXISTS "integration_connections" (
  "id" TEXT NOT NULL,
  "business_id" TEXT NOT NULL,
  "provider" TEXT NOT NULL CHECK ("provider" IN ('ifood', '99food', 'keeta', 'delivery_logistics', 'payment')),
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

CREATE TABLE IF NOT EXISTS "integration_events" (
  "id" TEXT NOT NULL,
  "business_id" TEXT NOT NULL,
  "integration_connection_id" TEXT NOT NULL,
  "external_order_id" TEXT DEFAULT NULL,
  "direction" TEXT NOT NULL CHECK ("direction" IN ('inbound', 'outbound')),
  "event_type" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'pending' CHECK ("status" IN ('pending', 'processing', 'processed', 'failed')),
  "payload" TEXT NOT NULL CHECK (json_valid("payload")),
  "error_message" TEXT DEFAULT NULL,
  "attempts" INTEGER NOT NULL DEFAULT 0,
  "created_at" TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "processed_at" TEXT DEFAULT NULL,
PRIMARY KEY (`id`),
CONSTRAINT "fk_integration_event_business" FOREIGN KEY ("business_id") REFERENCES "businesses" ("id") ON DELETE CASCADE,
CONSTRAINT "fk_integration_event_connection" FOREIGN KEY ("integration_connection_id") REFERENCES "integration_connections" ("id") ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS `idx_integration_events_idx_integration_events_queue` ON `integration_events` (`status`,`created_at`);

CREATE INDEX IF NOT EXISTS `idx_integration_events_fk_integration_event_business` ON `integration_events` (`business_id`);

CREATE INDEX IF NOT EXISTS `idx_integration_events_fk_integration_event_connection` ON `integration_events` (`integration_connection_id`);

CREATE TABLE IF NOT EXISTS "inventory_items" (
  "id" TEXT NOT NULL,
  "business_id" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "unit" TEXT NOT NULL DEFAULT 'unit' CHECK ("unit" IN ('unit', 'g', 'kg', 'ml', 'l')),
  "current_quantity" NUMERIC NOT NULL DEFAULT 0.000,
  "minimum_quantity" NUMERIC NOT NULL DEFAULT 0.000,
  "cost_per_unit" NUMERIC NOT NULL DEFAULT 0.0000,
  "active" INTEGER NOT NULL DEFAULT 1,
  "created_at" TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
PRIMARY KEY (`id`),
CONSTRAINT `uq_inventory_business_name` UNIQUE (`business_id`,`name`),
CONSTRAINT "fk_inventory_item_business" FOREIGN KEY ("business_id") REFERENCES "businesses" ("id") ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS `idx_inventory_items_idx_inventory_business_active` ON `inventory_items` (`business_id`,`active`);

CREATE TABLE IF NOT EXISTS "inventory_movements" (
  "id" TEXT NOT NULL,
  "business_id" TEXT NOT NULL,
  "inventory_item_id" TEXT NOT NULL,
  "order_id" TEXT DEFAULT NULL,
  "type" TEXT NOT NULL CHECK ("type" IN ('purchase', 'adjustment', 'loss', 'sale')),
  "quantity" NUMERIC NOT NULL,
  "description" TEXT DEFAULT NULL,
  "created_at" TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
PRIMARY KEY (`id`),
CONSTRAINT `uq_inventory_order_item` UNIQUE (`order_id`,`inventory_item_id`,`type`),
CONSTRAINT "fk_inventory_movement_business" FOREIGN KEY ("business_id") REFERENCES "businesses" ("id") ON DELETE CASCADE,
CONSTRAINT "fk_inventory_movement_item" FOREIGN KEY ("inventory_item_id") REFERENCES "inventory_items" ("id"),
CONSTRAINT "fk_inventory_movement_order" FOREIGN KEY ("order_id") REFERENCES "orders" ("id") ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS `idx_inventory_movements_idx_inventory_movements_business_created` ON `inventory_movements` (`business_id`,`created_at`);

CREATE INDEX IF NOT EXISTS `idx_inventory_movements_fk_inventory_movement_item` ON `inventory_movements` (`inventory_item_id`);

CREATE TABLE IF NOT EXISTS "kitchen_stations" (
  "id" TEXT NOT NULL,
  "business_id" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "printer_url" TEXT DEFAULT NULL,
  "active" INTEGER NOT NULL DEFAULT 1,
  "created_at" TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
PRIMARY KEY (`id`),
CONSTRAINT `uq_kitchen_station_business_name` UNIQUE (`business_id`,`name`),
CONSTRAINT "fk_kitchen_station_business" FOREIGN KEY ("business_id") REFERENCES "businesses" ("id") ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS "local_team_members" (
  "id" TEXT NOT NULL,
  "business_id" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "role" TEXT NOT NULL DEFAULT 'staff' CHECK ("role" IN ('manager', 'staff')),
  "active" INTEGER NOT NULL DEFAULT 1,
  "created_at" TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
PRIMARY KEY (`id`),
CONSTRAINT "fk_local_team_business" FOREIGN KEY ("business_id") REFERENCES "businesses" ("id") ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS `idx_local_team_members_idx_local_team_business_name` ON `local_team_members` (`business_id`,`name`);

CREATE TABLE IF NOT EXISTS "loyalty_accounts" (
  "id" TEXT NOT NULL,
  "business_id" TEXT NOT NULL,
  "customer_id" TEXT NOT NULL,
  "points" INTEGER NOT NULL DEFAULT 0,
  "created_at" TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
PRIMARY KEY (`id`),
CONSTRAINT `uq_loyalty_business_customer` UNIQUE (`business_id`,`customer_id`),
CONSTRAINT "fk_loyalty_business" FOREIGN KEY ("business_id") REFERENCES "businesses" ("id") ON DELETE CASCADE,
CONSTRAINT "fk_loyalty_customer" FOREIGN KEY ("customer_id") REFERENCES "customers" ("id") ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS `idx_loyalty_accounts_fk_loyalty_customer` ON `loyalty_accounts` (`customer_id`);

CREATE TABLE IF NOT EXISTS "order_items" (
  "id" TEXT NOT NULL,
  "order_id" TEXT NOT NULL,
  "product_id" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "unit_price" NUMERIC NOT NULL,
  "quantity" NUMERIC NOT NULL,
  "total" NUMERIC NOT NULL,
  "created_at" TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
PRIMARY KEY (`id`),
CONSTRAINT "fk_order_items_order" FOREIGN KEY ("order_id") REFERENCES "orders" ("id") ON DELETE CASCADE,
CONSTRAINT "fk_order_items_product" FOREIGN KEY ("product_id") REFERENCES "products" ("id")
);

CREATE INDEX IF NOT EXISTS `idx_order_items_fk_order_items_order` ON `order_items` (`order_id`);

CREATE INDEX IF NOT EXISTS `idx_order_items_fk_order_items_product` ON `order_items` (`product_id`);

CREATE TABLE IF NOT EXISTS "order_payments" (
  "id" TEXT NOT NULL,
  "business_id" TEXT NOT NULL,
  "order_id" TEXT NOT NULL,
  "payment_method_id" TEXT NOT NULL,
  "amount" NUMERIC NOT NULL,
  "created_at" TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
PRIMARY KEY (`id`),
CONSTRAINT "fk_order_payment_business" FOREIGN KEY ("business_id") REFERENCES "businesses" ("id") ON DELETE CASCADE,
CONSTRAINT "fk_order_payment_method" FOREIGN KEY ("payment_method_id") REFERENCES "payment_methods" ("id"),
CONSTRAINT "fk_order_payment_order" FOREIGN KEY ("order_id") REFERENCES "orders" ("id") ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS `idx_order_payments_fk_order_payment_business` ON `order_payments` (`business_id`);

CREATE INDEX IF NOT EXISTS `idx_order_payments_fk_order_payment_method` ON `order_payments` (`payment_method_id`);

CREATE INDEX IF NOT EXISTS `idx_order_payments_idx_order_payments_order` ON `order_payments` (`order_id`);

CREATE TABLE IF NOT EXISTS "orders" (
  "id" TEXT NOT NULL,
  "idempotency_key" TEXT DEFAULT NULL,
  "idempotency_hash" TEXT DEFAULT NULL,
  "business_id" TEXT NOT NULL,
  "restaurant_table_id" TEXT DEFAULT NULL,
  "dining_tab_id" TEXT DEFAULT NULL,
  "customer_id" TEXT DEFAULT NULL,
  "customer_name" TEXT DEFAULT NULL,
  "delivery_address" TEXT DEFAULT NULL CHECK (json_valid("delivery_address")),
  "status" TEXT NOT NULL DEFAULT 'pending' CHECK ("status" IN ('pending', 'confirmed', 'preparing', 'ready', 'out_for_delivery', 'completed', 'cancelled')),
  "payment_method_id" TEXT DEFAULT NULL,
  "subtotal" NUMERIC NOT NULL DEFAULT 0.00,
  "discount_code" TEXT DEFAULT NULL,
  "discount_amount" NUMERIC NOT NULL DEFAULT 0.00,
  "delivery_fee" NUMERIC NOT NULL DEFAULT 0.00,
  "scheduled_for" TEXT DEFAULT NULL,
  "total" NUMERIC NOT NULL DEFAULT 0.00,
  "notes" TEXT DEFAULT NULL,
  "created_at" TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
PRIMARY KEY (`id`),
CONSTRAINT `uq_orders_business_idempotency` UNIQUE (`business_id`,`idempotency_key`),
CONSTRAINT "fk_orders_business" FOREIGN KEY ("business_id") REFERENCES "businesses" ("id") ON DELETE CASCADE,
CONSTRAINT "fk_orders_customer" FOREIGN KEY ("customer_id") REFERENCES "customers" ("id") ON DELETE SET NULL,
CONSTRAINT "fk_orders_dining_tab" FOREIGN KEY ("dining_tab_id") REFERENCES "dining_tabs" ("id") ON DELETE SET NULL,
CONSTRAINT "fk_orders_payment_method" FOREIGN KEY ("payment_method_id") REFERENCES "payment_methods" ("id") ON DELETE SET NULL,
CONSTRAINT "fk_orders_table" FOREIGN KEY ("restaurant_table_id") REFERENCES "restaurant_tables" ("id") ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS `idx_orders_idx_orders_business_status` ON `orders` (`business_id`,`status`,`created_at`);

CREATE INDEX IF NOT EXISTS `idx_orders_fk_orders_table` ON `orders` (`restaurant_table_id`);

CREATE INDEX IF NOT EXISTS `idx_orders_fk_orders_payment_method` ON `orders` (`payment_method_id`);

CREATE INDEX IF NOT EXISTS `idx_orders_idx_orders_dining_tab` ON `orders` (`dining_tab_id`);

CREATE INDEX IF NOT EXISTS `idx_orders_idx_orders_delivery_schedule` ON `orders` (`business_id`,`scheduled_for`,`status`);

CREATE INDEX IF NOT EXISTS `idx_orders_fk_orders_customer` ON `orders` (`customer_id`);

CREATE TABLE IF NOT EXISTS "payment_methods" (
  "id" TEXT NOT NULL,
  "business_id" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "active" INTEGER NOT NULL DEFAULT 1,
  "created_at" TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
PRIMARY KEY (`id`),
CONSTRAINT `uq_payment_methods_business_name` UNIQUE (`business_id`,`name`),
CONSTRAINT "fk_payment_methods_business" FOREIGN KEY ("business_id") REFERENCES "businesses" ("id") ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS "print_jobs" (
  "id" TEXT NOT NULL,
  "business_id" TEXT NOT NULL,
  "order_id" TEXT NOT NULL,
  "station_id" TEXT DEFAULT NULL,
  "job_type" TEXT NOT NULL DEFAULT 'kitchen_ticket' CHECK ("job_type" IN ('kitchen_ticket', 'receipt')),
  "status" TEXT NOT NULL DEFAULT 'queued' CHECK ("status" IN ('queued', 'printed', 'failed')),
  "attempts" INTEGER NOT NULL DEFAULT 0,
  "payload" TEXT NOT NULL CHECK (json_valid("payload")),
  "error_message" TEXT DEFAULT NULL,
  "created_at" TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "printed_at" TEXT DEFAULT NULL,
PRIMARY KEY (`id`),
CONSTRAINT "fk_print_job_business" FOREIGN KEY ("business_id") REFERENCES "businesses" ("id") ON DELETE CASCADE,
CONSTRAINT "fk_print_job_order" FOREIGN KEY ("order_id") REFERENCES "orders" ("id") ON DELETE CASCADE,
CONSTRAINT "fk_print_job_station" FOREIGN KEY ("station_id") REFERENCES "kitchen_stations" ("id") ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS `idx_print_jobs_idx_print_jobs_queue` ON `print_jobs` (`business_id`,`status`,`created_at`);

CREATE INDEX IF NOT EXISTS `idx_print_jobs_fk_print_job_order` ON `print_jobs` (`order_id`);

CREATE INDEX IF NOT EXISTS `idx_print_jobs_fk_print_job_station` ON `print_jobs` (`station_id`);

CREATE TABLE IF NOT EXISTS "product_ingredients" (
  "id" TEXT NOT NULL,
  "business_id" TEXT NOT NULL,
  "product_id" TEXT NOT NULL,
  "inventory_item_id" TEXT NOT NULL,
  "quantity" NUMERIC NOT NULL,
  "created_at" TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
PRIMARY KEY (`id`),
CONSTRAINT `uq_product_ingredient` UNIQUE (`product_id`,`inventory_item_id`),
CONSTRAINT "fk_product_ingredient_business" FOREIGN KEY ("business_id") REFERENCES "businesses" ("id") ON DELETE CASCADE,
CONSTRAINT "fk_product_ingredient_item" FOREIGN KEY ("inventory_item_id") REFERENCES "inventory_items" ("id"),
CONSTRAINT "fk_product_ingredient_product" FOREIGN KEY ("product_id") REFERENCES "products" ("id") ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS `idx_product_ingredients_fk_product_ingredient_business` ON `product_ingredients` (`business_id`);

CREATE INDEX IF NOT EXISTS `idx_product_ingredients_fk_product_ingredient_item` ON `product_ingredients` (`inventory_item_id`);

CREATE TABLE IF NOT EXISTS "products" (
  "id" TEXT NOT NULL,
  "business_id" TEXT NOT NULL,
  "category_id" TEXT NOT NULL,
  "kitchen_station_id" TEXT DEFAULT NULL,
  "name" TEXT NOT NULL,
  "description" TEXT DEFAULT NULL,
  "price" NUMERIC NOT NULL DEFAULT 0.00,
  "image_url" TEXT DEFAULT NULL,
  "position" INTEGER NOT NULL DEFAULT 0,
  "active" INTEGER NOT NULL DEFAULT 1,
  "created_at" TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
PRIMARY KEY (`id`),
CONSTRAINT "fk_products_business" FOREIGN KEY ("business_id") REFERENCES "businesses" ("id") ON DELETE CASCADE,
CONSTRAINT "fk_products_category" FOREIGN KEY ("category_id") REFERENCES "categories" ("id"),
CONSTRAINT "fk_products_kitchen_station" FOREIGN KEY ("kitchen_station_id") REFERENCES "kitchen_stations" ("id") ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS `idx_products_idx_products_business_active` ON `products` (`business_id`,`active`);

CREATE INDEX IF NOT EXISTS `idx_products_fk_products_category` ON `products` (`category_id`);

CREATE INDEX IF NOT EXISTS `idx_products_idx_products_kitchen_station` ON `products` (`kitchen_station_id`);

CREATE TABLE IF NOT EXISTS "purchase_items" (
  "id" TEXT NOT NULL,
  "purchase_order_id" TEXT NOT NULL,
  "inventory_item_id" TEXT NOT NULL,
  "quantity" NUMERIC NOT NULL,
  "unit_cost" NUMERIC NOT NULL,
  "total_cost" NUMERIC NOT NULL,
PRIMARY KEY (`id`),
CONSTRAINT "fk_purchase_item_inventory" FOREIGN KEY ("inventory_item_id") REFERENCES "inventory_items" ("id"),
CONSTRAINT "fk_purchase_item_order" FOREIGN KEY ("purchase_order_id") REFERENCES "purchase_orders" ("id") ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS `idx_purchase_items_fk_purchase_item_order` ON `purchase_items` (`purchase_order_id`);

CREATE INDEX IF NOT EXISTS `idx_purchase_items_fk_purchase_item_inventory` ON `purchase_items` (`inventory_item_id`);

CREATE TABLE IF NOT EXISTS "purchase_orders" (
  "id" TEXT NOT NULL,
  "business_id" TEXT NOT NULL,
  "supplier_id" TEXT DEFAULT NULL,
  "status" TEXT NOT NULL DEFAULT 'received' CHECK ("status" IN ('received', 'cancelled')),
  "total_cost" NUMERIC NOT NULL DEFAULT 0.00,
  "notes" TEXT DEFAULT NULL,
  "received_at" TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
PRIMARY KEY (`id`),
CONSTRAINT "fk_purchase_business" FOREIGN KEY ("business_id") REFERENCES "businesses" ("id") ON DELETE CASCADE,
CONSTRAINT "fk_purchase_supplier" FOREIGN KEY ("supplier_id") REFERENCES "suppliers" ("id") ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS `idx_purchase_orders_fk_purchase_supplier` ON `purchase_orders` (`supplier_id`);

CREATE INDEX IF NOT EXISTS `idx_purchase_orders_idx_purchase_business_received` ON `purchase_orders` (`business_id`,`received_at`);

CREATE TABLE IF NOT EXISTS "restaurant_tables" (
  "id" TEXT NOT NULL,
  "business_id" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "public_token" TEXT NOT NULL,
  "active" INTEGER NOT NULL DEFAULT 1,
  "created_at" TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
PRIMARY KEY (`id`),
CONSTRAINT `uq_restaurant_tables_token` UNIQUE (`public_token`),
CONSTRAINT `uq_restaurant_tables_business_name` UNIQUE (`business_id`,`name`),
CONSTRAINT "fk_restaurant_tables_business" FOREIGN KEY ("business_id") REFERENCES "businesses" ("id") ON DELETE CASCADE
);



CREATE TABLE IF NOT EXISTS "secure_secrets" (
  "id" TEXT NOT NULL,
  "business_id" TEXT NOT NULL,
  "secret_name" TEXT NOT NULL,
  "encrypted_value" TEXT NOT NULL,
  "created_at" TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
PRIMARY KEY (`id`),
CONSTRAINT `uq_secure_secret_business_name` UNIQUE (`business_id`,`secret_name`),
CONSTRAINT "fk_secure_secret_business" FOREIGN KEY ("business_id") REFERENCES "businesses" ("id") ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS "sessions" (
  "token_hash" TEXT NOT NULL,
  "user_id" TEXT NOT NULL,
  "expires_at" TEXT NOT NULL,
  "created_at" TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "last_used_at" TEXT DEFAULT NULL,
  "revoked_at" TEXT DEFAULT NULL,
PRIMARY KEY (`token_hash`),
CONSTRAINT "fk_session_user" FOREIGN KEY ("user_id") REFERENCES "users" ("id") ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS `idx_sessions_idx_sessions_user_expires` ON `sessions` (`user_id`,`expires_at`,`revoked_at`);

CREATE TABLE IF NOT EXISTS "suppliers" (
  "id" TEXT NOT NULL,
  "business_id" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "tax_id" TEXT DEFAULT NULL,
  "phone" TEXT DEFAULT NULL,
  "email" TEXT DEFAULT NULL,
  "notes" TEXT DEFAULT NULL,
  "active" INTEGER NOT NULL DEFAULT 1,
  "created_at" TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
PRIMARY KEY (`id`),
CONSTRAINT "fk_supplier_business" FOREIGN KEY ("business_id") REFERENCES "businesses" ("id") ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS `idx_suppliers_idx_suppliers_business_name` ON `suppliers` (`business_id`,`name`);

CREATE TABLE IF NOT EXISTS "users" (
  "id" TEXT NOT NULL,
  "email" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "password_hash" TEXT NOT NULL,
  "created_at" TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
PRIMARY KEY (`id`),
CONSTRAINT `email` UNIQUE (`email`)
);

CREATE TRIGGER IF NOT EXISTS "trg_businesses_updated_at" AFTER UPDATE OF "id", "name", "description", "primary_color", "settings", "created_at" ON "businesses" FOR EACH ROW WHEN NEW."updated_at" IS OLD."updated_at" BEGIN UPDATE "businesses" SET "updated_at"=CURRENT_TIMESTAMP WHERE "id"=OLD."id"; END;

CREATE TRIGGER IF NOT EXISTS "trg_categories_updated_at" AFTER UPDATE OF "id", "business_id", "name", "description", "position", "active", "created_at" ON "categories" FOR EACH ROW WHEN NEW."updated_at" IS OLD."updated_at" BEGIN UPDATE "categories" SET "updated_at"=CURRENT_TIMESTAMP WHERE "id"=OLD."id"; END;

CREATE TRIGGER IF NOT EXISTS "trg_customers_updated_at" AFTER UPDATE OF "id", "business_id", "name", "phone", "email", "notes", "created_at" ON "customers" FOR EACH ROW WHEN NEW."updated_at" IS OLD."updated_at" BEGIN UPDATE "customers" SET "updated_at"=CURRENT_TIMESTAMP WHERE "id"=OLD."id"; END;

CREATE TRIGGER IF NOT EXISTS "trg_delivery_assignments_updated_at" AFTER UPDATE OF "id", "business_id", "external_order_id", "order_id", "provider", "external_delivery_id", "status", "courier_name", "courier_id", "tracking_url", "payload", "created_at" ON "delivery_assignments" FOR EACH ROW WHEN NEW."updated_at" IS OLD."updated_at" BEGIN UPDATE "delivery_assignments" SET "updated_at"=CURRENT_TIMESTAMP WHERE "id"=OLD."id"; END;

CREATE TRIGGER IF NOT EXISTS "trg_delivery_couriers_updated_at" AFTER UPDATE OF "id", "business_id", "name", "phone", "active", "created_at", "token_hash", "token_expires_at" ON "delivery_couriers" FOR EACH ROW WHEN NEW."updated_at" IS OLD."updated_at" BEGIN UPDATE "delivery_couriers" SET "updated_at"=CURRENT_TIMESTAMP WHERE "id"=OLD."id"; END;

CREATE TRIGGER IF NOT EXISTS "trg_external_orders_updated_at" AFTER UPDATE OF "id", "business_id", "integration_connection_id", "external_order_id", "order_id", "status", "payload", "last_error", "received_at" ON "external_orders" FOR EACH ROW WHEN NEW."updated_at" IS OLD."updated_at" BEGIN UPDATE "external_orders" SET "updated_at"=CURRENT_TIMESTAMP WHERE "id"=OLD."id"; END;

CREATE TRIGGER IF NOT EXISTS "trg_fiscal_documents_updated_at" AFTER UPDATE OF "id", "business_id", "order_id", "document_type", "status", "number", "access_key", "provider", "payload", "response_payload", "error_message", "created_at" ON "fiscal_documents" FOR EACH ROW WHEN NEW."updated_at" IS OLD."updated_at" BEGIN UPDATE "fiscal_documents" SET "updated_at"=CURRENT_TIMESTAMP WHERE "id"=OLD."id"; END;

CREATE TRIGGER IF NOT EXISTS "trg_integration_connections_updated_at" AFTER UPDATE OF "id", "business_id", "provider", "display_name", "status", "settings", "last_error", "last_checked_at", "created_at" ON "integration_connections" FOR EACH ROW WHEN NEW."updated_at" IS OLD."updated_at" BEGIN UPDATE "integration_connections" SET "updated_at"=CURRENT_TIMESTAMP WHERE "id"=OLD."id"; END;

CREATE TRIGGER IF NOT EXISTS "trg_inventory_items_updated_at" AFTER UPDATE OF "id", "business_id", "name", "unit", "current_quantity", "minimum_quantity", "cost_per_unit", "active", "created_at" ON "inventory_items" FOR EACH ROW WHEN NEW."updated_at" IS OLD."updated_at" BEGIN UPDATE "inventory_items" SET "updated_at"=CURRENT_TIMESTAMP WHERE "id"=OLD."id"; END;

CREATE TRIGGER IF NOT EXISTS "trg_kitchen_stations_updated_at" AFTER UPDATE OF "id", "business_id", "name", "printer_url", "active", "created_at" ON "kitchen_stations" FOR EACH ROW WHEN NEW."updated_at" IS OLD."updated_at" BEGIN UPDATE "kitchen_stations" SET "updated_at"=CURRENT_TIMESTAMP WHERE "id"=OLD."id"; END;

CREATE TRIGGER IF NOT EXISTS "trg_local_team_members_updated_at" AFTER UPDATE OF "id", "business_id", "name", "role", "active", "created_at" ON "local_team_members" FOR EACH ROW WHEN NEW."updated_at" IS OLD."updated_at" BEGIN UPDATE "local_team_members" SET "updated_at"=CURRENT_TIMESTAMP WHERE "id"=OLD."id"; END;

CREATE TRIGGER IF NOT EXISTS "trg_loyalty_accounts_updated_at" AFTER UPDATE OF "id", "business_id", "customer_id", "points", "created_at" ON "loyalty_accounts" FOR EACH ROW WHEN NEW."updated_at" IS OLD."updated_at" BEGIN UPDATE "loyalty_accounts" SET "updated_at"=CURRENT_TIMESTAMP WHERE "id"=OLD."id"; END;

CREATE TRIGGER IF NOT EXISTS "trg_orders_updated_at" AFTER UPDATE OF "id", "idempotency_key", "idempotency_hash", "business_id", "restaurant_table_id", "dining_tab_id", "customer_id", "customer_name", "delivery_address", "status", "payment_method_id", "subtotal", "discount_code", "discount_amount", "delivery_fee", "scheduled_for", "total", "notes", "created_at" ON "orders" FOR EACH ROW WHEN NEW."updated_at" IS OLD."updated_at" BEGIN UPDATE "orders" SET "updated_at"=CURRENT_TIMESTAMP WHERE "id"=OLD."id"; END;

CREATE TRIGGER IF NOT EXISTS "trg_products_updated_at" AFTER UPDATE OF "id", "business_id", "category_id", "kitchen_station_id", "name", "description", "price", "image_url", "position", "active", "created_at" ON "products" FOR EACH ROW WHEN NEW."updated_at" IS OLD."updated_at" BEGIN UPDATE "products" SET "updated_at"=CURRENT_TIMESTAMP WHERE "id"=OLD."id"; END;

CREATE TRIGGER IF NOT EXISTS "trg_restaurant_tables_updated_at" AFTER UPDATE OF "id", "business_id", "name", "public_token", "active", "created_at" ON "restaurant_tables" FOR EACH ROW WHEN NEW."updated_at" IS OLD."updated_at" BEGIN UPDATE "restaurant_tables" SET "updated_at"=CURRENT_TIMESTAMP WHERE "id"=OLD."id"; END;

CREATE TRIGGER IF NOT EXISTS "trg_secure_secrets_updated_at" AFTER UPDATE OF "id", "business_id", "secret_name", "encrypted_value", "created_at" ON "secure_secrets" FOR EACH ROW WHEN NEW."updated_at" IS OLD."updated_at" BEGIN UPDATE "secure_secrets" SET "updated_at"=CURRENT_TIMESTAMP WHERE "id"=OLD."id"; END;

CREATE TRIGGER IF NOT EXISTS "trg_suppliers_updated_at" AFTER UPDATE OF "id", "business_id", "name", "tax_id", "phone", "email", "notes", "active", "created_at" ON "suppliers" FOR EACH ROW WHEN NEW."updated_at" IS OLD."updated_at" BEGIN UPDATE "suppliers" SET "updated_at"=CURRENT_TIMESTAMP WHERE "id"=OLD."id"; END;

PRAGMA foreign_keys = ON;
