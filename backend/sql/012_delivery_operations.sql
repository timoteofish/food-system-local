CREATE TABLE IF NOT EXISTS delivery_couriers (
  id CHAR(36) PRIMARY KEY,
  business_id CHAR(36) NOT NULL,
  name VARCHAR(160) NOT NULL,
  phone VARCHAR(40) NULL,
  active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT fk_courier_business FOREIGN KEY (business_id) REFERENCES businesses(id) ON DELETE CASCADE,
  KEY idx_courier_business_active (business_id, active)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

ALTER TABLE delivery_assignments ADD COLUMN order_id CHAR(36) NULL AFTER external_order_id;
ALTER TABLE delivery_assignments ADD COLUMN courier_id CHAR(36) NULL AFTER courier_name;
ALTER TABLE delivery_assignments ADD CONSTRAINT fk_delivery_assignment_order FOREIGN KEY (order_id) REFERENCES orders(id) ON DELETE SET NULL;
ALTER TABLE delivery_assignments ADD CONSTRAINT fk_delivery_assignment_courier FOREIGN KEY (courier_id) REFERENCES delivery_couriers(id) ON DELETE SET NULL;
