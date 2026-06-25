CREATE TABLE IF NOT EXISTS custom_app_runtime_events (
  id TEXT PRIMARY KEY,
  app_id TEXT NOT NULL,
  event_type TEXT NOT NULL,
  severity TEXT NOT NULL,
  label TEXT NOT NULL,
  message TEXT NOT NULL,
  detail_json TEXT NOT NULL DEFAULT '{}',
  created_by_type TEXT,
  created_by_id TEXT,
  created_at INTEGER NOT NULL,
  FOREIGN KEY (app_id) REFERENCES custom_apps(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_custom_app_runtime_events_app_created
  ON custom_app_runtime_events (app_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_custom_app_runtime_events_app_severity
  ON custom_app_runtime_events (app_id, severity, created_at DESC);
