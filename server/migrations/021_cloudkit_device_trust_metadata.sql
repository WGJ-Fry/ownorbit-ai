CREATE TABLE IF NOT EXISTS cloudkit_device_trust_metadata (
  device_id_hash TEXT PRIMARY KEY,
  display_name TEXT NOT NULL,
  device_type TEXT NOT NULL,
  trust_state TEXT NOT NULL,
  public_key_fingerprint TEXT,
  access_expires_at INTEGER,
  created_at INTEGER,
  last_seen_at INTEGER,
  revoked_at INTEGER,
  mutation_id TEXT,
  logical_clock INTEGER NOT NULL DEFAULT 0,
  source_record_name TEXT NOT NULL,
  source_evidence_id TEXT,
  review_status TEXT NOT NULL DEFAULT 'needs-rebind',
  access_granted INTEGER NOT NULL DEFAULT 0,
  imported_at INTEGER NOT NULL,
  applied_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_cloudkit_device_trust_metadata_review
  ON cloudkit_device_trust_metadata (review_status, applied_at DESC);
