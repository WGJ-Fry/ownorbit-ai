CREATE TABLE IF NOT EXISTS cloudkit_chat_relay_leases (
  lease_name TEXT PRIMARY KEY,
  lease_id TEXT NOT NULL,
  holder_pid INTEGER NOT NULL,
  acquired_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_cloudkit_chat_relay_leases_expiry
  ON cloudkit_chat_relay_leases (expires_at);
