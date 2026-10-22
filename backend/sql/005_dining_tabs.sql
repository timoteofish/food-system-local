CREATE TABLE IF NOT EXISTS dining_tabs (
  id CHAR(36) PRIMARY KEY,
  business_id CHAR(36) NOT NULL,
  restaurant_table_id CHAR(36) NOT NULL,
  customer_id CHAR(36) NULL,
  status ENUM('open','closed','cancelled') NOT NULL DEFAULT 'open',
  opened_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  closed_at DATETIME NULL,
  notes VARCHAR(500) NULL,
  KEY idx_dining_tabs_business_status (business_id, status),
  CONSTRAINT fk_dining_tab_business FOREIGN KEY (business_id) REFERENCES businesses(id) ON DELETE CASCADE,
  CONSTRAINT fk_dining_tab_table FOREIGN KEY (restaurant_table_id) REFERENCES restaurant_tables(id) ON DELETE RESTRICT,
  CONSTRAINT fk_dining_tab_customer FOREIGN KEY (customer_id) REFERENCES customers(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

ALTER TABLE orders ADD COLUMN dining_tab_id CHAR(36) NULL AFTER restaurant_table_id;
ALTER TABLE orders ADD KEY idx_orders_dining_tab (dining_tab_id);
ALTER TABLE orders ADD CONSTRAINT fk_orders_dining_tab FOREIGN KEY (dining_tab_id) REFERENCES dining_tabs(id) ON DELETE SET NULL;
