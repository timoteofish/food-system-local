ALTER TABLE orders ADD COLUMN discount_code VARCHAR(40) NULL AFTER subtotal;
ALTER TABLE orders ADD COLUMN discount_amount DECIMAL(10,2) NOT NULL DEFAULT 0 AFTER discount_code;
