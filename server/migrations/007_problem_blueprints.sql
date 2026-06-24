CREATE TABLE IF NOT EXISTS problem_blueprints (
  id TEXT PRIMARY KEY,
  problem TEXT NOT NULL,
  normalized_problem TEXT NOT NULL,
  language TEXT NOT NULL,
  category TEXT NOT NULL,
  category_label TEXT NOT NULL,
  suggested_app_name TEXT NOT NULL,
  summary TEXT NOT NULL,
  steps_json TEXT NOT NULL,
  modules_json TEXT NOT NULL,
  risk_notes_json TEXT NOT NULL,
  app_prompt TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'planned',
  source TEXT NOT NULL DEFAULT 'studio',
  generated_app_id TEXT,
  generated_app_name TEXT,
  created_by_type TEXT,
  created_by_id TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_problem_blueprints_created_at
  ON problem_blueprints (created_at DESC);

CREATE INDEX IF NOT EXISTS idx_problem_blueprints_generated_app_id
  ON problem_blueprints (generated_app_id);
