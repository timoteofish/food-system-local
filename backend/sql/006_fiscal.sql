CREATE TABLE IF NOT EXISTS fiscal_documents (
  id CHAR(36) PRIMARY KEY,
  business_id CHAR(36) NOT NULL,
  order_id CHAR(36) NULL,
  document_type ENUM('nfce','nfe','receipt') NOT NULL DEFAULT 'nfce',
  status ENUM('draft','pending','authorized','rejected','cancelled') NOT NULL DEFAULT 'draft',
  number VARCHAR(40) NULL,
  access_key VARCHAR(60) NULL,
  provider VARCHAR(80) NULL,
  payload JSON NOT NULL,
  response_payload JSON NULL,
  error_message VARCHAR(500) NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  KEY idx_fiscal_business_status (business_id, status),
  CONSTRAINT fk_fiscal_business FOREIGN KEY (business_id) REFERENCES businesses(id) ON DELETE CASCADE,
  CONSTRAINT fk_fiscal_order FOREIGN KEY (order_id) REFERENCES orders(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
