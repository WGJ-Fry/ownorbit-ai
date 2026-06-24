CREATE TABLE IF NOT EXISTS custom_app_action_policies (
  app_id TEXT PRIMARY KEY,
  template TEXT NOT NULL DEFAULT 'global',
  allowed_schemes_json TEXT NOT NULL,
  require_confirmation INTEGER NOT NULL DEFAULT 1,
  updated_by_type TEXT,
  updated_by_id TEXT,
  updated_at INTEGER NOT NULL,
  FOREIGN KEY (app_id) REFERENCES custom_apps(id) ON DELETE CASCADE
);
