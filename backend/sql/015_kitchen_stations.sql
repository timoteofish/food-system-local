CREATE TABLE IF NOT EXISTS kitchen_stations (
  id CHAR(36) PRIMARY KEY,
  business_id CHAR(36) NOT NULL,
  name VARCHAR(120) NOT NULL,
  active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uq_kitchen_station_business_name (business_id, name),
  CONSTRAINT fk_kitchen_station_business FOREIGN KEY (business_id) REFERENCES businesses(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

ALTER TABLE products ADD COLUMN kitchen_station_id CHAR(36) NULL AFTER category_id;
ALTER TABLE products ADD KEY idx_products_kitchen_station (kitchen_station_id);
ALTER TABLE products ADD CONSTRAINT fk_products_kitchen_station FOREIGN KEY (kitchen_station_id) REFERENCES kitchen_stations(id) ON DELETE SET NULL;
