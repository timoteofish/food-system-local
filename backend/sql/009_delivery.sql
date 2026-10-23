ALTER TABLE orders MODIFY COLUMN status ENUM('pending','confirmed','preparing','ready','out_for_delivery','completed','cancelled') NOT NULL DEFAULT 'pending';
ALTER TABLE orders ADD COLUMN customer_id CHAR(36) NULL AFTER dining_tab_id;
ALTER TABLE orders ADD COLUMN delivery_address JSON NULL AFTER customer_id;
ALTER TABLE orders ADD COLUMN delivery_fee DECIMAL(10,2) NOT NULL DEFAULT 0 AFTER discount_amount;
ALTER TABLE orders ADD COLUMN scheduled_for DATETIME NULL AFTER delivery_fee;
ALTER TABLE orders ADD KEY idx_orders_delivery_schedule (business_id, scheduled_for, status);
ALTER TABLE orders ADD CONSTRAINT fk_orders_customer FOREIGN KEY (customer_id) REFERENCES customers(id) ON DELETE SET NULL;
