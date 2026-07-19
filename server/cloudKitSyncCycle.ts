import type { getIcloudDataSyncReadiness } from "./icloudDataSyncReadiness";
import { createDatabaseBackup } from "./db";
import { runCloudKitNativeHelper } from "./cloudKitNativeHelper";
import { runCloudKitSyncNow } from "./cloudKitSyncNow";
import { runCloudKitSyncUploadNow } from "./cloudKitSyncUploadNow";
import { runCloudKitChatWorkerQueue } from "./cloudKitChatWorker";

export const CLOUDKIT_SYNC_CYCLE_CONFIRMATION = "SYNC_CLOUDKIT_CYCLE";

type IcloudDataSyncReadiness = ReturnType<typeof getIcloudDataSyncReadiness>;
type SyncCycleStatus = "needs-setup" | "remote-failed" | "remote-conflicts" | "remote-more-coming" | "upload-blocked" | "upload-conflicts" | "upload-failed" | "local-empty" | "completed";
type SyncCycleNextAction = "configure-cloudkit" | "review-conflicts" | "review-blocked-records" | "continue-pull" | "retry" | "use-lifeos" | "done";

type SyncCycleOptions = {
  limit?: number;
  now?: number;
  runHelper?: typeof runCloudKitNativeHelper;
  createBackup?: typeof createDatabaseBackup;
  runChatWorker?: typeof runCloudKitChatWorkerQueue;
};

function normalizeLimit(value: unknown) {
  const parsed = Number.parseInt(String(value || ""), 10);
  if (!Number.isFinite(parsed) || parsed <= 0) return 100;
  return Math.min(500, Math.max(1, parsed));
}

function stopAfterPullStatus(status: Awaited<ReturnType<typeof runCloudKitSyncNow>>["status"]) {
  if (status === "needs-setup") {
    return { status: "needs-setup" as SyncCycleStatus, nextAction: "configure-cloudkit" as SyncCycleNextAction, ok: false };
  }
  if (status === "failed") {
    return { status: "remote-failed" as SyncCycleStatus, nextAction: "retry" as SyncCycleNextAction, ok: false };
  }
  if (status === "conflicts") {
    return { status: "remote-conflicts" as SyncCycleStatus, nextAction: "review-conflicts" as SyncCycleNextAction, ok: false };
  }
  if (status === "more-coming") {
    return { status: "remote-more-coming" as SyncCycleStatus, nextAction: "continue-pull" as SyncCycleNextAction, ok: false };
  }
  return null;
}

function finalStatus(status: Awaited<ReturnType<typeof runCloudKitSyncUploadNow>>["status"]) {
  if (status === "needs-setup") {
    return { status: "needs-setup" as SyncCycleStatus, nextAction: "configure-cloudkit" as SyncCycleNextAction, ok: false };
  }
  if (status === "blocked") {
    return { status: "upload-blocked" as SyncCycleStatus, nextAction: "review-blocked-records" as SyncCycleNextAction, ok: false };
  }
  if (status === "conflicts") {
    return { status: "upload-conflicts" as SyncCycleStatus, nextAction: "review-conflicts" as SyncCycleNextAction, ok: false };
  }
  if (status === "failed") {
    return { status: "upload-failed" as SyncCycleStatus, nextAction: "retry" as SyncCycleNextAction, ok: false };
  }
  if (status === "empty") {
    return { status: "local-empty" as SyncCycleStatus, nextAction: "use-lifeos" as SyncCycleNextAction, ok: true };
  }
  return { status: "completed" as SyncCycleStatus, nextAction: "done" as SyncCycleNextAction, ok: true };
}

function publicPullResult(pull: Awaited<ReturnType<typeof runCloudKitSyncNow>>) {
  return {
    ...pull,
    safety: {
      rawPayloadReturnedToAdmin: pull.safety.rawPayloadReturnedToAdmin,
      cloudKitChangeTokenReturnedToAdmin: false,
      appliesOnlyConflictFreeRecords: pull.safety.appliesOnlyConflictFreeRecords,
    },
  };
}

export async function runCloudKitSyncCycle(readiness: IcloudDataSyncReadiness, options: SyncCycleOptions = {}) {
  const limit = normalizeLimit(options.limit);
  const now = options.now || Date.now();
  const dependencies = {
    limit,
    now,
    runHelper: options.runHelper,
    createBackup: options.createBackup,
  };
  const pull = await runCloudKitSyncNow(readiness, dependencies);
  const publicPull = publicPullResult(pull);
  const pullStop = stopAfterPullStatus(pull.status);

  if (pullStop) {
    return {
      ok: pullStop.ok,
      status: pullStop.status,
      nextAction: pullStop.nextAction,
      startedAt: now,
      finishedAt: Date.now(),
      limit,
      pull: publicPull,
      chatWorker: undefined,
      upload: undefined,
      safety: {
        rawPayloadReturnedToAdmin: false,
        cloudKitChangeTokenReturnedToAdmin: false,
        localBackupPathReturnedToAdmin: false,
        uploadRunsOnlyAfterConflictFreePull: true,
        remoteChatToolsEnabled: false,
      },
    };
  }

  const chatWorker = await (options.runChatWorker || runCloudKitChatWorkerQueue)({
    now,
    limit: Math.min(3, limit),
  });
  const upload = await runCloudKitSyncUploadNow(readiness, dependencies);
  const status = finalStatus(upload.status);

  return {
    ok: status.ok,
    status: status.status,
    nextAction: status.nextAction,
    startedAt: now,
    finishedAt: Date.now(),
    limit,
    pull: publicPull,
    chatWorker,
    upload,
    safety: {
      rawPayloadReturnedToAdmin: false,
      cloudKitChangeTokenReturnedToAdmin: false,
      localBackupPathReturnedToAdmin: false,
      uploadRunsOnlyAfterConflictFreePull: true,
      remoteChatToolsEnabled: false,
    },
  };
}

export type CloudKitSyncCycleResult = Awaited<ReturnType<typeof runCloudKitSyncCycle>>;
