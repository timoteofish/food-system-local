ALTER TABLE inventory_movements ADD COLUMN lot_id TEXT REFERENCES inventory_lots(id);

CREATE TABLE inventory_location_item_settings (
  business_id TEXT NOT NULL,
  location_id TEXT NOT NULL,
  inventory_item_id TEXT NOT NULL,
  minimum_quantity NUMERIC NOT NULL DEFAULT 0 CHECK (minimum_quantity >= 0),
  reorder_quantity NUMERIC NOT NULL DEFAULT 0 CHECK (reorder_quantity >= 0),
  lead_time_days INTEGER NOT NULL DEFAULT 0 CHECK (lead_time_days >= 0),
  PRIMARY KEY (location_id, inventory_item_id),
  FOREIGN KEY (business_id) REFERENCES businesses(id) ON DELETE CASCADE,
  FOREIGN KEY (location_id) REFERENCES inventory_locations(id),
  FOREIGN KEY (inventory_item_id) REFERENCES inventory_items(id)
);

CREATE TABLE inventory_transfer_orders (
  id TEXT PRIMARY KEY,
  business_id TEXT NOT NULL,
  from_location_id TEXT NOT NULL,
  to_location_id TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'in_transit', 'received', 'cancelled')),
  notes TEXT,
  created_by TEXT,
  approved_by TEXT,
  shipped_at TEXT,
  received_at TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (business_id) REFERENCES businesses(id) ON DELETE CASCADE,
  FOREIGN KEY (from_location_id) REFERENCES inventory_locations(id),
  FOREIGN KEY (to_location_id) REFERENCES inventory_locations(id),
  FOREIGN KEY (created_by) REFERENCES users(id),
  FOREIGN KEY (approved_by) REFERENCES users(id)
);
CREATE TABLE inventory_transfer_items (
  id TEXT PRIMARY KEY,
  business_id TEXT NOT NULL,
  transfer_id TEXT NOT NULL,
  inventory_item_id TEXT NOT NULL,
  lot_id TEXT NOT NULL,
  quantity NUMERIC NOT NULL CHECK (quantity > 0),
  FOREIGN KEY (business_id) REFERENCES businesses(id) ON DELETE CASCADE,
  FOREIGN KEY (transfer_id) REFERENCES inventory_transfer_orders(id) ON DELETE CASCADE,
  FOREIGN KEY (inventory_item_id) REFERENCES inventory_items(id),
  FOREIGN KEY (lot_id) REFERENCES inventory_lots(id)
);
