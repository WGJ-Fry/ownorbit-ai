ALTER TABLE cloudkit_device_keys
  ADD COLUMN approved_at INTEGER;

ALTER TABLE cloudkit_device_keys
  ADD COLUMN approval_actor TEXT;

CREATE INDEX IF NOT EXISTS idx_cloudkit_device_keys_approval
  ON cloudkit_device_keys (approved_at, status, expires_at);
