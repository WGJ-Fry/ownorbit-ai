ALTER TABLE cloudkit_chat_jobs
  ADD COLUMN response_exported_updated_at INTEGER;

ALTER TABLE cloudkit_chat_jobs
  ADD COLUMN response_exported_at INTEGER;

CREATE INDEX IF NOT EXISTS idx_cloudkit_chat_jobs_response_delivery
  ON cloudkit_chat_jobs (response_exported_updated_at, updated_at);
