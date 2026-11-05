ALTER TABLE cash_movements ADD COLUMN session_id CHAR(36) NULL AFTER business_id;
ALTER TABLE cash_movements ADD KEY idx_cash_movements_session (session_id, created_at);
ALTER TABLE cash_movements ADD CONSTRAINT fk_cash_movement_session FOREIGN KEY (session_id) REFERENCES cash_register_sessions(id) ON DELETE SET NULL;
ALTER TABLE cash_register_sessions ADD COLUMN expected_amount DECIMAL(12,2) NULL AFTER closing_amount;
ALTER TABLE cash_register_sessions ADD COLUMN difference_amount DECIMAL(12,2) NULL AFTER expected_amount;
