ALTER TABLE production_orders ADD COLUMN location_id TEXT REFERENCES inventory_locations(id);
ALTER TABLE production_orders ADD COLUMN waste_quantity NUMERIC NOT NULL DEFAULT 0 CHECK (waste_quantity >= 0);
ALTER TABLE production_orders ADD COLUMN yield_percent NUMERIC NOT NULL DEFAULT 100 CHECK (yield_percent >= 0 AND yield_percent <= 100);
