import type express from "express";
import { insertAuditLog } from "../audit";
import { cleanupData, createDataExport, normalizeDataExportScope, previewBackup, previewDataCleanup, summarizeDataExport } from "../dataLifecycle";
import { cancelPendingRestore, createDatabaseBackup, getBackupPath, getPendingRestore, listBackups, scheduleDatabaseRestore } from "../db";
import { requireAdmin } from "../auth";
import { getBackupSchedule, updateBackupSchedule } from "../backupSchedule";
import { encryptBackupFile, importEncryptedBackup } from "../encryptedBackups";

function publicBackupRecord(backup: ReturnType<typeof listBackups>[number]) {
  return {
    file: backup.file,
    size: backup.size,
    createdAt: backup.createdAt,
    redaction: (backup as any).redaction,
  };
}

function backupPreviewAuditSummary(preview: ReturnType<typeof previewBackup>) {
  return {
    file: preview.backup.file,
    size: preview.backup.size,
    createdAt: preview.backup.createdAt,
    tableCount: Object.keys(preview.tables).length,
    rowTotal: Object.values(preview.tables).reduce((total, count) => total + (Number.isFinite(Number(count)) ? Number(count) : 0), 0),
    migrationCount: preview.migrations.length,
    warningCount: preview.warnings.length,
  };
}

function safeOriginalFileStatus(value: unknown) {
  if (typeof value !== "string") return "missing";
  if (value.length > 180) return "too_long";
  if (/[\\/]/.test(value)) return "unsafe_path";
  return "present";
}

function encryptedImportFailureReason(error: any) {
  const message = String(error?.message || "");
  if (/passphrase/i.test(message)) return "invalid_passphrase";
  if (/could not be decrypted/i.test(message)) return "decrypt_failed";
  if (/parameters|kdf/i.test(message)) return "unsupported_parameters";
  if (/invalid encrypted backup/i.test(message)) return "malformed_payload";
  if (/unsupported encrypted backup file/i.test(message)) return "unsupported_file";
  return "import_failed";
}

function encryptedImportFailureAuditMetadata(body: any, error: any) {
  const payload = body?.payload && typeof body.payload === "object" ? body.payload : null;
  const encryptedValue = payload && typeof payload.ciphertext === "string" ? payload.ciphertext : "";
  return {
    reason: encryptedImportFailureReason(error),
    payload: {
      shape: payload ? "object" : "missing",
      version: payload && typeof payload.version === "number" ? payload.version : null,
      originalFileStatus: safeOriginalFileStatus(payload?.originalFile),
      hasKdf: Boolean(payload?.kdf && typeof payload.kdf === "object"),
      hasCipher: Boolean(payload?.cipher && typeof payload.cipher === "object"),
      encryptedBytesEstimate: encryptedValue ? Buffer.byteLength(encryptedValue, "base64url") : 0,
    },
  };
}

function publicRestoreRecord(restore: ReturnType<typeof scheduleDatabaseRestore>) {
  if (!restore) return null;
  return {
    restoredFrom: restore.restoredFrom,
    preRestoreBackup: publicBackupRecord(restore.preRestoreBackup),
    scheduledAt: restore.scheduledAt,
    scheduledForNextStart: restore.scheduledForNextStart,
    restartRequired: restore.restartRequired,
  };
}

export function registerBackupRoutes(app: express.Express) {
  app.get("/api/v1/backups", requireAdmin, (_req, res) => {
    res.json({ backups: listBackups().map(publicBackupRecord) });
  });

  app.get("/api/v1/backups/schedule", requireAdmin, (_req, res) => {
    res.json({ schedule: getBackupSchedule() });
  });

  app.put("/api/v1/backups/schedule", requireAdmin, (req, res) => {
    const intervalHours = Number(req.body?.intervalHours);
    if (!Number.isFinite(intervalHours) || intervalHours < 1 || intervalHours > 720) {
      return res.status(400).json({ error: "intervalHours must be between 1 and 720" });
    }
    const schedule = updateBackupSchedule({
      enabled: Boolean(req.body?.enabled),
      intervalHours,
    }, (req as any).actor);
    res.json({ schedule });
  });

  app.get("/api/v1/backups/pending-restore", requireAdmin, (_req, res) => {
    res.json({ pendingRestore: publicRestoreRecord(getPendingRestore()) });
  });

  app.delete("/api/v1/backups/pending-restore", requireAdmin, (req, res) => {
    const restore = cancelPendingRestore();
    if (restore) {
      insertAuditLog("database_restore_cancelled", "database", restore.restoredFrom, {
        ...publicRestoreRecord(restore),
        cancelledAt: Date.now(),
        restartRequired: false,
      }, (req as any).actor?.type, (req as any).actor?.id);
    }
    res.json({ ok: true, cancelledRestore: publicRestoreRecord(restore) });
  });

  app.get("/api/v1/backups/:file/download", requireAdmin, (req, res) => {
    const backupPath = getBackupPath(req.params.file);
    if (!backupPath) return res.status(404).json({ error: "Backup file not found" });
    const backup = listBackups().find((item) => item.file === req.params.file);
    insertAuditLog("database_backup_downloaded", "database", req.params.file, {
      file: req.params.file,
      size: backup?.size || null,
      createdAt: backup?.createdAt || null,
      delivery: "download",
    }, (req as any).actor?.type, (req as any).actor?.id);
    res.download(backupPath, req.params.file);
  });

  app.post("/api/v1/backups/:file/encrypted-export", requireAdmin, (req, res) => {
    try {
      const payload = encryptBackupFile(req.params.file, req.body?.passphrase);
      const backup = listBackups().find((item) => item.file === req.params.file);
      insertAuditLog("encrypted_backup_exported", "database", req.params.file, {
        file: req.params.file,
        size: backup?.size || null,
        createdAt: backup?.createdAt || null,
        encryptedBytes: Buffer.byteLength(payload.ciphertext, "base64url"),
        encryption: {
          kdf: payload.kdf.name,
          kdfHash: payload.kdf.hash,
          iterations: payload.kdf.iterations,
          cipher: payload.cipher.name,
        },
      }, (req as any).actor?.type, (req as any).actor?.id);
      res.json({ payload });
    } catch (error: any) {
      res.status(400).json({ error: error.message || "Encrypted backup export failed" });
    }
  });

  app.post("/api/v1/backups/encrypted-import", requireAdmin, (req, res) => {
    try {
      const backup = importEncryptedBackup(req.body?.payload, req.body?.passphrase);
      const preview = previewBackup(backup.file);
      insertAuditLog("encrypted_backup_imported", "database", backup.file, {
        file: backup.file,
        size: backup.size,
        createdAt: backup.createdAt,
        preview: backupPreviewAuditSummary(preview),
      }, (req as any).actor?.type, (req as any).actor?.id);
      res.json({ backup: publicBackupRecord(backup), preview });
    } catch (error: any) {
      insertAuditLog("encrypted_backup_import_failed", "database", "encrypted-import", encryptedImportFailureAuditMetadata(req.body, error), (req as any).actor?.type, (req as any).actor?.id);
      res.status(400).json({ error: error.message || "Encrypted backup import failed" });
    }
  });

  app.get("/api/v1/backups/:file/preview", requireAdmin, (req, res) => {
    try {
      const preview = previewBackup(req.params.file);
      insertAuditLog("database_backup_previewed", "database", req.params.file, {
        ...backupPreviewAuditSummary(preview),
        tables: preview.tables,
      }, (req as any).actor?.type, (req as any).actor?.id);
      res.json({ preview });
    } catch (error: any) {
      res.status(404).json({ error: error.message || "Backup preview failed" });
    }
  });

  app.post("/api/v1/backups", requireAdmin, (req, res) => {
    const backup = createDatabaseBackup();
    insertAuditLog("database_backup_created", "database", backup.file, {
      file: backup.file,
      size: backup.size,
      createdAt: backup.createdAt,
      redaction: backup.redaction,
      ordinaryBackupExcludesSecrets: true,
    }, (req as any).actor?.type, (req as any).actor?.id);
    res.json({ backup: publicBackupRecord(backup) });
  });

  app.post("/api/v1/backups/:file/restore", requireAdmin, (req, res) => {
    try {
      const restore = scheduleDatabaseRestore(req.params.file);
      insertAuditLog("database_restore_scheduled", "database", req.params.file, {
        ...publicRestoreRecord(restore),
        restartRequired: restore.restartRequired,
        scheduledAt: Date.now(),
      }, (req as any).actor?.type, (req as any).actor?.id);
      res.json({ restore: publicRestoreRecord(restore) });
    } catch (error: any) {
      res.status(400).json({ error: error.message || "Restore failed" });
    }
  });

  app.get("/api/v1/data/export", requireAdmin, (req, res) => {
    let scopes;
    try {
      scopes = normalizeDataExportScope(req.query.scope);
    } catch (error: any) {
      return res.status(400).json({ error: error.message || "Unsupported export scope" });
    }
    const stamp = new Date().toISOString().replace(/[:.]/g, "-");
    const exportData = createDataExport(scopes);
    insertAuditLog("data_export_created", "database", "lifeos-data-export", {
      ...summarizeDataExport(exportData),
      delivery: "download",
      fileName: `lifeos-data-export-${stamp}.json`,
    }, (req as any).actor?.type, (req as any).actor?.id);
    res.setHeader("Content-Type", "application/json; charset=utf-8");
    res.setHeader("Content-Disposition", `attachment; filename="lifeos-data-export-${stamp}.json"`);
    res.json(exportData);
  });

  app.post("/api/v1/data/cleanup", requireAdmin, (req, res) => {
    const result = cleanupData({
      auditOlderThanDays: req.body?.auditOlderThanDays,
      chatOlderThanDays: req.body?.chatOlderThanDays,
      backupKeepCount: req.body?.backupKeepCount,
    });
    insertAuditLog("data_cleanup_completed", "database", "lifeos-data", {
      ...result,
      requested: {
        auditOlderThanDays: req.body?.auditOlderThanDays,
        chatOlderThanDays: req.body?.chatOlderThanDays,
        backupKeepCount: req.body?.backupKeepCount,
      },
    }, (req as any).actor?.type, (req as any).actor?.id);
    res.json({ cleanup: result });
  });

  app.post("/api/v1/data/cleanup/preview", requireAdmin, (req, res) => {
    const preview = previewDataCleanup({
      auditOlderThanDays: req.body?.auditOlderThanDays,
      chatOlderThanDays: req.body?.chatOlderThanDays,
      backupKeepCount: req.body?.backupKeepCount,
    });
    insertAuditLog("data_cleanup_previewed", "database", "lifeos-data", {
      ...preview,
      requested: {
        auditOlderThanDays: req.body?.auditOlderThanDays,
        chatOlderThanDays: req.body?.chatOlderThanDays,
        backupKeepCount: req.body?.backupKeepCount,
      },
    }, (req as any).actor?.type, (req as any).actor?.id);
    res.json({ cleanup: preview });
  });
}
