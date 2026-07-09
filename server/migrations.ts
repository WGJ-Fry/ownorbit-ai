import fs from "fs";
import path from "path";
import { applyMigration } from "./db";

type Migration = {
  name: string;
  sql: string;
  version: number;
};

const fallbackMigrations: Migration[] = [
  {
    version: 1,
    name: "device_token_expiry",
    sql: "ALTER TABLE devices ADD COLUMN access_token_expires_at INTEGER;",
  },
  {
    version: 2,
    name: "app_secrets",
    sql: `
CREATE TABLE IF NOT EXISTS app_secrets (
  id TEXT PRIMARY KEY,
  provider TEXT NOT NULL,
  ciphertext TEXT NOT NULL,
  iv TEXT NOT NULL,
  auth_tag TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
`,
  },
  {
    version: 3,
    name: "app_secret_storage",
    sql: "ALTER TABLE app_secrets ADD COLUMN secret_storage TEXT NOT NULL DEFAULT 'local_aes_gcm';",
  },
  {
    version: 4,
    name: "device_connectivity_reports",
    sql: `
CREATE TABLE IF NOT EXISTS device_connectivity_reports (
  id TEXT PRIMARY KEY,
  device_id TEXT NOT NULL,
  ok INTEGER NOT NULL,
  current_base_url TEXT NOT NULL,
  health_ok INTEGER NOT NULL,
  websocket_ok INTEGER NOT NULL,
  latency_ms INTEGER NOT NULL,
  error TEXT,
  created_at INTEGER NOT NULL,
  FOREIGN KEY (device_id) REFERENCES devices(id)
);
`,
  },
  {
    version: 5,
    name: "binding_session_base_url",
    sql: "ALTER TABLE binding_sessions ADD COLUMN base_url TEXT;",
  },
  {
    version: 6,
    name: "device_connectivity_mobile_shell",
    sql: "ALTER TABLE device_connectivity_reports ADD COLUMN mobile_shell_ok INTEGER NOT NULL DEFAULT 0;",
  },
  {
    version: 7,
    name: "problem_blueprints",
    sql: `
CREATE TABLE IF NOT EXISTS problem_blueprints (
  id TEXT PRIMARY KEY,
  problem TEXT NOT NULL,
  normalized_problem TEXT NOT NULL,
  language TEXT NOT NULL,
  category TEXT NOT NULL,
  category_label TEXT NOT NULL,
  suggested_app_name TEXT NOT NULL,
  summary TEXT NOT NULL,
  steps_json TEXT NOT NULL,
  modules_json TEXT NOT NULL,
  risk_notes_json TEXT NOT NULL,
  app_prompt TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'planned',
  source TEXT NOT NULL DEFAULT 'studio',
  generated_app_id TEXT,
  generated_app_name TEXT,
  created_by_type TEXT,
  created_by_id TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_problem_blueprints_created_at
  ON problem_blueprints (created_at DESC);

CREATE INDEX IF NOT EXISTS idx_problem_blueprints_generated_app_id
  ON problem_blueprints (generated_app_id);
`,
  },
  {
    version: 8,
    name: "custom_apps",
    sql: `
CREATE TABLE IF NOT EXISTS custom_apps (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  description TEXT NOT NULL,
  visibility TEXT NOT NULL DEFAULT 'private',
  status TEXT NOT NULL DEFAULT 'active',
  source TEXT NOT NULL DEFAULT 'studio',
  problem_blueprint_id TEXT,
  code TEXT NOT NULL DEFAULT '',
  created_by_type TEXT,
  created_by_id TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  deleted_at INTEGER,
  FOREIGN KEY (problem_blueprint_id) REFERENCES problem_blueprints(id)
);

CREATE INDEX IF NOT EXISTS idx_custom_apps_updated_at
  ON custom_apps (updated_at DESC);

CREATE INDEX IF NOT EXISTS idx_custom_apps_problem_blueprint_id
  ON custom_apps (problem_blueprint_id);
`,
  },
  {
    version: 9,
    name: "custom_app_runtime",
    sql: `
CREATE TABLE IF NOT EXISTS custom_app_versions (
  id TEXT PRIMARY KEY,
  app_id TEXT NOT NULL,
  version INTEGER NOT NULL,
  code TEXT NOT NULL DEFAULT '',
  note TEXT,
  created_by_type TEXT,
  created_by_id TEXT,
  created_at INTEGER NOT NULL,
  FOREIGN KEY (app_id) REFERENCES custom_apps(id),
  UNIQUE (app_id, version)
);

CREATE INDEX IF NOT EXISTS idx_custom_app_versions_app_version
  ON custom_app_versions (app_id, version DESC);

CREATE TABLE IF NOT EXISTS custom_app_state (
  app_id TEXT PRIMARY KEY,
  state_json TEXT NOT NULL DEFAULT '{}',
  updated_by_type TEXT,
  updated_by_id TEXT,
  updated_at INTEGER NOT NULL,
  FOREIGN KEY (app_id) REFERENCES custom_apps(id)
);
`,
  },
  {
    version: 10,
    name: "custom_app_action_requests",
    sql: `
CREATE TABLE IF NOT EXISTS custom_app_action_requests (
  id TEXT PRIMARY KEY,
  app_id TEXT NOT NULL,
  action_type TEXT NOT NULL,
  label TEXT NOT NULL,
  target_url TEXT NOT NULL,
  target_scheme TEXT NOT NULL,
  params_summary TEXT NOT NULL DEFAULT '-',
  risk TEXT NOT NULL,
  status TEXT NOT NULL,
  reason TEXT,
  created_by_type TEXT,
  created_by_id TEXT,
  created_at INTEGER NOT NULL,
  decided_by_type TEXT,
  decided_by_id TEXT,
  decided_at INTEGER,
  decision_note TEXT,
  FOREIGN KEY (app_id) REFERENCES custom_apps(id)
);

CREATE INDEX IF NOT EXISTS idx_custom_app_action_requests_app_status
  ON custom_app_action_requests (app_id, status, created_at DESC);
`,
  },
  {
    version: 11,
    name: "custom_app_action_policies",
    sql: `
CREATE TABLE IF NOT EXISTS custom_app_action_policies (
  app_id TEXT PRIMARY KEY,
  template TEXT NOT NULL DEFAULT 'global',
  allowed_schemes_json TEXT NOT NULL,
  require_confirmation INTEGER NOT NULL DEFAULT 1,
  updated_by_type TEXT,
  updated_by_id TEXT,
  updated_at INTEGER NOT NULL,
  FOREIGN KEY (app_id) REFERENCES custom_apps(id) ON DELETE CASCADE
);
`,
  },
  {
    version: 12,
    name: "custom_app_capability_manifests",
    sql: `
CREATE TABLE IF NOT EXISTS custom_app_capability_manifests (
  app_id TEXT PRIMARY KEY,
  allowed_capabilities_json TEXT NOT NULL,
  declared_capabilities_json TEXT NOT NULL DEFAULT '[]',
  risk_level TEXT NOT NULL DEFAULT 'medium',
  updated_by_type TEXT,
  updated_by_id TEXT,
  updated_at INTEGER NOT NULL,
  FOREIGN KEY (app_id) REFERENCES custom_apps(id) ON DELETE CASCADE
);
`,
  },
  {
    version: 13,
    name: "custom_app_capability_requests",
    sql: `
CREATE TABLE IF NOT EXISTS custom_app_capability_requests (
  id TEXT PRIMARY KEY,
  app_id TEXT NOT NULL,
  requested_capabilities_json TEXT NOT NULL,
  missing_capabilities_json TEXT NOT NULL DEFAULT '[]',
  label TEXT NOT NULL,
  reason TEXT,
  risk TEXT NOT NULL,
  status TEXT NOT NULL,
  created_by_type TEXT,
  created_by_id TEXT,
  created_at INTEGER NOT NULL,
  decided_by_type TEXT,
  decided_by_id TEXT,
  decided_at INTEGER,
  decision_note TEXT,
  FOREIGN KEY (app_id) REFERENCES custom_apps(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_custom_app_capability_requests_app_status
  ON custom_app_capability_requests (app_id, status, created_at DESC);
`,
  },
  {
    version: 14,
    name: "custom_app_runtime_events",
    sql: `
CREATE TABLE IF NOT EXISTS custom_app_runtime_events (
  id TEXT PRIMARY KEY,
  app_id TEXT NOT NULL,
  event_type TEXT NOT NULL,
  severity TEXT NOT NULL,
  label TEXT NOT NULL,
  message TEXT NOT NULL,
  detail_json TEXT NOT NULL DEFAULT '{}',
  created_by_type TEXT,
  created_by_id TEXT,
  created_at INTEGER NOT NULL,
  FOREIGN KEY (app_id) REFERENCES custom_apps(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_custom_app_runtime_events_app_created
  ON custom_app_runtime_events (app_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_custom_app_runtime_events_app_severity
  ON custom_app_runtime_events (app_id, severity, created_at DESC);
`,
  },
  {
    version: 15,
    name: "message_offline_sync_identity",
    sql: `
ALTER TABLE messages ADD COLUMN offline_mutation_id TEXT;
ALTER TABLE messages ADD COLUMN idempotency_key TEXT;
ALTER TABLE messages ADD COLUMN client_sequence INTEGER;
ALTER TABLE messages ADD COLUMN source_version INTEGER;
ALTER TABLE messages ADD COLUMN queued_at INTEGER;

CREATE UNIQUE INDEX IF NOT EXISTS idx_messages_session_idempotency_key
  ON messages (session_id, idempotency_key)
  WHERE idempotency_key IS NOT NULL;
`,
  },
  {
    version: 16,
    name: "calendar_sync_operations",
    sql: `
CREATE TABLE IF NOT EXISTS calendar_sync_operations (
  id TEXT PRIMARY KEY,
  provider_id TEXT NOT NULL,
  kind TEXT NOT NULL,
  action TEXT NOT NULL,
  title TEXT NOT NULL,
  external_id TEXT,
  status TEXT NOT NULL,
  connector TEXT NOT NULL,
  source TEXT,
  rollback_plan_json TEXT NOT NULL,
  result_json TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  rolled_back_at INTEGER,
  rollback_result_json TEXT,
  rollback_error TEXT
);

CREATE INDEX IF NOT EXISTS idx_calendar_sync_operations_created_at
  ON calendar_sync_operations (created_at DESC);

CREATE INDEX IF NOT EXISTS idx_calendar_sync_operations_provider_external
  ON calendar_sync_operations (provider_id, kind, external_id);
`,
  },
  {
    version: 17,
    name: "calendar_sync_runs",
    sql: `
CREATE TABLE IF NOT EXISTS calendar_sync_runs (
  id TEXT PRIMARY KEY,
  provider TEXT NOT NULL,
  mode TEXT NOT NULL,
  status TEXT NOT NULL,
  started_at INTEGER NOT NULL,
  finished_at INTEGER,
  summary_json TEXT NOT NULL,
  conflicts_json TEXT NOT NULL,
  next_steps_json TEXT NOT NULL,
  created_by_type TEXT,
  created_by_id TEXT
);

CREATE INDEX IF NOT EXISTS idx_calendar_sync_runs_started_at
  ON calendar_sync_runs (started_at DESC);

CREATE INDEX IF NOT EXISTS idx_calendar_sync_runs_provider_status
  ON calendar_sync_runs (provider, status);
`,
  },
  {
    version: 18,
    name: "device_icloud_handoff_events",
    sql: `
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
`,
  },
  {
    version: 19,
    name: "cloudkit_sync_checkpoints",
    sql: `
CREATE TABLE IF NOT EXISTS cloudkit_sync_checkpoints (
  zone TEXT PRIMARY KEY,
  applied_server_change_token TEXT,
  pending_server_change_token TEXT,
  token_state TEXT NOT NULL DEFAULT 'none',
  last_evidence_id TEXT,
  last_preview_at INTEGER,
  last_applied_at INTEGER,
  changed_count INTEGER NOT NULL DEFAULT 0,
  deleted_count INTEGER NOT NULL DEFAULT 0,
  failed_count INTEGER NOT NULL DEFAULT 0,
  more_coming INTEGER NOT NULL DEFAULT 0,
  updated_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_cloudkit_sync_checkpoints_updated_at
  ON cloudkit_sync_checkpoints (updated_at DESC);
`,
  },
];

function parseMigration(migrationDir: string, file: string): Migration | null {
  const match = file.match(/^(\d+)_(.+)\.sql$/);
  if (!match) return null;
  return {
    version: Number(match[1]),
    name: match[2],
    sql: fs.readFileSync(path.join(migrationDir, file), "utf8"),
  };
}

function loadFileMigrations() {
  const migrationDir = path.join(process.cwd(), "server", "migrations");
  if (!fs.existsSync(migrationDir)) return [];
  return fs
    .readdirSync(migrationDir)
    .map((file) => parseMigration(migrationDir, file))
    .filter((migration): migration is Migration => Boolean(migration));
}

export function runMigrations() {
  const fileMigrations = loadFileMigrations();
  const migrations = (fileMigrations.length ? fileMigrations : fallbackMigrations).sort((a, b) => a.version - b.version);

  for (const migration of migrations) {
    applyMigration(migration.version, migration.name, migration.sql);
  }
}
