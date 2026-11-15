ALTER TABLE inventory_reservations ADD COLUMN created_by TEXT REFERENCES users(id);
