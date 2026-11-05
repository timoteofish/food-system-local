ALTER TABLE delivery_couriers ADD COLUMN token_hash CHAR(64) NULL;
ALTER TABLE delivery_couriers ADD COLUMN token_expires_at DATETIME NULL;
ALTER TABLE delivery_couriers ADD UNIQUE KEY uq_delivery_courier_token (token_hash);
