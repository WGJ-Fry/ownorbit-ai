CREATE TABLE IF NOT EXISTS cloudkit_chat_conversation_owners (
  conversation_id TEXT PRIMARY KEY,
  source_device_hash TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  last_seen_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_cloudkit_chat_conversation_owners_device
  ON cloudkit_chat_conversation_owners (source_device_hash, last_seen_at DESC);
