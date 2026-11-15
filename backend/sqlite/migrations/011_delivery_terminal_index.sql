DROP INDEX IF EXISTS idx_delivery_recent_status;
CREATE INDEX IF NOT EXISTS idx_delivery_terminal_recent
  ON delivery_assignments (business_id, updated_at DESC, id DESC)
  WHERE status IN ('delivered','cancelled');
