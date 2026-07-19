CREATE TABLE IF NOT EXISTS cloudkit_chat_jobs (
  request_id TEXT PRIMARY KEY,
  conversation_id TEXT NOT NULL,
  user_message_id TEXT NOT NULL UNIQUE,
  assistant_message_id TEXT,
  source_device_hash TEXT NOT NULL,
  request_record_name TEXT NOT NULL UNIQUE,
  request_content_hash TEXT NOT NULL,
  locale TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('queued', 'processing', 'completed', 'failed', 'expired')),
  attempt_count INTEGER NOT NULL DEFAULT 0,
  next_attempt_at INTEGER,
  lease_id TEXT,
  lease_expires_at INTEGER,
  expires_at INTEGER NOT NULL,
  response_id TEXT NOT NULL UNIQUE,
  safe_error_code TEXT,
  provider_label TEXT,
  model_label TEXT,
  created_at INTEGER NOT NULL,
  imported_at INTEGER NOT NULL,
  started_at INTEGER,
  completed_at INTEGER,
  updated_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_cloudkit_chat_jobs_due
  ON cloudkit_chat_jobs (status, next_attempt_at, created_at);

CREATE INDEX IF NOT EXISTS idx_cloudkit_chat_jobs_lease
  ON cloudkit_chat_jobs (status, lease_expires_at);

CREATE INDEX IF NOT EXISTS idx_cloudkit_chat_jobs_conversation
  ON cloudkit_chat_jobs (conversation_id, created_at);
