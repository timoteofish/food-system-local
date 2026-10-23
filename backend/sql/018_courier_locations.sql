CREATE TABLE IF NOT EXISTS courier_locations (
  id CHAR(36) PRIMARY KEY,
  courier_id CHAR(36) NOT NULL,
  business_id CHAR(36) NOT NULL,
  latitude DECIMAL(10,7) NOT NULL,
  longitude DECIMAL(10,7) NOT NULL,
  accuracy_m DECIMAL(10,2) NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  KEY idx_courier_locations_latest (courier_id, created_at),
  CONSTRAINT fk_courier_location_courier FOREIGN KEY (courier_id) REFERENCES delivery_couriers(id) ON DELETE CASCADE,
  CONSTRAINT fk_courier_location_business FOREIGN KEY (business_id) REFERENCES businesses(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
