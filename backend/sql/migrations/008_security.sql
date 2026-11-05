CREATE TABLE IF NOT EXISTS audit_logs (
  id CHAR(36) PRIMARY KEY,
  business_id CHAR(36) NULL,
  user_id CHAR(36) NULL,
  action VARCHAR(120) NOT NULL,
  resource_type VARCHAR(80) NULL,
  resource_id CHAR(36) NULL,
  ip_address VARCHAR(45) NULL,
  metadata JSON NOT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  KEY idx_audit_business_created (business_id, created_at),
  CONSTRAINT fk_audit_business FOREIGN KEY (business_id) REFERENCES businesses(id) ON DELETE SET NULL,
  CONSTRAINT fk_audit_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS secure_secrets (
  id CHAR(36) PRIMARY KEY,
  business_id CHAR(36) NOT NULL,
  secret_name VARCHAR(120) NOT NULL,
  encrypted_value TEXT NOT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uq_secure_secret_business_name (business_id, secret_name),
  CONSTRAINT fk_secure_secret_business FOREIGN KEY (business_id) REFERENCES businesses(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

ALTER TABLE sessions ADD COLUMN last_used_at DATETIME NULL AFTER created_at;
ALTER TABLE sessions ADD COLUMN revoked_at DATETIME NULL AFTER last_used_at;
ALTER TABLE sessions ADD KEY idx_sessions_user_expires (user_id, expires_at, revoked_at);
