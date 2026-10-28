ALTER TABLE cloudkit_chat_jobs
  ADD COLUMN trusted_mac_fingerprint TEXT;

CREATE INDEX IF NOT EXISTS idx_cloudkit_chat_jobs_trusted_mac
  ON cloudkit_chat_jobs (trusted_mac_fingerprint, status, created_at);
