CREATE TABLE IF NOT EXISTS cash_movement_idempotency (
  business_id TEXT NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  idempotency_key TEXT NOT NULL,
  request_hash TEXT NOT NULL,
  response_json TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (business_id, idempotency_key)
);
