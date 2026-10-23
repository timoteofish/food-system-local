ALTER TABLE kitchen_stations ADD COLUMN printer_url VARCHAR(500) NULL AFTER name;

CREATE TABLE IF NOT EXISTS print_jobs (
  id CHAR(36) PRIMARY KEY,
  business_id CHAR(36) NOT NULL,
  order_id CHAR(36) NOT NULL,
  station_id CHAR(36) NULL,
  job_type ENUM('kitchen_ticket','receipt') NOT NULL DEFAULT 'kitchen_ticket',
  status ENUM('queued','printed','failed') NOT NULL DEFAULT 'queued',
  attempts INT NOT NULL DEFAULT 0,
  payload JSON NOT NULL,
  error_message VARCHAR(500) NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  printed_at DATETIME NULL,
  KEY idx_print_jobs_queue (business_id, status, created_at),
  CONSTRAINT fk_print_job_business FOREIGN KEY (business_id) REFERENCES businesses(id) ON DELETE CASCADE,
  CONSTRAINT fk_print_job_order FOREIGN KEY (order_id) REFERENCES orders(id) ON DELETE CASCADE,
  CONSTRAINT fk_print_job_station FOREIGN KEY (station_id) REFERENCES kitchen_stations(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
