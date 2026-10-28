import crypto from "crypto";
import { runCloudKitChatWorkerQueue } from "./cloudKitChatWorker";
import { buildCloudKitChatRelayExportPackage } from "./cloudKitChatRelayBatch";
import {
  getNextCloudKitChatJobForRelayClaim,
  hasDueCloudKitChatJob,
  markCloudKitChatResponsesExported,
} from "./cloudKitChatJobs";
import {
  markCloudKitChatRemoteCleanupCompleted,
  markCloudKitChatRemoteCleanupFailed,
} from "./cloudKitChatLifecycle";
import { CLOUDKIT_CHAT_RELAY_ZONE } from "./cloudKitChatRelayConfig";
import {
  acquireCloudKitChatRelayLease,
  releaseCloudKitChatRelayLease,
  renewCloudKitChatRelayLease,
  type CloudKitChatRelayLease,
} from "./cloudKitChatRelayLease";
import {
  getCloudKitChatRelayReadiness,
  type CloudKitChatRelayReadiness,
} from "./cloudKitChatRelayReadiness";
import { getCloudKitMacIdentityPublic } from "./cloudKitMacIdentity";
import {
  runCloudKitNativeHelper,
  type CloudKitNativeHelperResult,
} from "./cloudKitNativeHelper";
import { applyCloudKitSyncQuarantine } from "./cloudKitSyncApply";
import {
  CLOUDKIT_SYNC_IMPORT_CONFIRMATION,
  getCloudKitSyncStateSnapshot,
  publicCloudKitHelperResult,
  saveCloudKitSyncChangesPreview,
  saveCloudKitChatRelayImportQuarantine,
} from "./cloudKitSyncState";

type RelayCycleOptions = {
  now?: number;
  clock?: () => number;
  limit?: number;
  readiness?: CloudKitChatRelayReadiness;
  runHelper?: typeof runCloudKitNativeHelper;
  runWorker?: typeof runCloudKitChatWorkerQueue;
  getMacIdentity?: typeof getCloudKitMacIdentityPublic;
  lease?: CloudKitChatRelayLease;
};

function hasRemoteChanges(result: CloudKitNativeHelperResult) {
  const summary = result.syncChangesPreview;
  return result.status === "passed" && Boolean(
    summary.changed ||
    summary.deleted ||
    summary.moreComing ||
    summary.changeTokenResetZones.length,
  );
}

function nextRelaySyncState(result: CloudKitNativeHelperResult, now: number) {
  return {
    generatedAt: new Date(now).toISOString(),
    zones: (result.syncImportQuarantine?.zones || [])
      .filter((zone) => zone.zone === CLOUDKIT_CHAT_RELAY_ZONE && Boolean(zone.serverChangeToken))
      .map((zone) => ({
        zone: CLOUDKIT_CHAT_RELAY_ZONE,
        serverChangeToken: zone.serverChangeToken,
        tokenState: "applied" as const,
        updatedAt: now,
      })),
  };
}

async function runCloudKitChatRelayCycleWithLease(options: RelayCycleOptions = {}) {
  const now = options.now || Date.now();
  const limit = Math.min(100, Math.max(1, Math.trunc(options.limit || 20)));
  const readiness = options.readiness || getCloudKitChatRelayReadiness({ platformSupported: process.platform === "darwin" });
  const runHelper = options.runHelper || runCloudKitNativeHelper;
  const runWorker = options.runWorker || runCloudKitChatWorkerQueue;
  const clock = options.clock || (options.now === undefined ? Date.now : () => now);
  const refreshLease = () => {
    if (!options.lease) return;
    if (!renewCloudKitChatRelayLease(options.lease, { now: clock() })) {
      throw new Error("CloudKit chat relay lease was lost.");
    }
  };
  if (!readiness.enabled || !readiness.ready) {
    return {
      ok: false,
      status: "needs-setup" as const,
      readiness,
      pull: undefined,
      imported: undefined,
      apply: undefined,
      worker: undefined,
      upload: undefined,
      safety: readiness.privacy,
    };
  }

  const syncState = getCloudKitSyncStateSnapshot(new Date(now), [CLOUDKIT_CHAT_RELAY_ZONE]);
  const changes = await runHelper(readiness, {
    operation: "sync-changes-preview",
    syncState,
    timeoutMs: 60_000,
    now: new Date(now),
  });
  refreshLease();
  if (changes.status === "passed") saveCloudKitSyncChangesPreview(changes, now);
  if (changes.status !== "passed") {
    return {
      ok: false,
      status: "pull-failed" as const,
      readiness,
      pull: publicCloudKitHelperResult(changes),
      imported: undefined,
      apply: undefined,
      worker: undefined,
      upload: undefined,
      safety: readiness.privacy,
    };
  }

  let imported: CloudKitNativeHelperResult | undefined;
  let importPasses = 0;
  if (hasRemoteChanges(changes)) {
    let importState = getCloudKitSyncStateSnapshot(new Date(now), [CLOUDKIT_CHAT_RELAY_ZONE]);
    do {
      imported = await runHelper(readiness, {
        operation: "sync-import-quarantine",
        syncState: importState,
        importConfirmation: CLOUDKIT_SYNC_IMPORT_CONFIRMATION,
        timeoutMs: 60_000,
        now: new Date(now),
      });
      refreshLease();
      importPasses += 1;
      if (imported.status === "passed") saveCloudKitChatRelayImportQuarantine(imported, now);
      if (imported.status !== "passed") {
        return {
          ok: false,
          status: "import-failed" as const,
          readiness,
          pull: publicCloudKitHelperResult(changes),
          imported: publicCloudKitHelperResult(imported),
          importPasses,
          apply: undefined,
          worker: undefined,
          upload: undefined,
          safety: readiness.privacy,
        };
      }
      if (!imported.syncImportQuarantine?.moreComing) break;
      importState = nextRelaySyncState(imported, now);
    } while (importPasses < 8);
    if (imported.syncImportQuarantine?.moreComing) {
      return {
        ok: false,
        status: "pull-incomplete" as const,
        readiness,
        pull: publicCloudKitHelperResult(changes),
        imported: publicCloudKitHelperResult(imported),
        importPasses,
        apply: undefined,
        worker: undefined,
        upload: undefined,
        safety: readiness.privacy,
      };
    }
  }

  const apply = applyCloudKitSyncQuarantine({
    limit,
    now,
    includeManualReview: false,
    allowedZones: [CLOUDKIT_CHAT_RELAY_ZONE],
  });
  refreshLease();
  if (apply.conflicts > 0 || apply.failed > 0) {
    return {
      ok: false,
      status: "relay-conflict" as const,
      readiness,
      pull: publicCloudKitHelperResult(changes),
      imported: imported ? publicCloudKitHelperResult(imported) : undefined,
      importPasses,
      apply,
      worker: undefined,
      upload: undefined,
      safety: readiness.privacy,
    };
  }

  const hasDueJob = hasDueCloudKitChatJob(now);
  const owner = hasDueJob
    ? (options.getMacIdentity || getCloudKitMacIdentityPublic)()
    : undefined;
  const candidate = owner
    ? getNextCloudKitChatJobForRelayClaim({
        now,
        trustedMacFingerprint: owner.publicKeyFingerprint,
      })
    : undefined;
  let claim: CloudKitNativeHelperResult | undefined;
  if (candidate) {
    const claimNow = clock();
    const fencingToken = options.lease?.fencingToken || 1;
    const claimId = crypto.createHash("sha256")
      .update([
        "ownorbit-cloudkit-chat-claim.v1",
        candidate.requestId,
        candidate.requestContentHash,
        owner!.publicKeyFingerprint,
        String(fencingToken),
      ].join("\n"))
      .digest("hex");
    claim = await runHelper(readiness, {
      operation: "chat-claim",
      timeoutMs: 60_000,
      now: new Date(claimNow),
      chatClaim: {
        requestId: candidate.requestId,
        requestContentHash: candidate.requestContentHash,
        claimId,
        ownerFingerprint: owner!.publicKeyFingerprint,
        trustedMacFingerprint: candidate.trustedMacFingerprint || "",
        fencingToken,
        claimedAt: claimNow,
        expiresAt: claimNow + 10 * 60_000,
      },
    });
    refreshLease();
    if (claim.status !== "passed") {
      return {
        ok: false,
        status: "claim-failed" as const,
        readiness,
        pull: publicCloudKitHelperResult(changes),
        imported: imported ? publicCloudKitHelperResult(imported) : undefined,
        importPasses,
        apply,
        claim: publicCloudKitHelperResult(claim),
        worker: undefined,
        upload: undefined,
        safety: readiness.privacy,
      };
    }
    if (!claim.chatClaim.acquired) {
      return {
        ok: false,
        status: "claim-busy" as const,
        readiness,
        pull: publicCloudKitHelperResult(changes),
        imported: imported ? publicCloudKitHelperResult(imported) : undefined,
        importPasses,
        apply,
        claim: publicCloudKitHelperResult(claim),
        worker: undefined,
        upload: undefined,
        safety: readiness.privacy,
      };
    }
  }

  const worker = candidate
    ? await runWorker({ now, limit: 1, requestId: candidate.requestId })
    : {
        status: "idle" as const,
        processed: 0,
        completed: 0,
        retryScheduled: 0,
        failed: 0,
        expired: 0,
        items: [],
        safety: {
          toolExecutionEnabled: false as const,
          promptReturnedToAdmin: false as const,
          responseReturnedToAdmin: false as const,
          credentialsPersistedToCloudKit: false as const,
        },
      };
  refreshLease();
  const exportPackage = buildCloudKitChatRelayExportPackage({ limit, now: new Date(now) });
  const upload = exportPackage.ok
    ? await runHelper(readiness, {
        operation: "sync-export",
        syncExportPackage: exportPackage,
        timeoutMs: 60_000,
        now: new Date(now),
      })
    : undefined;
  refreshLease();
  const uploadPassed = !upload || upload.status === "passed";
  const delivery = upload && uploadPassed
    ? markCloudKitChatResponsesExported(exportPackage.deliveryReceipts, now)
    : { marked: 0 };
  const cleanup = upload && uploadPassed
    ? markCloudKitChatRemoteCleanupCompleted(
        exportPackage.cleanupReceipts.map((item) => item.requestId),
        { now },
      )
    : upload
    ? markCloudKitChatRemoteCleanupFailed(
        exportPackage.cleanupReceipts.map((item) => item.requestId),
        upload.errors.join("; ") || "CloudKit remote cleanup export failed.",
        { now },
      )
    : { marked: 0 };
  return {
    ok: uploadPassed,
    status: uploadPassed ? "completed" as const : "upload-failed" as const,
    readiness,
    pull: publicCloudKitHelperResult(changes),
    imported: imported ? publicCloudKitHelperResult(imported) : undefined,
    importPasses,
    apply,
    claim: claim ? publicCloudKitHelperResult(claim) : undefined,
    worker,
    upload: upload ? publicCloudKitHelperResult(upload) : undefined,
    export: {
      status: exportPackage.status,
      recordCount: exportPackage.recordCount,
      delivered: delivery.marked,
      remoteCleanups: cleanup.marked,
      deletionCount: exportPackage.deletionCount,
      safety: exportPackage.safety,
    },
    safety: readiness.privacy,
  };
}

export async function runCloudKitChatRelayCycle(options: RelayCycleOptions = {}) {
  const now = options.now || Date.now();
  const readiness = options.readiness || getCloudKitChatRelayReadiness({ platformSupported: process.platform === "darwin" });
  if (!readiness.enabled || !readiness.ready) {
    return runCloudKitChatRelayCycleWithLease({ ...options, now, readiness });
  }
  const acquired = acquireCloudKitChatRelayLease({ now });
  if (!acquired.acquired) {
    return {
      ok: true,
      status: "relay-busy" as const,
      readiness,
      pull: undefined,
      imported: undefined,
      apply: undefined,
      worker: undefined,
      upload: undefined,
      export: undefined,
      leaseExpiresAt: acquired.lease?.expiresAt,
      safety: readiness.privacy,
    };
  }
  try {
    return await runCloudKitChatRelayCycleWithLease({
      ...options,
      now: options.now,
      readiness,
      lease: acquired.lease,
    });
  } finally {
    releaseCloudKitChatRelayLease(acquired.lease.leaseId, acquired.lease.fencingToken);
  }
}

export type CloudKitChatRelayCycleResult = Awaited<ReturnType<typeof runCloudKitChatRelayCycle>>;
