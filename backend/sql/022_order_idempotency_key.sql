ALTER TABLE orders ADD COLUMN idempotency_key CHAR(36) NULL AFTER id;
ALTER TABLE orders ADD COLUMN idempotency_hash CHAR(64) NULL AFTER idempotency_key;
ALTER TABLE orders ADD UNIQUE KEY uq_orders_business_idempotency (business_id, idempotency_key);
