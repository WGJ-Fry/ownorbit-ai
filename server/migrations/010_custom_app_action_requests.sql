CREATE TABLE IF NOT EXISTS custom_app_action_requests (
  id TEXT PRIMARY KEY,
  app_id TEXT NOT NULL,
  action_type TEXT NOT NULL,
  label TEXT NOT NULL,
  target_url TEXT NOT NULL,
  target_scheme TEXT NOT NULL,
  params_summary TEXT NOT NULL DEFAULT '-',
  risk TEXT NOT NULL,
  status TEXT NOT NULL,
  reason TEXT,
  created_by_type TEXT,
  created_by_id TEXT,
  created_at INTEGER NOT NULL,
  decided_by_type TEXT,
  decided_by_id TEXT,
  decided_at INTEGER,
  decision_note TEXT,
  FOREIGN KEY (app_id) REFERENCES custom_apps(id)
);

CREATE INDEX IF NOT EXISTS idx_custom_app_action_requests_app_status
  ON custom_app_action_requests (app_id, status, created_at DESC);
