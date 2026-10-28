ALTER TABLE admin_sessions
  ADD COLUMN credential_source TEXT NOT NULL DEFAULT 'db';

ALTER TABLE admin_sessions
  ADD COLUMN credential_version INTEGER NOT NULL DEFAULT 0;

ALTER TABLE admin_sessions
  ADD COLUMN revoked_reason TEXT;

UPDATE admin_sessions
SET revoked_at = COALESCE(revoked_at, CAST(strftime('%s', 'now') AS INTEGER) * 1000),
    revoked_reason = COALESCE(revoked_reason, 'credential-version-migration');
