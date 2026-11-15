ALTER TABLE production_orders ADD COLUMN expires_at TEXT;
CREATE TABLE inventory_product_lots (
  id TEXT PRIMARY KEY,
  business_id TEXT NOT NULL,
  product_id TEXT NOT NULL,
  location_id TEXT NOT NULL,
  production_order_id TEXT NOT NULL,
  batch_code TEXT NOT NULL,
  expires_at TEXT,
  produced_quantity NUMERIC NOT NULL CHECK (produced_quantity > 0),
  current_quantity NUMERIC NOT NULL CHECK (current_quantity >= 0),
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'depleted', 'quarantined', 'recalled')),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (business_id) REFERENCES businesses(id) ON DELETE CASCADE,
  FOREIGN KEY (product_id) REFERENCES products(id),
  FOREIGN KEY (location_id) REFERENCES inventory_locations(id),
  FOREIGN KEY (production_order_id) REFERENCES production_orders(id)
);
CREATE INDEX idx_inventory_product_lots_available ON inventory_product_lots(business_id, product_id, location_id, status, expires_at, created_at);
CREATE TABLE inventory_reservation_product_items (
  id TEXT PRIMARY KEY,
  business_id TEXT NOT NULL,
  reservation_id TEXT NOT NULL,
  product_id TEXT NOT NULL,
  quantity NUMERIC NOT NULL CHECK (quantity > 0),
  FOREIGN KEY (business_id) REFERENCES businesses(id) ON DELETE CASCADE,
  FOREIGN KEY (reservation_id) REFERENCES inventory_reservations(id) ON DELETE CASCADE,
  FOREIGN KEY (product_id) REFERENCES products(id)
);
CREATE UNIQUE INDEX uq_inventory_reservation_product_item ON inventory_reservation_product_items(reservation_id, product_id);
