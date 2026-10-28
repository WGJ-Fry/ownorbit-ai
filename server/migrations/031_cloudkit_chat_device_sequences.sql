CREATE TABLE IF NOT EXISTS cloudkit_chat_device_sequences (
  source_device_hash TEXT NOT NULL,
  client_sequence INTEGER NOT NULL,
  request_id TEXT NOT NULL UNIQUE,
  created_at INTEGER NOT NULL,
  PRIMARY KEY (source_device_hash, client_sequence)
) WITHOUT ROWID;

CREATE INDEX IF NOT EXISTS idx_cloudkit_chat_device_sequences_created
  ON cloudkit_chat_device_sequences (source_device_hash, created_at DESC);
