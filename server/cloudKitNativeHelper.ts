import { spawn } from "child_process";
import crypto from "crypto";
import type { CloudKitSyncExportPackage } from "./cloudKitSyncBatch.ts";
import type { getIcloudDataSyncReadiness } from "./icloudDataSyncReadiness.ts";

export const CLOUDKIT_NATIVE_HELPER_PROTOCOL_VERSION = 1;
export const CLOUDKIT_NATIVE_HELPER_REQUEST_SCHEMA = "lifeos-cloudkit-helper-request.v1";
export const CLOUDKIT_NATIVE_HELPER_RESPONSE_SCHEMA = "lifeos-cloudkit-helper-response.v1";
export const CLOUDKIT_NATIVE_HELPER_TRANSPORT = "json-stdio";
export const CLOUDKIT_NATIVE_HELPER_ARGS = ["--lifeos-cloudkit-json"] as const;
export const CLOUDKIT_NATIVE_HELPER_TIMEOUT_MS = 15_000;

const MAX_HELPER_OUTPUT_BYTES = 128 * 1024;
const MAX_TEXT_CHARS = 800;

type IcloudDataSyncReadiness = ReturnType<typeof getIcloudDataSyncReadiness>;

export type CloudKitNativeHelperOperation = "probe" | "roundtrip" | "sync-export" | "sync-import-preview" | "sync-changes-preview";
export type CloudKitNativeHelperRunStatus = "passed" | "failed" | "skipped";

export type CloudKitNativeHelperSyncState = {
  generatedAt?: string;
  zones?: Array<{
    zone: string;
    serverChangeToken?: string;
    tokenState?: string;
    updatedAt?: number;
  }>;
};

type CommandRunner = (
  command: string,
  args: string[],
  options: { stdin: string; timeoutMs: number },
) => Promise<{ exitCode: number | null; stdout: string; stderr: string; timedOut: boolean }>;

type HelperRunOptions = {
  operation?: CloudKitNativeHelperOperation;
  timeoutMs?: number;
  now?: Date;
  runCommand?: CommandRunner;
  syncExportPackage?: CloudKitSyncExportPackage;
  syncState?: CloudKitNativeHelperSyncState;
};

function compact(value: unknown, limit = MAX_TEXT_CHARS) {
  return String(value || "").replace(/\s+/g, " ").trim().slice(0, limit);
}

function redact(value: unknown, limit = MAX_TEXT_CHARS) {
  return compact(value, limit)
    .replace(/\b(Bearer|Basic)\s+[A-Za-z0-9._~+/=-]+/gi, "$1 [redacted]")
    .replace(/\b(?:github_pat_[A-Za-z0-9_]+|ghp_[A-Za-z0-9_]+|sk-[A-Za-z0-9_-]{12,}|sk-or-[A-Za-z0-9_-]{12,}|AIza[0-9A-Za-z_-]{20,})\b/g, "[redacted-token]")
    .replace(/\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi, "[redacted-email]")
    .replace(/\/Users\/[^/\s]+/g, "/Users/[redacted]")
    .replace(/\/(?:home|tmp|private\/tmp|var\/folders|Volumes)\/[^\s]+/g, "/[redacted-path]")
    .replace(/[A-Z]:\\Users\\[^\\\s]+/gi, "C:\\Users\\[redacted]")
    .replace(/(client_secret|refresh_token|access_token|token|key|secret|password)=\S+/gi, "$1=[redacted]");
}

function appendBounded(current: string, chunk: Buffer | string) {
  const next = current + String(chunk);
  if (Buffer.byteLength(next, "utf8") <= MAX_HELPER_OUTPUT_BYTES) return next;
  return next.slice(0, MAX_HELPER_OUTPUT_BYTES);
}

function defaultCommandRunner(command: string, args: string[], options: { stdin: string; timeoutMs: number }) {
  return new Promise<{ exitCode: number | null; stdout: string; stderr: string; timedOut: boolean }>((resolve) => {
    const child = spawn(command, args, {
      stdio: ["pipe", "pipe", "pipe"],
      env: {
        ...process.env,
        LIFEOS_CLOUDKIT_HELPER_PROTOCOL: `${CLOUDKIT_NATIVE_HELPER_TRANSPORT}-v${CLOUDKIT_NATIVE_HELPER_PROTOCOL_VERSION}`,
      },
    });
    let stdout = "";
    let stderr = "";
    let settled = false;
    let timedOut = false;
    const finish = (exitCode: number | null) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve({ exitCode, stdout, stderr, timedOut });
    };
    const timer = setTimeout(() => {
      timedOut = true;
      try {
        child.kill("SIGTERM");
      } catch {
        // Ignore process cleanup failures; the timeout is already reported.
      }
      finish(null);
    }, options.timeoutMs);
    if (typeof timer.unref === "function") timer.unref();
    child.stdout.on("data", (chunk) => {
      stdout = appendBounded(stdout, chunk);
    });
    child.stderr.on("data", (chunk) => {
      stderr = appendBounded(stderr, chunk);
    });
    child.on("error", (error) => {
      stderr = appendBounded(stderr, error.message);
      finish(null);
    });
    child.on("close", (code) => finish(code));
    child.stdin.end(options.stdin);
  });
}

function parseHelperPayload(stdout: string) {
  try {
    return JSON.parse(stdout) as Record<string, unknown>;
  } catch {
    return null;
  }
}

function normalizeStringList(value: unknown, limit = 16) {
  return Array.isArray(value)
    ? value.map((item) => compact(item, 120)).filter(Boolean).slice(0, limit)
    : [];
}

function normalizeRoundtrip(value: unknown) {
  const input = value && typeof value === "object" ? value as Record<string, unknown> : {};
  return {
    created: Boolean(input.created),
    fetched: Boolean(input.fetched),
    deleted: Boolean(input.deleted),
    recordType: compact(input.recordType, 80),
    zone: compact(input.zone, 80),
  };
}

function normalizeSyncExport(value: unknown) {
  const input = value && typeof value === "object" ? value as Record<string, unknown> : {};
  return {
    attempted: Number(input.attempted || 0),
    saved: Number(input.saved || 0),
    failed: Number(input.failed || 0),
    recordPlanHash: compact(input.recordPlanHash, 80),
    zones: normalizeStringList(input.zones, 24),
    recordTypes: normalizeStringList(input.recordTypes, 24),
  };
}

function normalizeImportPreviewRecord(value: unknown) {
  const input = value && typeof value === "object" ? value as Record<string, unknown> : {};
  return {
    zone: compact(input.zone, 80),
    recordType: compact(input.recordType, 80),
    recordName: compact(input.recordName, 160),
    mutationId: compact(input.mutationId, 80),
    contentHash: compact(input.contentHash, 120),
    logicalClock: Number(input.logicalClock || 0),
    payloadByteSize: Number(input.payloadByteSize || 0),
    modifiedAt: compact(input.modifiedAt, 80),
    requiresUserReview: Boolean(input.requiresUserReview),
  };
}

function normalizeSyncImportPreview(value: unknown) {
  const input = value && typeof value === "object" ? value as Record<string, unknown> : {};
  return {
    scannedZones: normalizeStringList(input.scannedZones, 32),
    scannedRecordTypes: normalizeStringList(input.scannedRecordTypes, 64),
    fetched: Number(input.fetched || 0),
    failed: Number(input.failed || 0),
    truncated: Boolean(input.truncated),
    records: Array.isArray(input.records) ? input.records.map(normalizeImportPreviewRecord).slice(0, 500) : [],
  };
}

function normalizeChangePreviewRecord(value: unknown) {
  const input = value && typeof value === "object" ? value as Record<string, unknown> : {};
  return {
    zone: compact(input.zone, 80),
    recordType: compact(input.recordType, 80),
    recordName: compact(input.recordName, 160),
    mutationId: compact(input.mutationId, 80),
    contentHash: compact(input.contentHash, 120),
    logicalClock: Number(input.logicalClock || 0),
    payloadByteSize: Number(input.payloadByteSize || 0),
    modifiedAt: compact(input.modifiedAt, 80),
    requiresUserReview: Boolean(input.requiresUserReview),
  };
}

function normalizeChangePreviewDeletion(value: unknown) {
  const input = value && typeof value === "object" ? value as Record<string, unknown> : {};
  return {
    zone: compact(input.zone, 80),
    recordType: compact(input.recordType, 80),
    recordName: compact(input.recordName, 160),
    deletedAt: compact(input.deletedAt, 80),
  };
}

function normalizeChangePreviewZone(value: unknown) {
  const input = value && typeof value === "object" ? value as Record<string, unknown> : {};
  return {
    zone: compact(input.zone, 80),
    previousServerChangeTokenPresent: Boolean(input.previousServerChangeTokenPresent),
    serverChangeToken: compact(input.serverChangeToken, 16_384),
    serverChangeTokenCaptured: Boolean(input.serverChangeToken || input.serverChangeTokenCaptured),
    changed: Number(input.changed || 0),
    deleted: Number(input.deleted || 0),
    failed: Number(input.failed || 0),
    moreComing: Boolean(input.moreComing),
  };
}

function normalizeSyncChangesPreview(value: unknown) {
  const input = value && typeof value === "object" ? value as Record<string, unknown> : {};
  return {
    scannedZones: normalizeStringList(input.scannedZones, 32),
    changed: Number(input.changed || 0),
    deleted: Number(input.deleted || 0),
    failed: Number(input.failed || 0),
    moreComing: Boolean(input.moreComing),
    rawPayloadIncluded: Boolean(input.rawPayloadIncluded),
    zones: Array.isArray(input.zones) ? input.zones.map(normalizeChangePreviewZone).slice(0, 32) : [],
    changedRecords: Array.isArray(input.changedRecords) ? input.changedRecords.map(normalizeChangePreviewRecord).slice(0, 500) : [],
    deletedRecords: Array.isArray(input.deletedRecords) ? input.deletedRecords.map(normalizeChangePreviewDeletion).slice(0, 500) : [],
  };
}

export function cloudKitNativeHelperContract() {
  return {
    protocolVersion: CLOUDKIT_NATIVE_HELPER_PROTOCOL_VERSION,
    transport: CLOUDKIT_NATIVE_HELPER_TRANSPORT,
    requestSchema: CLOUDKIT_NATIVE_HELPER_REQUEST_SCHEMA,
    responseSchema: CLOUDKIT_NATIVE_HELPER_RESPONSE_SCHEMA,
    operations: ["probe", "roundtrip", "sync-export", "sync-import-preview", "sync-changes-preview"] as CloudKitNativeHelperOperation[],
    commandArgs: [...CLOUDKIT_NATIVE_HELPER_ARGS],
    timeoutMs: CLOUDKIT_NATIVE_HELPER_TIMEOUT_MS,
  };
}

export function buildCloudKitNativeHelperRequest(
  readiness: IcloudDataSyncReadiness,
  operation: CloudKitNativeHelperOperation,
  now = new Date(),
  syncExportPackage?: CloudKitSyncExportPackage,
  syncState?: CloudKitNativeHelperSyncState,
) {
  const forbiddenFieldNames = Array.from(new Set(readiness.recordPlan.flatMap((item) => item.forbiddenFields))).sort();
  const request: Record<string, unknown> = {
    protocolVersion: CLOUDKIT_NATIVE_HELPER_PROTOCOL_VERSION,
    schema: CLOUDKIT_NATIVE_HELPER_REQUEST_SCHEMA,
    operation,
    generatedAt: now.toISOString(),
    containerId: readiness.containerId,
    bundleId: readiness.bundleId,
    selectedDataTypes: readiness.selectedDataTypes,
    recordPlan: readiness.recordPlan.map((item) => ({
      dataType: item.dataType,
      zone: item.zone,
      recordTypes: item.recordTypes,
      safeFields: item.safeFields,
      mutationModel: item.mutationModel,
      conflictPolicy: item.conflictPolicy,
      requiresUserReview: item.requiresUserReview,
    })),
    requiredNativeCapabilities: readiness.requiredNativeCapabilities,
    safety: {
      dryRun: operation === "probe",
      blockedDataTypes: readiness.blockedDataTypes,
      neverSyncDataTypes: readiness.notSyncedDataTypes,
      forbiddenFieldNames,
      blockedDataTypePolicy: readiness.blockedDataTypePolicy,
    },
  };
  if (operation === "sync-export" && syncExportPackage?.ok) {
    request.syncBatch = syncExportPackage.helperSyncBatch;
  }
  if (operation === "sync-changes-preview") {
    request.syncState = {
      generatedAt: syncState?.generatedAt || now.toISOString(),
      zones: (syncState?.zones || []).map((zone) => ({
        zone: compact(zone.zone, 80),
        serverChangeToken: compact(zone.serverChangeToken, 16_384),
        tokenState: compact(zone.tokenState, 40),
        updatedAt: Number(zone.updatedAt || 0),
      })).filter((zone) => zone.zone && zone.serverChangeToken),
    };
  }
  return request;
}

function skippedResult(operation: CloudKitNativeHelperOperation, readinessStatus: string, reason: string) {
  return {
    ok: false,
    status: "skipped" as const,
    operation,
    checkedAt: new Date().toISOString(),
    readinessStatus,
    reason,
    helperProtocol: cloudKitNativeHelperContract(),
    roundtrip: normalizeRoundtrip(undefined),
    syncExport: normalizeSyncExport(undefined),
    syncImportPreview: normalizeSyncImportPreview(undefined),
    syncChangesPreview: normalizeSyncChangesPreview(undefined),
  };
}

export async function runCloudKitNativeHelper(
  readiness: IcloudDataSyncReadiness,
  options: HelperRunOptions = {},
) {
  const operation = options.operation || "probe";
  if (!readiness.enabled) return skippedResult(operation, readiness.status, "CloudKit data sync is not enabled.");
  if (!readiness.ready) return skippedResult(operation, readiness.status, `CloudKit readiness is ${readiness.status}.`);
  if (!readiness.nativeHelper.executable || !readiness.nativeHelper.path) {
    return skippedResult(operation, readiness.status, "Native CloudKit helper is not executable.");
  }
  if (operation === "sync-export" && !options.syncExportPackage?.ok) {
    return skippedResult(operation, readiness.status, "CloudKit sync export package is not ready or was not explicitly confirmed.");
  }

  const request = buildCloudKitNativeHelperRequest(readiness, operation, options.now || new Date(), options.syncExportPackage, options.syncState);
  const requestJson = JSON.stringify(request);
  const requestHash = `sha256:${crypto.createHash("sha256").update(requestJson).digest("hex").slice(0, 16)}`;
  const runCommand = options.runCommand || defaultCommandRunner;
  const command = await runCommand(readiness.nativeHelper.path, [...CLOUDKIT_NATIVE_HELPER_ARGS], {
    stdin: requestJson,
    timeoutMs: Math.max(1000, Math.min(options.timeoutMs || CLOUDKIT_NATIVE_HELPER_TIMEOUT_MS, 60_000)),
  });
  const payload = parseHelperPayload(command.stdout);
  const roundtrip = normalizeRoundtrip(payload?.roundtrip);
  const syncExport = normalizeSyncExport(payload?.syncExport);
  const syncImportPreview = normalizeSyncImportPreview(payload?.syncImportPreview);
  const syncChangesPreview = normalizeSyncChangesPreview(payload?.syncChangesPreview);
  const operationMatches = payload?.operation === operation;
  const protocolMatches = payload?.protocolVersion === CLOUDKIT_NATIVE_HELPER_PROTOCOL_VERSION &&
    payload?.schema === CLOUDKIT_NATIVE_HELPER_RESPONSE_SCHEMA;
  const responseOk = payload?.ok === true;
  const roundtripOk = operation !== "roundtrip" || (roundtrip.created && roundtrip.fetched && roundtrip.deleted);
  const syncExportOk = operation !== "sync-export" || (syncExport.attempted > 0 && syncExport.saved === syncExport.attempted && syncExport.failed === 0);
  const passed = command.exitCode === 0 && !command.timedOut && responseOk && protocolMatches && operationMatches && roundtripOk && syncExportOk;
  const payloadWarnings = normalizeStringList(payload?.warnings).map((item) => redact(item, 240));
  const payloadErrors = normalizeStringList(payload?.errors).map((item) => redact(item, 240));
  const errors = [
    ...payloadErrors,
    ...(payload ? [] : ["Helper stdout was not valid JSON."]),
    ...(protocolMatches ? [] : ["Helper protocol response did not match LifeOS CloudKit helper v1."]),
    ...(operationMatches ? [] : ["Helper operation did not match the request."]),
    ...(command.timedOut ? ["Helper timed out."] : []),
  ];

  return {
    ok: passed,
    status: passed ? "passed" as const : "failed" as const,
    operation,
    checkedAt: new Date().toISOString(),
    readinessStatus: readiness.status,
    requestHash,
    helperProtocol: cloudKitNativeHelperContract(),
    evidenceId: compact(payload?.evidenceId, 120),
    accountStatus: compact(payload?.accountStatus, 80),
    containerReachable: Boolean(payload?.containerReachable),
    capabilitiesVerified: normalizeStringList(payload?.capabilitiesVerified || payload?.capabilities, 32),
    roundtrip,
    syncExport,
    syncImportPreview,
    syncChangesPreview,
    warnings: payloadWarnings,
    errors,
    command: {
      exitCode: command.exitCode,
      timedOut: command.timedOut,
      stdoutBytes: Buffer.byteLength(command.stdout, "utf8"),
      stderr: redact(command.stderr, 600),
    },
  };
}

export type CloudKitNativeHelperResult = Awaited<ReturnType<typeof runCloudKitNativeHelper>>;
