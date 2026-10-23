CREATE TABLE IF NOT EXISTS order_payments (
  id CHAR(36) PRIMARY KEY,
  business_id CHAR(36) NOT NULL,
  order_id CHAR(36) NOT NULL,
  payment_method_id CHAR(36) NOT NULL,
  amount DECIMAL(12,2) NOT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_order_payment_business FOREIGN KEY (business_id) REFERENCES businesses(id) ON DELETE CASCADE,
  CONSTRAINT fk_order_payment_order FOREIGN KEY (order_id) REFERENCES orders(id) ON DELETE CASCADE,
  CONSTRAINT fk_order_payment_method FOREIGN KEY (payment_method_id) REFERENCES payment_methods(id) ON DELETE RESTRICT,
  KEY idx_order_payments_order (order_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
