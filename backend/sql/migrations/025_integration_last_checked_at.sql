ALTER TABLE integration_connections
  CHANGE COLUMN last_synced_at last_checked_at DATETIME NULL;
