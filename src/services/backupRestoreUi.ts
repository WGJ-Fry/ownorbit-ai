import type { BackupPreview } from "./lifeosApi";

type CleanupPreview = {
  backupsDeleted: number;
  auditLogsDeleted: number;
  chatSessionsDeleted: number;
  messagesDeleted: number;
};

export type CleanupPolicyInput = {
  backupKeepCount: number;
  auditOlderThanDays: number;
  chatOlderThanDays: number;
};

export type CleanupPolicyResult =
  | { ok: true; options: CleanupPolicyInput; error?: never }
  | { ok: false; error: string; options?: never };

export type BackupPassphraseStrength = "empty" | "weak" | "fair" | "strong";

export type BackupPassphraseValidation =
  | { ok: true; strength: BackupPassphraseStrength; reason?: never }
  | { ok: false; strength: BackupPassphraseStrength; reason: "too_short" | "mismatch" | "too_weak" };

export function getBackupPassphraseStrength(passphrase: string): BackupPassphraseStrength {
  if (!passphrase) return "empty";
  let score = 0;
  if (passphrase.length >= 12) score += 1;
  if (passphrase.length >= 16) score += 1;
  if (/[a-z]/.test(passphrase) && /[A-Z]/.test(passphrase)) score += 1;
  if (/\d/.test(passphrase)) score += 1;
  if (/[^A-Za-z0-9]/.test(passphrase)) score += 1;
  if (score >= 4) return "strong";
  if (score >= 3) return "fair";
  return "weak";
}

export function validateBackupExportPassphrase(passphrase: string, confirmation: string): BackupPassphraseValidation {
  const strength = getBackupPassphraseStrength(passphrase);
  if (passphrase.length < 12) return { ok: false, strength, reason: "too_short" };
  if (passphrase !== confirmation) return { ok: false, strength, reason: "mismatch" };
  if (strength === "weak") return { ok: false, strength, reason: "too_weak" };
  return { ok: true, strength };
}

export function formatBackupTableSummary(tables: BackupPreview["tables"]) {
  return Object.entries(tables).map(([table, count]) => `${table}: ${count ?? "-"}`).join("\n");
}

export function buildRestoreConfirmMessage(backupFile: string, preview: Pick<BackupPreview, "tables">) {
  return `Schedule restore for backup ${backupFile}?\n\nBackup preview:\n${formatBackupTableSummary(preview.tables)}\n\nThe system will create a pre-restore backup first, then replace the current SQLite database before the next startup.`;
}

export function formatCleanupSummary(cleanup: CleanupPreview) {
  return `Estimated cleanup: ${cleanup.backupsDeleted} backup(s), ${cleanup.auditLogsDeleted} audit log(s), ${cleanup.chatSessionsDeleted} chat session(s), ${cleanup.messagesDeleted} message(s).`;
}

export function buildCleanupPolicyOptions(input: CleanupPolicyInput): CleanupPolicyResult {
  const backupKeepCount = Number(input.backupKeepCount);
  const auditOlderThanDays = Number(input.auditOlderThanDays);
  const chatOlderThanDays = Number(input.chatOlderThanDays);
  if (!Number.isFinite(backupKeepCount) || backupKeepCount < 1) {
    return { ok: false, error: "Backup retention count must be at least 1." };
  }
  if (!Number.isFinite(auditOlderThanDays) || auditOlderThanDays < 0 || !Number.isFinite(chatOlderThanDays) || chatOlderThanDays < 0) {
    return { ok: false, error: "Cleanup days cannot be below 0. Use 0 to skip cleanup for that data type." };
  }
  return {
    ok: true,
    options: {
      backupKeepCount,
      auditOlderThanDays,
      chatOlderThanDays,
    },
  };
}

export function buildCleanupConfirmMessage({
  backupKeepCount,
  auditOlderThanDays,
  chatOlderThanDays,
  cleanup,
}: {
  backupKeepCount: number;
  auditOlderThanDays: number;
  chatOlderThanDays: number;
  cleanup: CleanupPreview;
}) {
  const auditLabel = auditOlderThanDays > 0 ? `audit logs older than ${auditOlderThanDays} day(s)` : "do not clean audit logs";
  const chatLabel = chatOlderThanDays > 0 ? `chat sessions older than ${chatOlderThanDays} day(s)` : "do not clean chat sessions";
  return `Clean old data? The latest ${backupKeepCount} backup(s) will be kept; audit policy: ${auditLabel}; chat policy: ${chatLabel}.\n\n${formatCleanupSummary(cleanup)}`;
}
