CREATE INDEX IF NOT EXISTS idx_orders_business_created_at ON orders (business_id, created_at DESC, id DESC);
