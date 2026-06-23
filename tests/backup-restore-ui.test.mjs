import assert from "node:assert/strict";
import test from "node:test";
import {
  buildCleanupConfirmMessage,
  buildCleanupPolicyOptions,
  buildRestoreConfirmMessage,
  formatBackupTableSummary,
  formatCleanupSummary,
  getBackupPassphraseStrength,
  validateBackupExportPassphrase,
} from "../src/services/backupRestoreUi.ts";

const preview = {
  tables: {
    devices: 2,
    messages: 42,
    schema_migrations: 3,
  },
};

test("backup restore UI formats restore previews consistently", () => {
  assert.equal(formatBackupTableSummary(preview.tables), "devices: 2\nmessages: 42\nschema_migrations: 3");
  assert.equal(
    buildRestoreConfirmMessage("lifeos-backup.db", preview),
    "Schedule restore for backup lifeos-backup.db?\n\nBackup preview:\ndevices: 2\nmessages: 42\nschema_migrations: 3\n\nThe system will create a pre-restore backup first, then replace the current SQLite database before the next startup.",
  );
});

test("backup restore UI formats cleanup previews and confirmations consistently", () => {
  const cleanup = {
    backupsDeleted: 1,
    auditLogsDeleted: 2,
    chatSessionsDeleted: 3,
    messagesDeleted: 4,
  };
  assert.equal(formatCleanupSummary(cleanup), "Estimated cleanup: 1 backup(s), 2 audit log(s), 3 chat session(s), 4 message(s).");
  assert.equal(
    buildCleanupConfirmMessage({
      backupKeepCount: 20,
      auditOlderThanDays: 180,
      chatOlderThanDays: 0,
      cleanup,
    }),
    "Clean old data? The latest 20 backup(s) will be kept; audit policy: audit logs older than 180 day(s); chat policy: do not clean chat sessions.\n\nEstimated cleanup: 1 backup(s), 2 audit log(s), 3 chat session(s), 4 message(s).",
  );
});

test("backup restore UI validates cleanup policy before API calls", () => {
  assert.deepEqual(
    buildCleanupPolicyOptions({ backupKeepCount: 20, auditOlderThanDays: 180, chatOlderThanDays: 0 }),
    { ok: true, options: { backupKeepCount: 20, auditOlderThanDays: 180, chatOlderThanDays: 0 } },
  );
  assert.deepEqual(
    buildCleanupPolicyOptions({ backupKeepCount: 0, auditOlderThanDays: 180, chatOlderThanDays: 365 }),
    { ok: false, error: "Backup retention count must be at least 1." },
  );
  assert.deepEqual(
    buildCleanupPolicyOptions({ backupKeepCount: 1, auditOlderThanDays: -1, chatOlderThanDays: 365 }),
    { ok: false, error: "Cleanup days cannot be below 0. Use 0 to skip cleanup for that data type." },
  );
});

test("backup restore UI validates encrypted backup export passphrases", () => {
  assert.equal(getBackupPassphraseStrength(""), "empty");
  assert.equal(getBackupPassphraseStrength("correcthorsebackup"), "weak");
  assert.equal(getBackupPassphraseStrength("CorrectHorse26"), "fair");
  assert.equal(getBackupPassphraseStrength("Correct-Horse-Backup-2026"), "strong");
  assert.deepEqual(
    validateBackupExportPassphrase("short", "short"),
    { ok: false, strength: "weak", reason: "too_short" },
  );
  assert.deepEqual(
    validateBackupExportPassphrase("Correct-Horse-Backup-2026", "Correct-Horse-Backup-2027"),
    { ok: false, strength: "strong", reason: "mismatch" },
  );
  assert.deepEqual(
    validateBackupExportPassphrase("correcthorsebackup", "correcthorsebackup"),
    { ok: false, strength: "weak", reason: "too_weak" },
  );
  assert.deepEqual(
    validateBackupExportPassphrase("Correct-Horse-Backup-2026", "Correct-Horse-Backup-2026"),
    { ok: true, strength: "strong" },
  );
});
