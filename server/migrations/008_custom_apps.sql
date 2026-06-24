CREATE TABLE IF NOT EXISTS custom_apps (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  description TEXT NOT NULL,
  visibility TEXT NOT NULL DEFAULT 'private',
  status TEXT NOT NULL DEFAULT 'active',
  source TEXT NOT NULL DEFAULT 'studio',
  problem_blueprint_id TEXT,
  code TEXT NOT NULL DEFAULT '',
  created_by_type TEXT,
  created_by_id TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  deleted_at INTEGER,
  FOREIGN KEY (problem_blueprint_id) REFERENCES problem_blueprints(id)
);

CREATE INDEX IF NOT EXISTS idx_custom_apps_updated_at
  ON custom_apps (updated_at DESC);

CREATE INDEX IF NOT EXISTS idx_custom_apps_problem_blueprint_id
  ON custom_apps (problem_blueprint_id);
