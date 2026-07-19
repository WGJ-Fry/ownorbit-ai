CREATE TABLE IF NOT EXISTS cloudkit_device_keys (
  device_id TEXT PRIMARY KEY,
  device_id_hash TEXT NOT NULL UNIQUE,
  display_name TEXT NOT NULL,
  device_type TEXT NOT NULL CHECK (device_type = 'ios'),
  channel_scope TEXT NOT NULL CHECK (channel_scope = 'cloudkit-chat'),
  public_key TEXT NOT NULL,
  public_key_fingerprint TEXT NOT NULL UNIQUE,
  status TEXT NOT NULL CHECK (status IN ('active', 'revoked', 'expired')),
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  logical_clock INTEGER NOT NULL,
  mutation_id TEXT NOT NULL,
  source_record_name TEXT NOT NULL,
  source_evidence_id TEXT,
  imported_at INTEGER NOT NULL,
  applied_at INTEGER NOT NULL,
  revoked_at INTEGER
);

CREATE INDEX IF NOT EXISTS idx_cloudkit_device_keys_active
  ON cloudkit_device_keys (status, expires_at);

CREATE INDEX IF NOT EXISTS idx_cloudkit_device_keys_fingerprint
  ON cloudkit_device_keys (public_key_fingerprint);
