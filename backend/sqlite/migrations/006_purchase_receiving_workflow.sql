CREATE TABLE inventory_purchase_orders (
  id TEXT PRIMARY KEY,
  business_id TEXT NOT NULL,
  supplier_id TEXT,
  location_id TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'ordered' CHECK (status IN ('ordered', 'partial', 'received', 'cancelled')),
  notes TEXT,
  created_by TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (business_id) REFERENCES businesses(id) ON DELETE CASCADE,
  FOREIGN KEY (supplier_id) REFERENCES suppliers(id) ON DELETE SET NULL,
  FOREIGN KEY (location_id) REFERENCES inventory_locations(id),
  FOREIGN KEY (created_by) REFERENCES users(id)
);
CREATE TABLE inventory_purchase_order_items (
  id TEXT PRIMARY KEY,
  business_id TEXT NOT NULL,
  purchase_order_id TEXT NOT NULL,
  inventory_item_id TEXT NOT NULL,
  ordered_quantity NUMERIC NOT NULL CHECK (ordered_quantity > 0),
  received_quantity NUMERIC NOT NULL DEFAULT 0 CHECK (received_quantity >= 0),
  unit_cost NUMERIC NOT NULL CHECK (unit_cost >= 0),
  FOREIGN KEY (business_id) REFERENCES businesses(id) ON DELETE CASCADE,
  FOREIGN KEY (purchase_order_id) REFERENCES inventory_purchase_orders(id) ON DELETE CASCADE,
  FOREIGN KEY (inventory_item_id) REFERENCES inventory_items(id)
);
CREATE TABLE inventory_purchase_receipts (
  id TEXT PRIMARY KEY,
  business_id TEXT NOT NULL,
  purchase_order_id TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'received' CHECK (status IN ('received', 'reversed')),
  received_by TEXT,
  received_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  reversed_by TEXT,
  reversed_at TEXT,
  FOREIGN KEY (business_id) REFERENCES businesses(id) ON DELETE CASCADE,
  FOREIGN KEY (purchase_order_id) REFERENCES inventory_purchase_orders(id),
  FOREIGN KEY (received_by) REFERENCES users(id),
  FOREIGN KEY (reversed_by) REFERENCES users(id)
);
CREATE TABLE inventory_purchase_receipt_items (
  id TEXT PRIMARY KEY,
  business_id TEXT NOT NULL,
  receipt_id TEXT NOT NULL,
  order_item_id TEXT NOT NULL,
  lot_id TEXT NOT NULL,
  quantity NUMERIC NOT NULL CHECK (quantity > 0),
  unit_cost NUMERIC NOT NULL CHECK (unit_cost >= 0),
  FOREIGN KEY (business_id) REFERENCES businesses(id) ON DELETE CASCADE,
  FOREIGN KEY (receipt_id) REFERENCES inventory_purchase_receipts(id) ON DELETE CASCADE,
  FOREIGN KEY (order_item_id) REFERENCES inventory_purchase_order_items(id),
  FOREIGN KEY (lot_id) REFERENCES inventory_lots(id)
);
CREATE INDEX idx_inventory_purchase_order_status ON inventory_purchase_orders(business_id, status, created_at);
CREATE INDEX idx_inventory_purchase_receipt_order ON inventory_purchase_receipts(purchase_order_id, status);
