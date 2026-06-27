CREATE TABLE IF NOT EXISTS calendar_sync_runs (
  id TEXT PRIMARY KEY,
  provider TEXT NOT NULL,
  mode TEXT NOT NULL,
  status TEXT NOT NULL,
  started_at INTEGER NOT NULL,
  finished_at INTEGER,
  summary_json TEXT NOT NULL,
  conflicts_json TEXT NOT NULL,
  next_steps_json TEXT NOT NULL,
  created_by_type TEXT,
  created_by_id TEXT
);

CREATE INDEX IF NOT EXISTS idx_calendar_sync_runs_started_at
  ON calendar_sync_runs (started_at DESC);

CREATE INDEX IF NOT EXISTS idx_calendar_sync_runs_provider_status
  ON calendar_sync_runs (provider, status);
