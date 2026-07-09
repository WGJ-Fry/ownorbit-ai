CREATE TABLE IF NOT EXISTS cloudkit_sync_checkpoints (
  zone TEXT PRIMARY KEY,
  applied_server_change_token TEXT,
  pending_server_change_token TEXT,
  token_state TEXT NOT NULL DEFAULT 'none',
  last_evidence_id TEXT,
  last_preview_at INTEGER,
  last_applied_at INTEGER,
  changed_count INTEGER NOT NULL DEFAULT 0,
  deleted_count INTEGER NOT NULL DEFAULT 0,
  failed_count INTEGER NOT NULL DEFAULT 0,
  more_coming INTEGER NOT NULL DEFAULT 0,
  updated_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_cloudkit_sync_checkpoints_updated_at
  ON cloudkit_sync_checkpoints (updated_at DESC);
