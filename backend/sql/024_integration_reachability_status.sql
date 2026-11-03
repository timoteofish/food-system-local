ALTER TABLE integration_connections
  MODIFY status ENUM('disconnected','pending','reachable','connected','error','disabled') NOT NULL DEFAULT 'disconnected';

UPDATE integration_connections SET status = 'reachable' WHERE status = 'connected';

ALTER TABLE integration_connections
  MODIFY status ENUM('disconnected','pending','reachable','error','disabled') NOT NULL DEFAULT 'disconnected';
