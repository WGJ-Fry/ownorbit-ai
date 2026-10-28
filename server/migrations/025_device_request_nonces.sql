CREATE TABLE IF NOT EXISTS device_request_nonces (
  device_id TEXT NOT NULL,
  nonce_hash BLOB NOT NULL CHECK (length(nonce_hash) = 32),
  used_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL CHECK (expires_at > used_at),
  PRIMARY KEY (device_id, nonce_hash),
  FOREIGN KEY (device_id) REFERENCES devices(id) ON DELETE CASCADE
) WITHOUT ROWID;

CREATE INDEX IF NOT EXISTS idx_device_request_nonces_expiry
  ON device_request_nonces (expires_at);
