CREATE TABLE IF NOT EXISTS custom_app_capability_manifests (
  app_id TEXT PRIMARY KEY,
  allowed_capabilities_json TEXT NOT NULL,
  declared_capabilities_json TEXT NOT NULL DEFAULT '[]',
  risk_level TEXT NOT NULL DEFAULT 'medium',
  updated_by_type TEXT,
  updated_by_id TEXT,
  updated_at INTEGER NOT NULL,
  FOREIGN KEY (app_id) REFERENCES custom_apps(id) ON DELETE CASCADE
);
