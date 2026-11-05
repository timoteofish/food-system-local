CREATE TABLE IF NOT EXISTS inventory_items (
  id CHAR(36) PRIMARY KEY,
  business_id CHAR(36) NOT NULL,
  name VARCHAR(160) NOT NULL,
  unit ENUM('unit','g','kg','ml','l') NOT NULL DEFAULT 'unit',
  current_quantity DECIMAL(12,3) NOT NULL DEFAULT 0,
  minimum_quantity DECIMAL(12,3) NOT NULL DEFAULT 0,
  cost_per_unit DECIMAL(12,4) NOT NULL DEFAULT 0,
  active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uq_inventory_business_name (business_id, name),
  KEY idx_inventory_business_active (business_id, active),
  CONSTRAINT fk_inventory_item_business FOREIGN KEY (business_id) REFERENCES businesses(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS product_ingredients (
  id CHAR(36) PRIMARY KEY,
  business_id CHAR(36) NOT NULL,
  product_id CHAR(36) NOT NULL,
  inventory_item_id CHAR(36) NOT NULL,
  quantity DECIMAL(12,3) NOT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uq_product_ingredient (product_id, inventory_item_id),
  CONSTRAINT fk_product_ingredient_business FOREIGN KEY (business_id) REFERENCES businesses(id) ON DELETE CASCADE,
  CONSTRAINT fk_product_ingredient_product FOREIGN KEY (product_id) REFERENCES products(id) ON DELETE CASCADE,
  CONSTRAINT fk_product_ingredient_item FOREIGN KEY (inventory_item_id) REFERENCES inventory_items(id) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS inventory_movements (
  id CHAR(36) PRIMARY KEY,
  business_id CHAR(36) NOT NULL,
  inventory_item_id CHAR(36) NOT NULL,
  order_id CHAR(36) NULL,
  type ENUM('purchase','adjustment','loss','sale') NOT NULL,
  quantity DECIMAL(12,3) NOT NULL,
  description VARCHAR(255) NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uq_inventory_order_item (order_id, inventory_item_id, type),
  KEY idx_inventory_movements_business_created (business_id, created_at),
  CONSTRAINT fk_inventory_movement_business FOREIGN KEY (business_id) REFERENCES businesses(id) ON DELETE CASCADE,
  CONSTRAINT fk_inventory_movement_item FOREIGN KEY (inventory_item_id) REFERENCES inventory_items(id) ON DELETE RESTRICT,
  CONSTRAINT fk_inventory_movement_order FOREIGN KEY (order_id) REFERENCES orders(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
