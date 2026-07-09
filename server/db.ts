import fs from "fs";
import path from "path";
import { DatabaseSync } from "node:sqlite";

export const dataDir = process.env.LIFEOS_DATA_DIR || path.join(process.cwd(), "data");
export const storePath = path.join(dataDir, "lifeos-store.json");
export const dbPath = path.join(dataDir, "lifeos.db");
export const backupDir = path.join(dataDir, "backups");
const pendingRestorePath = path.join(dataDir, "restore-pending.db");
const pendingRestoreMetaPath = path.join(dataDir, "restore-pending.json");
const defaultBackupRetentionCount = 20;
const sensitiveClientStateKey = /api[-_]?key|byok[-_]?key|token|password|passphrase|secret|authorization|cookie|private/i;

function getBackupRetentionCount() {
  const rawValue = process.env.LIFEOS_BACKUP_RETENTION_COUNT;
  if (rawValue === undefined || rawValue === "") return defaultBackupRetentionCount;
  const parsed = Number.parseInt(rawValue, 10);
  if (!Number.isFinite(parsed) || parsed < 0) return defaultBackupRetentionCount;
  return parsed;
}

if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });
if (!fs.existsSync(backupDir)) fs.mkdirSync(backupDir, { recursive: true });

function removeSqliteSidecars() {
  for (const suffix of ["-wal", "-shm", "-journal"]) {
    const sidecar = `${dbPath}${suffix}`;
    if (fs.existsSync(sidecar)) fs.rmSync(sidecar, { force: true });
  }
}

function applyPendingRestoreBeforeOpen() {
  if (!fs.existsSync(pendingRestorePath)) return;
  removeSqliteSidecars();
  fs.copyFileSync(pendingRestorePath, dbPath);
  fs.rmSync(pendingRestorePath, { force: true });
  fs.rmSync(pendingRestoreMetaPath, { force: true });
}

applyPendingRestoreBeforeOpen();

export const db = new DatabaseSync(dbPath);

db.exec(`
  PRAGMA journal_mode = WAL;
  PRAGMA foreign_keys = ON;

  CREATE TABLE IF NOT EXISTS devices (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    type TEXT NOT NULL,
    status TEXT NOT NULL,
    public_key TEXT,
    access_token_hash TEXT NOT NULL,
    access_token_expires_at INTEGER,
    created_at INTEGER NOT NULL,
    last_seen_at INTEGER NOT NULL,
    revoked_at INTEGER
  );

  CREATE TABLE IF NOT EXISTS binding_sessions (
    id TEXT PRIMARY KEY,
    token_hash TEXT NOT NULL UNIQUE,
    base_url TEXT,
    created_at INTEGER NOT NULL,
    expires_at INTEGER NOT NULL,
    confirmed_at INTEGER,
    confirmed_device_id TEXT,
    FOREIGN KEY (confirmed_device_id) REFERENCES devices(id)
  );

  CREATE TABLE IF NOT EXISTS device_connectivity_reports (
    id TEXT PRIMARY KEY,
    device_id TEXT NOT NULL,
    ok INTEGER NOT NULL,
    current_base_url TEXT NOT NULL,
    health_ok INTEGER NOT NULL,
    mobile_shell_ok INTEGER NOT NULL DEFAULT 0,
    websocket_ok INTEGER NOT NULL,
    latency_ms INTEGER NOT NULL,
    error TEXT,
    created_at INTEGER NOT NULL,
    FOREIGN KEY (device_id) REFERENCES devices(id)
  );

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

  CREATE TABLE IF NOT EXISTS cloudkit_sync_quarantine (
    id TEXT PRIMARY KEY,
    zone TEXT NOT NULL,
    record_type TEXT NOT NULL,
    record_name TEXT NOT NULL,
    change_type TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'pending-review',
    mutation_id TEXT,
    content_hash TEXT,
    payload_hash TEXT,
    logical_clock INTEGER,
    payload_byte_size INTEGER NOT NULL DEFAULT 0,
    requires_user_review INTEGER NOT NULL DEFAULT 1,
    payload_json TEXT,
    server_modified_at TEXT,
    deleted_at TEXT,
    source_evidence_id TEXT,
    imported_at INTEGER NOT NULL,
    applied_at INTEGER,
    error TEXT,
    UNIQUE (zone, record_type, record_name, change_type, content_hash)
  );

  CREATE INDEX IF NOT EXISTS idx_cloudkit_sync_quarantine_status_imported
    ON cloudkit_sync_quarantine (status, imported_at DESC);

  CREATE INDEX IF NOT EXISTS idx_cloudkit_sync_quarantine_record
    ON cloudkit_sync_quarantine (zone, record_type, record_name);

  CREATE TABLE IF NOT EXISTS cloudkit_device_trust_metadata (
    device_id_hash TEXT PRIMARY KEY,
    display_name TEXT NOT NULL,
    device_type TEXT NOT NULL,
    trust_state TEXT NOT NULL,
    public_key_fingerprint TEXT,
    access_expires_at INTEGER,
    created_at INTEGER,
    last_seen_at INTEGER,
    revoked_at INTEGER,
    mutation_id TEXT,
    logical_clock INTEGER NOT NULL DEFAULT 0,
    source_record_name TEXT NOT NULL,
    source_evidence_id TEXT,
    review_status TEXT NOT NULL DEFAULT 'needs-rebind',
    access_granted INTEGER NOT NULL DEFAULT 0,
    imported_at INTEGER NOT NULL,
    applied_at INTEGER NOT NULL
  );

  CREATE INDEX IF NOT EXISTS idx_cloudkit_device_trust_metadata_review
    ON cloudkit_device_trust_metadata (review_status, applied_at DESC);

  CREATE TABLE IF NOT EXISTS chat_sessions (
    id TEXT PRIMARY KEY,
    title TEXT NOT NULL,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS messages (
    id TEXT PRIMARY KEY,
    session_id TEXT NOT NULL,
    role TEXT NOT NULL,
    content_json TEXT NOT NULL,
    source_device_id TEXT,
    offline_mutation_id TEXT,
    idempotency_key TEXT,
    client_sequence INTEGER,
    source_version INTEGER,
    queued_at INTEGER,
    created_at INTEGER NOT NULL,
    FOREIGN KEY (session_id) REFERENCES chat_sessions(id)
  );

  CREATE TABLE IF NOT EXISTS memories (
    id TEXT PRIMARY KEY,
    title TEXT NOT NULL,
    content TEXT NOT NULL,
    sensitivity TEXT NOT NULL DEFAULT 'normal',
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL,
    deleted_at INTEGER
  );

  CREATE TABLE IF NOT EXISTS tasks (
    id TEXT PRIMARY KEY,
    type TEXT NOT NULL,
    status TEXT NOT NULL,
    input_json TEXT NOT NULL,
    result_json TEXT,
    error TEXT,
    created_by_device_id TEXT,
    created_at INTEGER NOT NULL,
    started_at INTEGER,
    finished_at INTEGER
  );

  CREATE TABLE IF NOT EXISTS audit_logs (
    id TEXT PRIMARY KEY,
    actor_type TEXT NOT NULL,
    actor_id TEXT,
    action TEXT NOT NULL,
    target_type TEXT,
    target_id TEXT,
    metadata_json TEXT,
    created_at INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS admin_credentials (
    id TEXT PRIMARY KEY,
    password_hash TEXT NOT NULL,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS admin_sessions (
    id TEXT PRIMARY KEY,
    token_hash TEXT NOT NULL UNIQUE,
    created_at INTEGER NOT NULL,
    expires_at INTEGER NOT NULL,
    last_seen_at INTEGER NOT NULL,
    revoked_at INTEGER
  );

  CREATE TABLE IF NOT EXISTS client_state (
    key TEXT PRIMARY KEY,
    value_json TEXT NOT NULL,
    updated_at INTEGER NOT NULL,
    updated_by_type TEXT,
    updated_by_id TEXT
  );

  CREATE TABLE IF NOT EXISTS app_secrets (
    id TEXT PRIMARY KEY,
    provider TEXT NOT NULL,
    secret_storage TEXT NOT NULL DEFAULT 'local_aes_gcm',
    ciphertext TEXT NOT NULL,
    iv TEXT NOT NULL,
    auth_tag TEXT NOT NULL,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS schema_migrations (
    version INTEGER PRIMARY KEY,
    name TEXT NOT NULL,
    applied_at INTEGER NOT NULL
  );
`);

function tableColumns(tableName: string) {
  return new Set(db.prepare(`PRAGMA table_info(${tableName})`).all().map((column) => String(column.name)));
}

function ensureMessageOfflineSyncSchema() {
  const columns = tableColumns("messages");
  const additions = [
    ["offline_mutation_id", "TEXT"],
    ["idempotency_key", "TEXT"],
    ["client_sequence", "INTEGER"],
    ["source_version", "INTEGER"],
    ["queued_at", "INTEGER"],
  ] as const;

  for (const [name, type] of additions) {
    if (!columns.has(name)) db.exec(`ALTER TABLE messages ADD COLUMN ${name} ${type}`);
  }

  const updatedColumns = tableColumns("messages");
  if (updatedColumns.has("session_id") && updatedColumns.has("idempotency_key")) {
    db.exec(`
      CREATE UNIQUE INDEX IF NOT EXISTS idx_messages_session_idempotency_key
        ON messages (session_id, idempotency_key)
        WHERE idempotency_key IS NOT NULL
    `);
  }
}

ensureMessageOfflineSyncSchema();

export function applyMigration(version: number, name: string, sql: string) {
  const existing = db.prepare("SELECT version FROM schema_migrations WHERE version = ?").get(version);
  if (existing) return false;
  db.exec("BEGIN");
  try {
    db.exec(sql);
    db.prepare("INSERT INTO schema_migrations (version, name, applied_at) VALUES (?, ?, ?)").run(version, name, Date.now());
    db.exec("COMMIT");
    return true;
  } catch (error) {
    if (error instanceof Error && /duplicate column name/i.test(error.message)) {
      db.prepare("INSERT INTO schema_migrations (version, name, applied_at) VALUES (?, ?, ?)").run(version, name, Date.now());
      db.exec("COMMIT");
      return false;
    }
    db.exec("ROLLBACK");
    throw error;
  }
}

export function listBackups() {
  return fs
    .readdirSync(backupDir)
    .filter((file) => file.endsWith(".db"))
    .map((file) => {
      const fullPath = path.join(backupDir, file);
      const stat = fs.statSync(fullPath);
      return { file, path: fullPath, size: stat.size, createdAt: stat.birthtimeMs || stat.mtimeMs };
    })
    .sort((a, b) => b.createdAt - a.createdAt);
}

export function pruneBackups(protectedFiles: string[] = []) {
  const retentionCount = getBackupRetentionCount();
  if (retentionCount === 0) return [];

  const protectedSet = new Set(protectedFiles.map((file) => path.basename(file)));
  const backups = listBackups();
  const protectedBackupCount = backups.filter((backup) => protectedSet.has(backup.file)).length;
  const removableRetentionCount = Math.max(retentionCount - protectedBackupCount, 0);
  const removableBackups = backups.filter((backup) => !protectedSet.has(backup.file));
  const backupsToRemove = removableBackups.slice(removableRetentionCount);

  for (const backup of backupsToRemove) {
    fs.rmSync(backup.path, { force: true });
  }

  return backupsToRemove;
}

export function getBackupPath(file: string) {
  const safeFile = path.basename(file);
  const fullPath = path.join(backupDir, safeFile);
  if (!safeFile.endsWith(".db") || !fs.existsSync(fullPath)) return null;
  return fullPath;
}

function createBackupFileName() {
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  let file = `lifeos-${stamp}.db`;
  let targetPath = path.join(backupDir, file);
  let suffix = 1;
  while (fs.existsSync(targetPath)) {
    file = `lifeos-${stamp}-${suffix}.db`;
    targetPath = path.join(backupDir, file);
    suffix += 1;
  }
  return { file, targetPath };
}

function sanitizeBackupFile(targetPath: string) {
  let backupDb: DatabaseSync | null = null;
  const summary = {
    appSecretsDeleted: 0,
    sensitiveClientStateDeleted: 0,
    adminSessionsDeleted: 0,
  };
  try {
    backupDb = new DatabaseSync(targetPath);
    backupDb.exec("BEGIN");
    summary.appSecretsDeleted = (backupDb.prepare("DELETE FROM app_secrets").run() as any)?.changes || 0;
    const sensitiveClientStateKeys = backupDb
      .prepare("SELECT key FROM client_state")
      .all()
      .map((row: any) => String(row.key || ""))
      .filter((key) => sensitiveClientStateKey.test(key));
    for (const key of sensitiveClientStateKeys) {
      summary.sensitiveClientStateDeleted += (backupDb.prepare("DELETE FROM client_state WHERE key = ?").run(key) as any)?.changes || 0;
    }
    summary.adminSessionsDeleted = (backupDb.prepare("DELETE FROM admin_sessions").run() as any)?.changes || 0;
    backupDb.exec("COMMIT");
    backupDb.exec("VACUUM");
    return summary;
  } catch (error) {
    try {
      backupDb?.exec("ROLLBACK");
    } catch {}
    throw error;
  } finally {
    backupDb?.close();
  }
}

export function createDatabaseBackup(options: { prune?: boolean; protectedFiles?: string[] } = {}) {
  db.exec("PRAGMA wal_checkpoint(TRUNCATE)");
  const { file, targetPath } = createBackupFileName();
  fs.copyFileSync(dbPath, targetPath);
  const redaction = sanitizeBackupFile(targetPath);
  const stat = fs.statSync(targetPath);
  if (options.prune !== false) {
    pruneBackups([file, ...(options.protectedFiles || [])]);
  }
  return { file, path: targetPath, size: stat.size, createdAt: stat.birthtimeMs || stat.mtimeMs, redaction };
}

export function importDatabaseBackup(buffer: Buffer, sourceLabel = "imported") {
  if (!buffer.subarray(0, 16).equals(Buffer.from("SQLite format 3\0"))) {
    throw new Error("Imported backup is not a SQLite database");
  }

  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const safeLabel = sourceLabel.replace(/[^a-z0-9-]/gi, "-").replace(/-+/g, "-").slice(0, 32) || "imported";
  let file = `lifeos-${safeLabel}-${stamp}.db`;
  let targetPath = path.join(backupDir, file);
  let suffix = 1;
  while (fs.existsSync(targetPath)) {
    file = `lifeos-${safeLabel}-${stamp}-${suffix}.db`;
    targetPath = path.join(backupDir, file);
    suffix += 1;
  }

  fs.writeFileSync(targetPath, buffer, { mode: 0o600 });
  let importedDb: DatabaseSync | null = null;
  try {
    importedDb = new DatabaseSync(targetPath);
    const integrity = (importedDb.prepare("PRAGMA integrity_check").get() as any)?.integrity_check;
    if (integrity !== "ok") throw new Error("Imported SQLite integrity check failed");
  } catch (error) {
    fs.rmSync(targetPath, { force: true });
    throw error;
  } finally {
    importedDb?.close();
  }

  const stat = fs.statSync(targetPath);
  pruneBackups([file]);
  return { file, path: targetPath, size: stat.size, createdAt: stat.birthtimeMs || stat.mtimeMs };
}

export function scheduleDatabaseRestore(file: string) {
  const safeFile = path.basename(file);
  const sourcePath = getBackupPath(safeFile);
  if (!sourcePath) {
    throw new Error("Backup file not found");
  }
  db.exec("PRAGMA wal_checkpoint(TRUNCATE)");
  const preRestore = createDatabaseBackup({ prune: false });
  fs.copyFileSync(sourcePath, pendingRestorePath);
  pruneBackups([safeFile, preRestore.file]);
  const restore = {
    restoredFrom: safeFile,
    preRestoreBackup: preRestore,
    scheduledAt: Date.now(),
    scheduledForNextStart: true,
    restartRequired: true,
  };
  fs.writeFileSync(pendingRestoreMetaPath, JSON.stringify(restore, null, 2));
  return restore;
}

export function getPendingRestore() {
  if (!fs.existsSync(pendingRestoreMetaPath)) return null;
  try {
    return JSON.parse(fs.readFileSync(pendingRestoreMetaPath, "utf8"));
  } catch {
    return null;
  }
}

export function cancelPendingRestore() {
  const pendingRestore = getPendingRestore();
  fs.rmSync(pendingRestorePath, { force: true });
  fs.rmSync(pendingRestoreMetaPath, { force: true });
  return pendingRestore;
}
