CREATE TABLE IF NOT EXISTS custom_app_versions (
  id TEXT PRIMARY KEY,
  app_id TEXT NOT NULL,
  version INTEGER NOT NULL,
  code TEXT NOT NULL DEFAULT '',
  note TEXT,
  created_by_type TEXT,
  created_by_id TEXT,
  created_at INTEGER NOT NULL,
  FOREIGN KEY (app_id) REFERENCES custom_apps(id),
  UNIQUE (app_id, version)
);

CREATE INDEX IF NOT EXISTS idx_custom_app_versions_app_version
  ON custom_app_versions (app_id, version DESC);

CREATE TABLE IF NOT EXISTS custom_app_state (
  app_id TEXT PRIMARY KEY,
  state_json TEXT NOT NULL DEFAULT '{}',
  updated_by_type TEXT,
  updated_by_id TEXT,
  updated_at INTEGER NOT NULL,
  FOREIGN KEY (app_id) REFERENCES custom_apps(id)
);
