CREATE TABLE IF NOT EXISTS cloudkit_sync_quarantine (
  id TEXT PRIMARY KEY,
  zone TEXT NOT NULL,
  record_type TEXT NOT NULL,
  record_name TEXT NOT NULL,
  change_type TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending-review',
  mutation_id TEXT,
  content_hash TEXT,
  payload_hash TEXT,
  logical_clock INTEGER,
  payload_byte_size INTEGER NOT NULL DEFAULT 0,
  requires_user_review INTEGER NOT NULL DEFAULT 1,
  payload_json TEXT,
  server_modified_at TEXT,
  deleted_at TEXT,
  source_evidence_id TEXT,
  imported_at INTEGER NOT NULL,
  applied_at INTEGER,
  error TEXT,
  UNIQUE (zone, record_type, record_name, change_type, content_hash)
);

CREATE INDEX IF NOT EXISTS idx_cloudkit_sync_quarantine_status_imported
  ON cloudkit_sync_quarantine (status, imported_at DESC);

CREATE INDEX IF NOT EXISTS idx_cloudkit_sync_quarantine_record
  ON cloudkit_sync_quarantine (zone, record_type, record_name);
