ALTER TABLE cloudkit_chat_jobs
  ADD COLUMN response_exported_content_hash TEXT;

ALTER TABLE cloudkit_chat_jobs
  ADD COLUMN response_consumed_at INTEGER;

CREATE INDEX IF NOT EXISTS idx_cloudkit_chat_jobs_response_consumption
  ON cloudkit_chat_jobs (response_consumed_at, updated_at);
