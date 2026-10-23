CREATE TABLE IF NOT EXISTS purchase_orders (
  id CHAR(36) PRIMARY KEY,
  business_id CHAR(36) NOT NULL,
  supplier_id CHAR(36) NULL,
  status ENUM('received','cancelled') NOT NULL DEFAULT 'received',
  total_cost DECIMAL(12,2) NOT NULL DEFAULT 0,
  notes VARCHAR(255) NULL,
  received_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_purchase_business FOREIGN KEY (business_id) REFERENCES businesses(id) ON DELETE CASCADE,
  CONSTRAINT fk_purchase_supplier FOREIGN KEY (supplier_id) REFERENCES suppliers(id) ON DELETE SET NULL,
  KEY idx_purchase_business_received (business_id, received_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS purchase_items (
  id CHAR(36) PRIMARY KEY,
  purchase_order_id CHAR(36) NOT NULL,
  inventory_item_id CHAR(36) NOT NULL,
  quantity DECIMAL(12,3) NOT NULL,
  unit_cost DECIMAL(12,4) NOT NULL,
  total_cost DECIMAL(12,2) NOT NULL,
  CONSTRAINT fk_purchase_item_order FOREIGN KEY (purchase_order_id) REFERENCES purchase_orders(id) ON DELETE CASCADE,
  CONSTRAINT fk_purchase_item_inventory FOREIGN KEY (inventory_item_id) REFERENCES inventory_items(id) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
