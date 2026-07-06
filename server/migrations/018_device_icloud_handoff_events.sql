CREATE TABLE IF NOT EXISTS device_icloud_handoff_events (
  id TEXT PRIMARY KEY,
  device_id TEXT NOT NULL,
  event_type TEXT NOT NULL,
  entry_base_url TEXT NOT NULL,
  current_base_url TEXT NOT NULL,
  stored_base_url TEXT NOT NULL,
  entry_generated_at INTEGER,
  stored_generated_at INTEGER,
  checksum_sha256 TEXT,
  ignored_at INTEGER NOT NULL,
  created_at INTEGER NOT NULL,
  FOREIGN KEY (device_id) REFERENCES devices(id)
);

CREATE INDEX IF NOT EXISTS idx_device_icloud_handoff_events_device_created
  ON device_icloud_handoff_events (device_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_device_icloud_handoff_events_created
  ON device_icloud_handoff_events (created_at DESC);
