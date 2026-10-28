CREATE TABLE IF NOT EXISTS cloudkit_chat_remote_cleanup (
  request_id TEXT PRIMARY KEY,
  status TEXT NOT NULL DEFAULT 'queued',
  attempt_count INTEGER NOT NULL DEFAULT 0,
  next_attempt_at INTEGER NOT NULL,
  created_at INTEGER NOT NULL,
  completed_at INTEGER,
  last_error TEXT
);

CREATE INDEX IF NOT EXISTS idx_cloudkit_chat_remote_cleanup_due
  ON cloudkit_chat_remote_cleanup (status, next_attempt_at, created_at);

INSERT OR IGNORE INTO cloudkit_chat_remote_cleanup (
  request_id,
  status,
  attempt_count,
  next_attempt_at,
  created_at,
  completed_at,
  last_error
)
SELECT
  request_id,
  'queued',
  0,
  response_consumed_at,
  response_consumed_at,
  NULL,
  NULL
FROM cloudkit_chat_jobs
WHERE response_consumed_at IS NOT NULL;
