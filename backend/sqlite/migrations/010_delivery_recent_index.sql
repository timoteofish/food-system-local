CREATE INDEX IF NOT EXISTS idx_delivery_recent_status ON delivery_assignments (business_id, status, updated_at DESC, id DESC);
