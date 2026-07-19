import type { getIcloudDataSyncReadiness } from "./icloudDataSyncReadiness";
import { createDatabaseBackup } from "./db";
import { runCloudKitNativeHelper } from "./cloudKitNativeHelper";
import { buildCloudKitSyncExportPackage, CLOUDKIT_SYNC_EXPORT_CONFIRMATION, summarizeCloudKitSyncExportPackage } from "./cloudKitSyncBatch";
import { publicCloudKitHelperResult } from "./cloudKitSyncState";

export const CLOUDKIT_SYNC_UPLOAD_NOW_CONFIRMATION = "UPLOAD_CLOUDKIT_NOW";

type IcloudDataSyncReadiness = ReturnType<typeof getIcloudDataSyncReadiness>;
type UploadNowStatus = "needs-setup" | "empty" | "blocked" | "uploaded" | "conflicts" | "failed";
type UploadNowNextAction = "configure-cloudkit" | "add-local-data" | "review-blocked-records" | "review-conflicts" | "retry" | "done";
type BackupSummary = { stage: "export-cloudkit"; created: true; size: number; createdAt: number; redaction?: ReturnType<typeof createDatabaseBackup>["redaction"] };

type UploadNowOptions = {
  limit?: number;
  now?: number;
  runHelper?: typeof runCloudKitNativeHelper;
  createBackup?: typeof createDatabaseBackup;
};

function normalizeLimit(value: unknown) {
  const parsed = Number.parseInt(String(value || ""), 10);
  if (!Number.isFinite(parsed) || parsed <= 0) return 100;
  return Math.min(500, Math.max(1, parsed));
}

function backupSummary(backup: ReturnType<typeof createDatabaseBackup>): BackupSummary {
  return {
    stage: "export-cloudkit",
    created: true,
    size: backup.size,
    createdAt: backup.createdAt,
    redaction: backup.redaction,
  };
}

function blockedStatus(readiness: IcloudDataSyncReadiness, summary: ReturnType<typeof summarizeCloudKitSyncExportPackage>) {
  if (!readiness.enabled || !readiness.ready || summary.preview.status === "skipped") {
    return { status: "needs-setup" as UploadNowStatus, nextAction: "configure-cloudkit" as UploadNowNextAction, ok: false };
  }
  if (summary.preview.status === "empty" || (summary.preview.readyRecordCount === 0 && summary.preview.blockedRecordCount === 0)) {
    return { status: "empty" as UploadNowStatus, nextAction: "add-local-data" as UploadNowNextAction, ok: true };
  }
  return { status: "blocked" as UploadNowStatus, nextAction: "review-blocked-records" as UploadNowNextAction, ok: false };
}

export async function runCloudKitSyncUploadNow(readiness: IcloudDataSyncReadiness, options: UploadNowOptions = {}) {
  const limit = normalizeLimit(options.limit);
  const now = options.now || Date.now();
  const runHelper = options.runHelper || runCloudKitNativeHelper;
  const createBackup = options.createBackup || createDatabaseBackup;
  const exportPackage = buildCloudKitSyncExportPackage(readiness, {
    limit,
    confirmation: CLOUDKIT_SYNC_EXPORT_CONFIRMATION,
    now: new Date(now),
  });
  const summary = summarizeCloudKitSyncExportPackage(exportPackage);

  if (!exportPackage.ok) {
    const status = blockedStatus(readiness, summary);
    return {
      ok: status.ok,
      status: status.status,
      nextAction: status.nextAction,
      startedAt: now,
      finishedAt: Date.now(),
      limit,
      export: summary,
      backup: undefined,
      result: undefined,
      safety: {
        rawPayloadReturnedToAdmin: false,
        rawPayloadSentOnlyToNativeHelper: false,
        localBackupPathReturnedToAdmin: false,
        requiresExplicitConfirmation: true,
      },
    };
  }

  const backup = createBackup({ prune: false });
  const result = await runHelper(readiness, {
    operation: "sync-export",
    syncExportPackage: exportPackage,
    timeoutMs: 60_000,
    now: new Date(now),
  });
  const publicResult = publicCloudKitHelperResult(result);
  const uploaded = result.status === "passed";
  const syncExport = result.syncExport;
  const conflictOnly = !uploaded && syncExport.attempted > 0 && syncExport.saved > 0 &&
    syncExport.conflicts > 0 && syncExport.failed === syncExport.conflicts &&
    syncExport.saved + syncExport.failed === syncExport.attempted;

  return {
    ok: uploaded,
    status: uploaded ? "uploaded" as const : conflictOnly ? "conflicts" as const : "failed" as const,
    nextAction: uploaded ? "done" as const : conflictOnly ? "review-conflicts" as const : "retry" as const,
    startedAt: now,
    finishedAt: Date.now(),
    limit,
    export: summary,
    backup: backupSummary(backup),
    result: publicResult,
    safety: {
      rawPayloadReturnedToAdmin: false,
      rawPayloadSentOnlyToNativeHelper: true,
      localBackupPathReturnedToAdmin: false,
      requiresExplicitConfirmation: true,
    },
  };
}

export type CloudKitSyncUploadNowResult = Awaited<ReturnType<typeof runCloudKitSyncUploadNow>>;
