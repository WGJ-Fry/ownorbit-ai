import { DatabaseSync } from "node:sqlite";
import fs from "fs";
import path from "path";
import { createDatabaseBackup, db, getBackupPath, getPendingRestore, listBackups } from "./db";
import { getDevices } from "./devices";
import { getMemories } from "./memories";
import { listAuditLogs, redactAuditMetadata } from "./audit";

const previewTables = [
  "devices",
  "chat_sessions",
  "messages",
  "memories",
  "audit_logs",
  "client_state",
  "custom_apps",
  "custom_app_versions",
  "custom_app_state",
  "app_secrets",
  "schema_migrations",
];
const exportScopeKeys = ["chat", "memories", "devices", "auditLogs", "customApps"] as const;
const sensitiveBackupClientStateKey = /api[-_]?key|byok[-_]?key|token|password|passphrase|secret|authorization|cookie|private/i;
let cachedPackageVersion: string | null = null;

export type DataExportScope = typeof exportScopeKeys[number];

function publicBackupRecord(backup: ReturnType<typeof listBackups>[number]) {
  return {
    file: backup.file,
    size: backup.size,
    createdAt: backup.createdAt,
  };
}

function countRows(database: DatabaseSync, table: string) {
  try {
    return (database.prepare(`SELECT COUNT(*) as count FROM ${table}`).get() as any)?.count || 0;
  } catch {
    return null;
  }
}

const sensitiveExportKey = /api[-_]?key|token|password|passphrase|secret|authorization|cookie|hash|ciphertext|auth[-_]?tag|private|path/i;
const sensitiveShortExportKey = /(^|[-_])iv([-_]|$)/i;

function isSensitiveExportKey(key: string) {
  return sensitiveExportKey.test(key) || sensitiveShortExportKey.test(key);
}

export function redactDataExportValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(redactDataExportValue);
  if (typeof value === "string") return redactAuditMetadata(value);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(Object.entries(value as Record<string, unknown>).map(([key, item]) => {
    if (isSensitiveExportKey(key)) return [key, "[redacted]"];
    return [key, redactDataExportValue(item)];
  }));
}

export function previewBackup(file: string) {
  const backupPath = getBackupPath(file);
  if (!backupPath) throw new Error("Backup file not found");
  const backup = listBackups().find((item) => item.file === file);
  const backupDb = new DatabaseSync(backupPath);
  try {
    const tables = Object.fromEntries(previewTables.map((table) => [table, countRows(backupDb, table)]));
    const migrations = backupDb.prepare("SELECT version, name, applied_at as appliedAt FROM schema_migrations ORDER BY version ASC").all();
    const sensitiveClientStateRows = backupDb
      .prepare("SELECT key FROM client_state")
      .all()
      .filter((row: any) => sensitiveBackupClientStateKey.test(String(row.key || ""))).length;
    return {
      backup: backup ? publicBackupRecord(backup) : { file, size: 0, createdAt: 0 },
      tables,
      migrations,
      sensitiveData: {
        appSecretsRows: Number(tables.app_secrets || 0),
        sensitiveClientStateRows,
        ordinaryBackupExcludesSecrets: Number(tables.app_secrets || 0) === 0 && sensitiveClientStateRows === 0,
      },
      warnings: [
        "Restore will replace the current SQLite database before the next startup.",
        "The system will automatically create a backup of the current database before restore.",
        "Ordinary backups do not include AI Keys or sensitive client state. Reconfigure keys in Settings after restore if AI features are needed.",
      ],
    };
  } finally {
    backupDb.close();
  }
}

export function normalizeDataExportScope(input: unknown): DataExportScope[] {
  if (!input) return [...exportScopeKeys];
  const values = String(input)
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
  if (!values.length) return [...exportScopeKeys];
  const invalid = values.find((item) => !exportScopeKeys.includes(item as DataExportScope));
  if (invalid) throw new Error(`Unsupported export scope: ${invalid}`);
  return Array.from(new Set(values)) as DataExportScope[];
}

export function getDataExportVersion() {
  if (cachedPackageVersion) return cachedPackageVersion;
  try {
    const packageJson = JSON.parse(fs.readFileSync(path.join(process.cwd(), "package.json"), "utf8"));
    cachedPackageVersion = typeof packageJson.version === "string" && packageJson.version.trim()
      ? packageJson.version.trim()
      : "0.0.0-unknown";
  } catch {
    cachedPackageVersion = "0.0.0-unknown";
  }
  return cachedPackageVersion;
}

export function createDataExport(scopes: DataExportScope[] = [...exportScopeKeys]) {
  const selectedScopes = new Set(scopes);
  const exportData: Record<string, unknown> = {
    exportedAt: new Date().toISOString(),
    version: getDataExportVersion(),
    scopes,
  };

  if (selectedScopes.has("chat")) {
    const sessions = db.prepare("SELECT id, title, created_at as createdAt, updated_at as updatedAt FROM chat_sessions ORDER BY updated_at DESC").all() as any[];
    const messages = db.prepare(`
      SELECT id, session_id as sessionId, role, content_json as contentJson, source_device_id as sourceDeviceId, created_at as createdAt
      FROM messages ORDER BY created_at ASC
    `).all().map((row: any) => ({
      ...row,
      contentJson: JSON.parse(row.contentJson),
    }));
    exportData.chat = {
      sessions,
      messages,
    };
  }

  if (selectedScopes.has("memories")) {
    exportData.memories = getMemories(true);
  }

  if (selectedScopes.has("devices")) {
    exportData.devices = getDevices(true).map((device) => ({
      id: device.id,
      name: device.name,
      type: device.type,
      status: device.status,
      createdAt: device.createdAt,
      lastSeenAt: device.lastSeenAt,
      revokedAt: device.revokedAt,
    }));
  }

  if (selectedScopes.has("auditLogs")) {
    exportData.auditLogs = listAuditLogs(1000).map((log) => ({
      id: log.id,
      actorType: log.actorType,
      action: log.action,
      targetType: log.targetType,
      targetId: log.targetId,
      metadata: redactDataExportValue(log.metadata),
      createdAt: log.createdAt,
    }));
  }

  if (selectedScopes.has("customApps")) {
    const apps = db.prepare(`
      SELECT id, name, description, visibility, status, source, problem_blueprint_id as problemBlueprintId,
             code, created_at as createdAt, updated_at as updatedAt, deleted_at as deletedAt
      FROM custom_apps ORDER BY updated_at DESC, created_at DESC
    `).all();
    const versions = db.prepare(`
      SELECT id, app_id as appId, version, code, note, created_at as createdAt
      FROM custom_app_versions ORDER BY app_id ASC, version ASC
    `).all();
    const state = db.prepare(`
      SELECT app_id as appId, state_json as stateJson, updated_at as updatedAt
      FROM custom_app_state ORDER BY updated_at DESC
    `).all().map((row: any) => {
      let parsedState: unknown = {};
      try {
        parsedState = JSON.parse(row.stateJson || "{}");
      } catch {
        parsedState = {};
      }
      return {
        appId: row.appId,
        state: redactDataExportValue(parsedState),
        updatedAt: row.updatedAt,
      };
    });
    exportData.customApps = {
      apps: redactDataExportValue(apps),
      versions: redactDataExportValue(versions),
      state,
    };
  }

  return exportData;
}

export function summarizeDataExport(exportData: Record<string, unknown>) {
  const chat = exportData.chat as { sessions?: unknown[]; messages?: unknown[] } | undefined;
  const memories = Array.isArray(exportData.memories) ? exportData.memories : [];
  const devices = Array.isArray(exportData.devices) ? exportData.devices : [];
  const auditLogs = Array.isArray(exportData.auditLogs) ? exportData.auditLogs : [];
  const customApps = exportData.customApps as { apps?: unknown[]; versions?: unknown[]; state?: unknown[] } | undefined;
  const scopes = Array.isArray(exportData.scopes) ? exportData.scopes.map((scope) => String(scope)) : [];
  return {
    scopes,
    scopeCount: scopes.length,
    includesAuditLogs: scopes.includes("auditLogs"),
    redacted: true,
    redactionPolicy: "sensitive keys, tokens, credentials, URLs, and local paths are redacted before export",
    counts: {
      chatSessions: Array.isArray(chat?.sessions) ? chat.sessions.length : 0,
      messages: Array.isArray(chat?.messages) ? chat.messages.length : 0,
      memories: memories.length,
      devices: devices.length,
      auditLogs: auditLogs.length,
      customApps: Array.isArray(customApps?.apps) ? customApps.apps.length : 0,
      customAppVersions: Array.isArray(customApps?.versions) ? customApps.versions.length : 0,
      customAppStates: Array.isArray(customApps?.state) ? customApps.state.length : 0,
    },
  };
}

export function previewDataCleanup(options: { auditOlderThanDays?: number; chatOlderThanDays?: number; backupKeepCount?: number }) {
  const now = Date.now();
  const result = {
    auditLogsDeleted: 0,
    chatSessionsDeleted: 0,
    messagesDeleted: 0,
    backupsDeleted: 0,
  };

  if (Number.isFinite(options.auditOlderThanDays) && Number(options.auditOlderThanDays) > 0) {
    const cutoff = now - Number(options.auditOlderThanDays) * 24 * 60 * 60 * 1000;
    result.auditLogsDeleted = (db.prepare("SELECT COUNT(*) as count FROM audit_logs WHERE created_at < ?").get(cutoff) as any)?.count || 0;
  }

  if (Number.isFinite(options.chatOlderThanDays) && Number(options.chatOlderThanDays) > 0) {
    const cutoff = now - Number(options.chatOlderThanDays) * 24 * 60 * 60 * 1000;
    const sessionRows = db.prepare("SELECT id FROM chat_sessions WHERE updated_at < ?").all(cutoff) as Array<{ id: string }>;
    const sessionIds = sessionRows.map((session) => session.id);
    result.chatSessionsDeleted = sessionIds.length;
    if (sessionIds.length > 0) {
      const countMessages = db.prepare("SELECT COUNT(*) as count FROM messages WHERE session_id = ?");
      for (const id of sessionIds) {
        result.messagesDeleted += (countMessages.get(id) as any)?.count || 0;
      }
    }
  }

  if (Number.isFinite(options.backupKeepCount) && Number(options.backupKeepCount) > 0) {
    result.backupsDeleted = backupsToPrune(Number(options.backupKeepCount)).length;
  }

  return result;
}

export function cleanupData(options: { auditOlderThanDays?: number; chatOlderThanDays?: number; backupKeepCount?: number }) {
  const preview = previewDataCleanup(options);
  const now = Date.now();
  const protectionBackup = createDatabaseBackup();

  if (Number.isFinite(options.auditOlderThanDays) && Number(options.auditOlderThanDays) > 0) {
    const cutoff = now - Number(options.auditOlderThanDays) * 24 * 60 * 60 * 1000;
    db.prepare("DELETE FROM audit_logs WHERE created_at < ?").run(cutoff);
  }

  if (Number.isFinite(options.chatOlderThanDays) && Number(options.chatOlderThanDays) > 0) {
    const cutoff = now - Number(options.chatOlderThanDays) * 24 * 60 * 60 * 1000;
    const sessionRows = db.prepare("SELECT id FROM chat_sessions WHERE updated_at < ?").all(cutoff) as Array<{ id: string }>;
    const sessionIds = sessionRows.map((session) => session.id);
    if (sessionIds.length > 0) {
      const deleteMessages = db.prepare("DELETE FROM messages WHERE session_id = ?");
      const deleteSession = db.prepare("DELETE FROM chat_sessions WHERE id = ?");
      db.exec("BEGIN");
      try {
        for (const id of sessionIds) {
          deleteMessages.run(id);
          deleteSession.run(id);
        }
        db.exec("COMMIT");
      } catch (error) {
        db.exec("ROLLBACK");
        throw error;
      }
    }
  }

  if (Number.isFinite(options.backupKeepCount) && Number(options.backupKeepCount) > 0) {
    pruneBackupsToCount(Number(options.backupKeepCount));
  }

  return {
    ...preview,
    protectionBackup: publicBackupRecord(protectionBackup),
    ordinaryBackupExcludesSecrets: true,
  };
}

function backupsToPrune(keepCount: number) {
  const backups = listBackups();
  if (backups.length <= keepCount) return [];
  const pendingRestore = getPendingRestore();
  const protectedFiles = new Set([
    ...backups.slice(0, keepCount).map((backup) => backup.file),
    pendingRestore?.restoredFrom,
    pendingRestore?.preRestoreBackup?.file,
  ].filter(Boolean));
  return backups.filter((backup) => !protectedFiles.has(backup.file));
}

function pruneBackupsToCount(keepCount: number) {
  const backupsToDelete = backupsToPrune(keepCount);
  for (const backup of backupsToDelete) {
    fs.rmSync(backup.path, { force: true });
  }
  return backupsToDelete;
}
