CREATE TABLE IF NOT EXISTS integration_connections (
  id CHAR(36) PRIMARY KEY,
  business_id CHAR(36) NOT NULL,
  provider ENUM('ifood','99food','keeta','delivery_logistics','payment') NOT NULL,
  display_name VARCHAR(120) NOT NULL,
  status ENUM('disconnected','pending','connected','error','disabled') NOT NULL DEFAULT 'disconnected',
  credentials JSON NULL,
  settings JSON NOT NULL,
  last_error TEXT NULL,
  last_synced_at DATETIME NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uq_integration_business_provider (business_id, provider),
  CONSTRAINT fk_integration_connection_business FOREIGN KEY (business_id) REFERENCES businesses(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS external_orders (
  id CHAR(36) PRIMARY KEY,
  business_id CHAR(36) NOT NULL,
  integration_connection_id CHAR(36) NOT NULL,
  external_order_id VARCHAR(190) NOT NULL,
  order_id CHAR(36) NULL,
  status ENUM('received','accepted','preparing','ready','out_for_delivery','completed','cancelled','failed') NOT NULL DEFAULT 'received',
  payload JSON NOT NULL,
  last_error TEXT NULL,
  received_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uq_external_order_provider_id (integration_connection_id, external_order_id),
  KEY idx_external_orders_business_status (business_id, status, received_at),
  CONSTRAINT fk_external_order_business FOREIGN KEY (business_id) REFERENCES businesses(id) ON DELETE CASCADE,
  CONSTRAINT fk_external_order_connection FOREIGN KEY (integration_connection_id) REFERENCES integration_connections(id) ON DELETE CASCADE,
  CONSTRAINT fk_external_order_order FOREIGN KEY (order_id) REFERENCES orders(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS integration_events (
  id CHAR(36) PRIMARY KEY,
  business_id CHAR(36) NOT NULL,
  integration_connection_id CHAR(36) NOT NULL,
  external_order_id VARCHAR(190) NULL,
  direction ENUM('inbound','outbound') NOT NULL,
  event_type VARCHAR(80) NOT NULL,
  status ENUM('pending','processing','processed','failed') NOT NULL DEFAULT 'pending',
  payload JSON NOT NULL,
  error_message TEXT NULL,
  attempts INT NOT NULL DEFAULT 0,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  processed_at DATETIME NULL,
  KEY idx_integration_events_queue (status, created_at),
  CONSTRAINT fk_integration_event_business FOREIGN KEY (business_id) REFERENCES businesses(id) ON DELETE CASCADE,
  CONSTRAINT fk_integration_event_connection FOREIGN KEY (integration_connection_id) REFERENCES integration_connections(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS delivery_assignments (
  id CHAR(36) PRIMARY KEY,
  business_id CHAR(36) NOT NULL,
  external_order_id CHAR(36) NULL,
  provider VARCHAR(80) NOT NULL,
  external_delivery_id VARCHAR(190) NULL,
  status ENUM('requested','assigned','picked_up','delivered','cancelled','failed') NOT NULL DEFAULT 'requested',
  courier_name VARCHAR(160) NULL,
  tracking_url TEXT NULL,
  payload JSON NOT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  KEY idx_delivery_assignments_business_status (business_id, status, created_at),
  CONSTRAINT fk_delivery_assignment_business FOREIGN KEY (business_id) REFERENCES businesses(id) ON DELETE CASCADE,
  CONSTRAINT fk_delivery_assignment_external_order FOREIGN KEY (external_order_id) REFERENCES external_orders(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
