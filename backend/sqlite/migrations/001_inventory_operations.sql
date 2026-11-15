CREATE TABLE IF NOT EXISTS inventory_idempotency (
  business_id TEXT NOT NULL,
  idempotency_key TEXT NOT NULL,
  operation TEXT NOT NULL,
  request_hash TEXT NOT NULL,
  response_json TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (business_id, idempotency_key),
  FOREIGN KEY (business_id) REFERENCES businesses(id) ON DELETE CASCADE
);

CREATE TABLE inventory_locations (
  id TEXT PRIMARY KEY,
  business_id TEXT NOT NULL,
  name TEXT NOT NULL,
  code TEXT NOT NULL,
  active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (business_id, code),
  UNIQUE (business_id, name),
  FOREIGN KEY (business_id) REFERENCES businesses(id) ON DELETE CASCADE
);

CREATE TABLE inventory_lots (
  id TEXT PRIMARY KEY,
  business_id TEXT NOT NULL,
  inventory_item_id TEXT NOT NULL,
  location_id TEXT NOT NULL,
  lot_code TEXT NOT NULL,
  received_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  expires_at TEXT,
  initial_quantity NUMERIC NOT NULL CHECK (initial_quantity >= 0),
  current_quantity NUMERIC NOT NULL CHECK (current_quantity >= 0),
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'depleted', 'quarantined', 'recalled')),
  UNIQUE (inventory_item_id, location_id, lot_code),
  FOREIGN KEY (business_id) REFERENCES businesses(id) ON DELETE CASCADE,
  FOREIGN KEY (inventory_item_id) REFERENCES inventory_items(id),
  FOREIGN KEY (location_id) REFERENCES inventory_locations(id)
);
CREATE INDEX idx_inventory_lots_available ON inventory_lots(business_id, inventory_item_id, location_id, status, expires_at, received_at);

CREATE TABLE inventory_movement_lot_allocations (
  id TEXT PRIMARY KEY,
  business_id TEXT NOT NULL,
  movement_id TEXT NOT NULL,
  lot_id TEXT NOT NULL,
  quantity NUMERIC NOT NULL CHECK (quantity > 0),
  FOREIGN KEY (business_id) REFERENCES businesses(id) ON DELETE CASCADE,
  FOREIGN KEY (movement_id) REFERENCES inventory_movements(id) ON DELETE CASCADE,
  FOREIGN KEY (lot_id) REFERENCES inventory_lots(id)
);
CREATE INDEX idx_inventory_movement_lot_movement ON inventory_movement_lot_allocations(movement_id);
CREATE INDEX idx_inventory_movement_lot_lot ON inventory_movement_lot_allocations(lot_id);

CREATE TABLE stock_counts (
  id TEXT PRIMARY KEY,
  business_id TEXT NOT NULL,
  location_id TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'submitted', 'approved', 'rejected')),
  notes TEXT,
  created_by TEXT,
  approved_by TEXT,
  started_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  submitted_at TEXT,
  approved_at TEXT,
  FOREIGN KEY (business_id) REFERENCES businesses(id) ON DELETE CASCADE,
  FOREIGN KEY (location_id) REFERENCES inventory_locations(id),
  FOREIGN KEY (created_by) REFERENCES users(id),
  FOREIGN KEY (approved_by) REFERENCES users(id)
);
CREATE TABLE stock_count_items (
  id TEXT PRIMARY KEY,
  business_id TEXT NOT NULL,
  stock_count_id TEXT NOT NULL,
  inventory_item_id TEXT NOT NULL,
  expected_quantity NUMERIC NOT NULL,
  counted_quantity NUMERIC,
  variance_reason TEXT,
  FOREIGN KEY (business_id) REFERENCES businesses(id) ON DELETE CASCADE,
  FOREIGN KEY (stock_count_id) REFERENCES stock_counts(id) ON DELETE CASCADE,
  FOREIGN KEY (inventory_item_id) REFERENCES inventory_items(id)
);
CREATE UNIQUE INDEX uq_stock_count_item ON stock_count_items(stock_count_id, inventory_item_id);

CREATE TABLE inventory_reservations (
  id TEXT PRIMARY KEY,
  business_id TEXT NOT NULL,
  order_id TEXT,
  status TEXT NOT NULL DEFAULT 'held' CHECK (status IN ('held', 'released', 'consumed')),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (business_id) REFERENCES businesses(id) ON DELETE CASCADE,
  FOREIGN KEY (order_id) REFERENCES orders(id) ON DELETE CASCADE
);
CREATE TABLE inventory_reservation_items (
  id TEXT PRIMARY KEY,
  business_id TEXT NOT NULL,
  reservation_id TEXT NOT NULL,
  inventory_item_id TEXT NOT NULL,
  quantity NUMERIC NOT NULL CHECK (quantity > 0),
  FOREIGN KEY (business_id) REFERENCES businesses(id) ON DELETE CASCADE,
  FOREIGN KEY (reservation_id) REFERENCES inventory_reservations(id) ON DELETE CASCADE,
  FOREIGN KEY (inventory_item_id) REFERENCES inventory_items(id)
);
CREATE UNIQUE INDEX uq_inventory_reservation_item ON inventory_reservation_items(reservation_id, inventory_item_id);

CREATE TABLE product_recipe_versions (
  id TEXT PRIMARY KEY,
  business_id TEXT NOT NULL,
  product_id TEXT NOT NULL,
  version INTEGER NOT NULL,
  recipe_json TEXT NOT NULL,
  created_by TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (product_id, version),
  FOREIGN KEY (business_id) REFERENCES businesses(id) ON DELETE CASCADE,
  FOREIGN KEY (product_id) REFERENCES products(id) ON DELETE CASCADE,
  FOREIGN KEY (created_by) REFERENCES users(id)
);

CREATE TABLE production_orders (
  id TEXT PRIMARY KEY,
  business_id TEXT NOT NULL,
  product_id TEXT NOT NULL,
  recipe_version_id TEXT,
  batch_code TEXT NOT NULL,
  planned_quantity NUMERIC NOT NULL CHECK (planned_quantity > 0),
  actual_quantity NUMERIC,
  status TEXT NOT NULL DEFAULT 'planned' CHECK (status IN ('planned', 'in_progress', 'completed', 'cancelled')),
  started_at TEXT,
  completed_at TEXT,
  created_by TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (business_id, batch_code),
  FOREIGN KEY (business_id) REFERENCES businesses(id) ON DELETE CASCADE,
  FOREIGN KEY (product_id) REFERENCES products(id),
  FOREIGN KEY (recipe_version_id) REFERENCES product_recipe_versions(id),
  FOREIGN KEY (created_by) REFERENCES users(id)
);

ALTER TABLE inventory_movements ADD COLUMN location_id TEXT REFERENCES inventory_locations(id);
ALTER TABLE inventory_movements ADD COLUMN created_by TEXT REFERENCES users(id);
ALTER TABLE purchase_items ADD COLUMN lot_code TEXT;
ALTER TABLE purchase_items ADD COLUMN expires_at TEXT;

INSERT INTO inventory_locations (id, business_id, name, code)
SELECT lower(hex(randomblob(4))) || '-' || lower(hex(randomblob(2))) || '-4' || substr(lower(hex(randomblob(2))), 2) || '-' || substr('89ab', abs(random()) % 4 + 1, 1) || substr(lower(hex(randomblob(2))), 2) || '-' || lower(hex(randomblob(6))), id, 'Principal', 'MAIN' FROM businesses;

INSERT INTO inventory_lots (id, business_id, inventory_item_id, location_id, lot_code, initial_quantity, current_quantity, status)
SELECT 'legacy-lot-' || ii.id, ii.business_id, ii.id, il.id, 'SALDO-LEGADO-' || ii.id, ii.current_quantity, ii.current_quantity,
       CASE WHEN ii.current_quantity > 0 THEN 'active' ELSE 'depleted' END
FROM inventory_items ii JOIN inventory_locations il ON il.business_id = ii.business_id AND il.code = 'MAIN';

UPDATE inventory_movements
SET location_id = (SELECT id FROM inventory_locations WHERE business_id = inventory_movements.business_id AND code = 'MAIN' LIMIT 1)
WHERE location_id IS NULL;
