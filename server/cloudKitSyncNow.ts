import type { getIcloudDataSyncReadiness } from "./icloudDataSyncReadiness";
import { createDatabaseBackup } from "./db";
import { runCloudKitNativeHelper, type CloudKitNativeHelperResult } from "./cloudKitNativeHelper";
import { applyCloudKitSyncQuarantine, type CloudKitSyncApplyResult } from "./cloudKitSyncApply";
import {
  CLOUDKIT_SYNC_IMPORT_CONFIRMATION,
  getCloudKitSyncQuarantineSummary,
  getCloudKitSyncStateSnapshot,
  listCloudKitSyncCheckpoints,
  publicCloudKitHelperResult,
  saveCloudKitSyncChangesPreview,
  saveCloudKitSyncImportQuarantine,
} from "./cloudKitSyncState";

export const CLOUDKIT_SYNC_NOW_CONFIRMATION = "SYNC_CLOUDKIT_NOW";

type IcloudDataSyncReadiness = ReturnType<typeof getIcloudDataSyncReadiness>;
type SyncNowStatus = "needs-setup" | "no-changes" | "imported" | "applied" | "conflicts" | "more-coming" | "failed";
type SyncNowNextAction = "configure-cloudkit" | "wait-for-icloud" | "review-conflicts" | "run-again" | "retry" | "done";
type BackupSummary = { stage: "import-quarantine" | "apply-quarantine"; created: true; size: number; createdAt: number; redaction?: ReturnType<typeof createDatabaseBackup>["redaction"] };

type SyncNowOptions = {
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

function backupSummary(stage: BackupSummary["stage"], backup: ReturnType<typeof createDatabaseBackup>): BackupSummary {
  return {
    stage,
    created: true,
    size: backup.size,
    createdAt: backup.createdAt,
    redaction: backup.redaction,
  };
}

function shouldRunNativeImport(readiness: IcloudDataSyncReadiness, changes: CloudKitNativeHelperResult) {
  if (changes.status !== "passed") return false;
  if (!readiness.enabled || !readiness.ready || !readiness.nativeHelper.executable || !readiness.nativeHelper.path) return false;
  const summary = changes.syncChangesPreview;
  return Boolean(summary && (summary.changed > 0 || summary.deleted > 0 || summary.moreComing));
}

function emptyApply(): CloudKitSyncApplyResult {
  return {
    attempted: 0,
    applied: 0,
    manualReviewRequired: getCloudKitSyncQuarantineSummary().pendingReview,
    conflicts: 0,
    failed: 0,
    skipped: 0,
    promotedZones: [],
    blockedZones: [],
    records: [],
    summary: getCloudKitSyncQuarantineSummary(),
    checkpoints: listCloudKitSyncCheckpoints(),
  };
}

function determineStatus(input: {
  readiness: IcloudDataSyncReadiness;
  changes: CloudKitNativeHelperResult;
  importFailed: boolean;
  importMoreComing: boolean;
  integrityRejected: number;
  importedChanged: number;
  importedDeleted: number;
  apply: CloudKitSyncApplyResult;
  pendingAfter: number;
  conflictsAfter: number;
}) {
  if (!input.readiness.enabled || input.changes.status === "skipped") {
    return { status: "needs-setup" as SyncNowStatus, nextAction: "configure-cloudkit" as SyncNowNextAction };
  }
  if (input.changes.status === "failed" && input.changes.failureKind === "helper-launch-blocked") {
    return { status: "needs-setup" as SyncNowStatus, nextAction: "configure-cloudkit" as SyncNowNextAction };
  }
  if (input.changes.status === "failed" || input.changes.syncChangesPreview?.failed || input.importFailed || input.integrityRejected > 0) {
    return { status: "failed" as SyncNowStatus, nextAction: "retry" as SyncNowNextAction };
  }
  if (input.apply.conflicts > 0 || input.pendingAfter > 0 || input.conflictsAfter > 0) {
    return { status: "conflicts" as SyncNowStatus, nextAction: "review-conflicts" as SyncNowNextAction };
  }
  if (input.changes.syncChangesPreview?.moreComing || input.importMoreComing) {
    return { status: "more-coming" as SyncNowStatus, nextAction: "run-again" as SyncNowNextAction };
  }
  if (input.apply.applied > 0) {
    return { status: "applied" as SyncNowStatus, nextAction: "done" as SyncNowNextAction };
  }
  if (input.importedChanged > 0 || input.importedDeleted > 0) {
    return { status: "imported" as SyncNowStatus, nextAction: "wait-for-icloud" as SyncNowNextAction };
  }
  return { status: "no-changes" as SyncNowStatus, nextAction: "done" as SyncNowNextAction };
}

export async function runCloudKitSyncNow(readiness: IcloudDataSyncReadiness, options: SyncNowOptions = {}) {
  const limit = normalizeLimit(options.limit);
  const now = options.now || Date.now();
  const runHelper = options.runHelper || runCloudKitNativeHelper;
  const createBackup = options.createBackup || createDatabaseBackup;
  const backups: BackupSummary[] = [];

  const syncState = getCloudKitSyncStateSnapshot(new Date(now));
  const changes = await runHelper(readiness, {
    operation: "sync-changes-preview",
    syncState,
    timeoutMs: 60_000,
    now: new Date(now),
  });
  const changesSaved = changes.status === "passed"
    ? saveCloudKitSyncChangesPreview(changes, now)
    : { saved: 0, checkpoints: listCloudKitSyncCheckpoints() };

  let importResult: CloudKitNativeHelperResult | undefined;
  let importSaved = {
    tokenSaved: 0,
    integrityRejected: 0,
    rejectionReasons: [] as Array<{ reason: string; count: number }>,
    summary: getCloudKitSyncQuarantineSummary(),
    checkpoints: listCloudKitSyncCheckpoints(),
  };

  if (shouldRunNativeImport(readiness, changes)) {
    const backup = createBackup({ prune: false });
    backups.push(backupSummary("import-quarantine", backup));
    importResult = await runHelper(readiness, {
      operation: "sync-import-quarantine",
      syncState: getCloudKitSyncStateSnapshot(new Date(now)),
      importConfirmation: CLOUDKIT_SYNC_IMPORT_CONFIRMATION,
      timeoutMs: 60_000,
      now: new Date(now),
    });
    if (importResult.status === "passed") {
      importSaved = saveCloudKitSyncImportQuarantine(importResult, now);
    }
  }

  let apply = emptyApply();
  const beforeApply = getCloudKitSyncQuarantineSummary();
  if (changes.status === "passed" && (!importResult || importResult.status === "passed") && beforeApply.autoReady > 0) {
    const backup = createBackup({ prune: false });
    backups.push(backupSummary("apply-quarantine", backup));
    apply = applyCloudKitSyncQuarantine({ limit, now, includeManualReview: false });
  }

  const finalSummary = getCloudKitSyncQuarantineSummary();
  const status = determineStatus({
    readiness,
    changes,
    importFailed: Boolean(importResult && importResult.status !== "passed"),
    importMoreComing: Boolean(importResult?.syncImportQuarantine?.moreComing),
    integrityRejected: importSaved.integrityRejected,
    importedChanged: importSaved.summary.importedChanged,
    importedDeleted: importSaved.summary.importedDeleted,
    apply,
    pendingAfter: finalSummary.pendingReview,
    conflictsAfter: finalSummary.conflicts,
  });

  return {
    ok: status.status !== "failed" && status.status !== "needs-setup",
    status: status.status,
    nextAction: status.nextAction,
    startedAt: now,
    finishedAt: Date.now(),
    limit,
    changes: {
      result: publicCloudKitHelperResult(changes),
      savedCheckpointCount: changesSaved.saved,
      checkpoints: changesSaved.checkpoints,
    },
    import: importResult
      ? {
          result: publicCloudKitHelperResult(importResult),
          tokenSaved: importSaved.tokenSaved,
          integrityRejected: importSaved.integrityRejected,
          rejectionReasons: importSaved.rejectionReasons,
          quarantine: importSaved.summary,
          checkpoints: importSaved.checkpoints,
        }
      : undefined,
    apply,
    quarantine: {
      summary: finalSummary,
      checkpoints: listCloudKitSyncCheckpoints(),
    },
    backups,
    safety: {
      rawPayloadReturnedToAdmin: false,
      serverChangeTokenReturnedToAdmin: false,
      appliesOnlyConflictFreeRecords: true,
    },
  };
}

export type CloudKitSyncNowResult = Awaited<ReturnType<typeof runCloudKitSyncNow>>;
