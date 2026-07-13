#!/usr/bin/env node
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { isCloudKitPlatformSupported } from "../server/cloudKitPlatform.ts";
import { getIcloudDataSyncReadiness } from "../server/icloudDataSyncReadiness.ts";
import { runCloudKitNativeHelper } from "../server/cloudKitNativeHelper.ts";

const helperOperationTitles = {
  probe: "CloudKit account and private database probe",
  roundtrip: "Disposable CloudKit create/fetch/delete roundtrip",
  "subscription-probe": "CloudKit background push subscription registration probe",
};

const allowedOperations = new Set(Object.keys(helperOperationTitles));

function parseArgs(argv) {
  const result = {
    operations: [],
    all: false,
    json: false,
    out: "",
    strict: false,
    timeoutMs: undefined,
  };
  for (let index = 0; index < argv.length; index += 1) {
    const value = argv[index];
    if (value === "--all") result.all = true;
    else if (value === "--probe") result.operations.push("probe");
    else if (value === "--roundtrip") result.operations.push("roundtrip");
    else if (value === "--subscription-probe") result.operations.push("subscription-probe");
    else if (value === "--operation") result.operations.push(argv[++index] || "");
    else if (value === "--json") result.json = true;
    else if (value === "--out") result.out = argv[++index] || "";
    else if (value === "--strict") result.strict = true;
    else if (value === "--timeout-ms") result.timeoutMs = Number(argv[++index] || 0) || undefined;
  }
  return result;
}

function selectedOperations(input = {}) {
  const operations = input.all ? ["probe", "roundtrip", "subscription-probe"] : input.operations?.length ? input.operations : ["probe"];
  const unique = [];
  for (const operation of operations) {
    if (!allowedOperations.has(operation)) throw new Error(`Unsupported iCloud acceptance operation: ${operation}`);
    if (!unique.includes(operation)) unique.push(operation);
  }
  return unique;
}

function compact(value, limit = 240) {
  return String(value || "").replace(/\s+/g, " ").trim().slice(0, limit);
}

function redact(value, limit = 240) {
  return compact(value, limit)
    .replace(/\b(Bearer|Basic)\s+[A-Za-z0-9._~+/=-]+/gi, "$1 [redacted]")
    .replace(/\b(?:github_pat_[A-Za-z0-9_]+|ghp_[A-Za-z0-9_]+|sk-[A-Za-z0-9_-]{12,}|sk-or-[A-Za-z0-9_-]{12,}|AIza[0-9A-Za-z_-]{20,})\b/g, "[redacted-token]")
    .replace(/\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi, "[redacted-email]")
    .replace(/\/Users\/[^/\s]+/g, "/Users/[redacted]")
    .replace(/\/(?:home|tmp|private\/tmp|var\/folders|Volumes)\/[^\s]+/g, "/[redacted-path]")
    .replace(/[A-Z]:\\Users\\[^\\\s]+/gi, "C:\\Users\\[redacted]")
    .replace(/(client_secret|refresh_token|access_token|token|key|secret|password)=\S+/gi, "$1=[redacted]");
}

function redactedId(value) {
  const raw = compact(value, 300);
  if (!raw) return "";
  return `sha256:${crypto.createHash("sha256").update(raw).digest("hex").slice(0, 12)}`;
}

async function withTemporaryEnv(env, fn) {
  if (!env) return await fn();
  const previous = new Map();
  for (const [key, value] of Object.entries(env)) {
    previous.set(key, process.env[key]);
    if (value === undefined) delete process.env[key];
    else process.env[key] = String(value);
  }
  try {
    return await fn();
  } finally {
    for (const [key, value] of previous) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
}

function summarizeReadiness(readiness) {
  return {
    enabled: Boolean(readiness.enabled),
    ready: Boolean(readiness.ready),
    mode: readiness.mode,
    status: readiness.status,
    dataSyncScope: readiness.dataSyncScope,
    selectedDataTypes: readiness.selectedDataTypes || [],
    blockedDataTypes: readiness.blockedDataTypes || [],
    notSyncedDataTypes: readiness.notSyncedDataTypes || [],
    requiresNativeAppleClient: Boolean(readiness.requiresNativeAppleClient),
    requiresCloudKitContainer: Boolean(readiness.requiresCloudKitContainer),
    requiresExplicitUserOptIn: Boolean(readiness.requiresExplicitUserOptIn),
    nextAction: readiness.nextAction,
    configuration: {
      containerConfigured: Boolean(readiness.containerId),
      containerIdHash: redactedId(readiness.containerId),
      teamIdConfigured: Boolean(readiness.teamIdConfigured),
      bundleIdConfigured: Boolean(readiness.bundleId),
      bundleIdHash: redactedId(readiness.bundleId),
      nativeHelperConfigured: Boolean(readiness.nativeHelper?.configured),
      nativeHelperDetected: Boolean(readiness.nativeHelper?.detected),
      nativeHelperExecutable: Boolean(readiness.nativeHelper?.executable),
      nativeHelperPathReturned: false,
      entitlementsDetected: Boolean(readiness.entitlements?.detected),
      entitlementsMentionCloudKit: Boolean(readiness.entitlements?.mentionsCloudKit),
      entitlementsMentionContainer: Boolean(readiness.entitlements?.mentionsContainer),
      entitlementsPathReturned: false,
    },
    recordPlan: Array.isArray(readiness.recordPlan)
      ? readiness.recordPlan.map((item) => ({
        dataType: item.dataType,
        zone: item.zone,
        recordTypes: item.recordTypes,
        requiresUserReview: Boolean(item.requiresUserReview),
      }))
      : [],
    acceptanceGates: Array.isArray(readiness.acceptanceGates)
      ? readiness.acceptanceGates.map((gate) => ({
        id: gate.id,
        status: gate.status,
        detail: redact(gate.detail, 300),
      }))
      : [],
  };
}

function summarizeHelperResult(result, latencyMs) {
  return {
    id: `helper-${result.operation}`,
    title: helperOperationTitles[result.operation] || `CloudKit helper ${result.operation}`,
    ok: result.status === "passed",
    status: result.status,
    operation: result.operation,
    latencyMs,
    readinessStatus: result.readinessStatus,
    evidenceId: redact(result.evidenceId, 160),
    requestHash: redact(result.requestHash, 80),
    accountStatus: redact(result.accountStatus, 80),
    containerReachable: Boolean(result.containerReachable),
    nativeCapabilityCoverageOk: Boolean(result.nativeCapabilityCoverageOk),
    operationCapabilityCoverageOk: Boolean(result.operationCapabilityCoverageOk),
    capabilitiesVerified: result.capabilitiesVerified || [],
    missingNativeCapabilities: result.missingNativeCapabilities || [],
    missingOperationCapabilities: result.missingOperationCapabilities || [],
    roundtrip: result.roundtrip ? {
      created: Boolean(result.roundtrip.created),
      fetched: Boolean(result.roundtrip.fetched),
      deleted: Boolean(result.roundtrip.deleted),
      recordType: redact(result.roundtrip.recordType, 120),
      zone: redact(result.roundtrip.zone, 120),
    } : undefined,
    subscriptionProbe: result.subscriptionProbe ? {
      subscriptionId: redact(result.subscriptionProbe.subscriptionId, 160),
      exists: Boolean(result.subscriptionProbe.exists),
      saved: Boolean(result.subscriptionProbe.saved),
      contentAvailable: Boolean(result.subscriptionProbe.contentAvailable),
      deliveryVerified: Boolean(result.subscriptionProbe.deliveryVerified),
      listenerRequired: result.subscriptionProbe.listenerRequired !== false,
    } : undefined,
    warnings: Array.isArray(result.warnings) ? result.warnings.map((item) => redact(item, 240)) : [],
    errors: Array.isArray(result.errors) ? result.errors.map((item) => redact(item, 240)) : [],
  };
}

function manualAcceptanceSteps() {
  return [
    {
      id: "mac-a-cloudkit-upload",
      title: "Mac A uploads selected LifeOS data through CloudKit",
      instruction: "On the primary Mac, create a small chat, memory, task, generated app state, and device-trust seed; create a SQLite backup; run the guarded CloudKit upload/sync cycle; export diagnostic evidence without raw payloads.",
      required: true,
    },
    {
      id: "mac-b-cloudkit-import",
      title: "Second Mac imports and applies CloudKit changes safely",
      instruction: "On a second Mac signed into the same Apple ID, run CloudKit import/quarantine/apply. Confirm chat, memory, task, generated app state, and device-trust metadata appear only after review and never grant raw device credentials.",
      required: true,
    },
    {
      id: "iphone-cellular-entry-boundary",
      title: "iPhone cellular entry and remote-transport boundary",
      instruction: "Turn off iPhone Wi-Fi, open the iCloud entry from Files, and confirm LifeOS explains whether the saved URL is LAN-only or a trusted HTTPS/Tailscale/Cloudflare entry. iCloud entry sync alone must not be counted as remote connectivity.",
      required: true,
    },
    {
      id: "wifi-cellular-switch",
      title: "iPhone Wi-Fi / cellular switch recovery",
      instruction: "Keep the phone entry open while switching between Wi-Fi and cellular. Confirm queued messages, realtime status, and the recommended entry recover without losing state.",
      required: true,
    },
    {
      id: "mac-restart-recovery",
      title: "Mac restart restores iCloud entry and CloudKit readiness",
      instruction: "Restart the Mac, reopen LifeOS, confirm the iCloud mobile entry is refreshed automatically, run helper probe/subscription checks again, and verify stale QR codes are invalidated.",
      required: true,
    },
    {
      id: "icloud-delay-human-copy",
      title: "iCloud delay uses human recovery copy",
      instruction: "Force or simulate delayed iCloud Drive sync. Confirm the UI says plain-language steps such as waiting for iCloud, opening iPhone Files, regenerating the latest entry, or using the newest entry.",
      required: true,
    },
    {
      id: "old-entry-qr-expiry",
      title: "Old iCloud entry and old QR fail safely",
      instruction: "Open an expired entry and scan an old QR. Confirm they cannot silently bind, the desktop records the event, and the next action is exactly one repair step.",
      required: true,
    },
    {
      id: "multi-desktop-default-entry",
      title: "Multiple Macs choose a stable recommended entry",
      instruction: "Export entries from two Macs, including duplicate computer names. Confirm the phone shows one recommended entry first, puts others in advanced view, and suggests switching when the default fails.",
      required: true,
    },
    {
      id: "cloudkit-background-push",
      title: "Native Apple background push and wakeup evidence",
      instruction: "Run the signed persistent Mac listener, change a selected record on another Apple device, and confirm LifeOS records a matched CloudKit notification plus an immediate safe sync cycle. A saved subscription alone does not pass this step.",
      required: true,
    },
    {
      id: "offline-conflict-review",
      title: "Offline conflict review protects user data",
      instruction: "Edit the same memory/task/generated app state on two Apple devices while offline, reconnect, and confirm LifeOS routes conflicts to review instead of overwriting newer local state.",
      required: true,
    },
  ];
}

function buildRecommendations({ readiness, operations, automatedOk, fullHelperEvidence }) {
  const recommendations = [];
  if (!readiness.ready) recommendations.push(readiness.nextAction);
  if (!operations.includes("roundtrip")) {
    recommendations.push("Run again with --roundtrip or --all after setting LIFEOS_CLOUDKIT_TEST_WRITE_CONFIRM=DELETE_DISPOSABLE_RECORDS to collect disposable write evidence.");
  }
  if (!operations.includes("subscription-probe")) {
    recommendations.push("Run again with --subscription-probe or --all to prove the CloudKit background-push subscription registration prerequisite. Real delivery still needs listener evidence.");
  }
  if (!automatedOk) recommendations.push("Repair failed or skipped automated CloudKit helper checks before starting real Apple-device testing.");
  if (fullHelperEvidence) recommendations.push("Automated helper prerequisites are ready; complete every required real Apple-device manual step before any public claim of real iCloud data sync.");
  recommendations.push("Do not claim end-user-ready background iCloud sync until native Apple clients, background delivery, restart recovery, conflict review, and two-device evidence all pass.");
  return recommendations.filter(Boolean);
}

export async function runIcloudDataSyncAcceptanceRunbook(options = {}) {
  return await withTemporaryEnv(options.env, async () => {
    const operations = selectedOperations(options);
    const readiness = options.readiness || getIcloudDataSyncReadiness({
      platformSupported: options.platformSupported ?? isCloudKitPlatformSupported(),
    });
    const runHelper = options.runHelper || runCloudKitNativeHelper;
    const automatedSteps = [];
    for (const operation of operations) {
      const startedAt = Date.now();
      try {
        const result = await runHelper(readiness, {
          operation,
          timeoutMs: options.timeoutMs,
          now: options.now,
        });
        automatedSteps.push(summarizeHelperResult(result, Date.now() - startedAt));
      } catch (error) {
        automatedSteps.push({
          id: `helper-${operation}`,
          title: helperOperationTitles[operation] || `CloudKit helper ${operation}`,
          ok: false,
          status: "failed",
          operation,
          latencyMs: Date.now() - startedAt,
          errors: [redact(error?.message || error, 300)],
        });
      }
    }
    const automatedOk = automatedSteps.length > 0 && automatedSteps.every((step) => step.ok);
    const fullHelperEvidence = automatedOk && operations.includes("probe") && operations.includes("roundtrip") && operations.includes("subscription-probe");
    const manualAcceptance = manualAcceptanceSteps();
    const completionStatus = !automatedOk
      ? "automated-not-ready"
      : fullHelperEvidence
        ? "automated-ready-manual-required"
        : "helper-prerequisites-partial";
    const report = {
      generatedAt: new Date().toISOString(),
      ok: automatedOk,
      realWorldReady: false,
      completionStatus,
      claimBoundary: "This report can prove selected CloudKit helper prerequisites only. It never proves complete unattended iCloud data sync until every required real Apple-device manual step is recorded and current.",
      readiness: summarizeReadiness(readiness),
      automatedChecks: {
        ok: automatedOk,
        fullHelperEvidence,
        passed: automatedSteps.filter((step) => step.ok).length,
        total: automatedSteps.length,
        operations,
        steps: automatedSteps,
      },
      realWorldAcceptanceRequired: true,
      manualAcceptance,
      recommendations: buildRecommendations({ readiness, operations, automatedOk, fullHelperEvidence }),
    };
    return JSON.parse(JSON.stringify(report));
  });
}

function printHuman(report) {
  const label = report.completionStatus === "automated-ready-manual-required"
    ? "AUTOMATED READY, REAL APPLE TESTS REQUIRED"
    : report.automatedChecks.ok
      ? "PARTIAL HELPER EVIDENCE"
      : "NOT READY";
  console.log(`[${label}] iCloud data sync acceptance`);
  console.log(`Readiness: ${report.readiness.status}`);
  console.log(`Automated checks: ${report.automatedChecks.passed}/${report.automatedChecks.total}`);
  for (const step of report.automatedChecks.steps) {
    console.log(`- ${step.ok ? "PASS" : "FAIL"} ${step.operation}: ${step.status}${step.evidenceId ? ` (${step.evidenceId})` : ""}`);
  }
  console.log("Required real Apple-device checks:");
  for (const step of report.manualAcceptance) {
    console.log(`- ${step.title}: ${step.instruction}`);
  }
  console.log("Recommendations:");
  for (const item of report.recommendations) console.log(`- ${item}`);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const args = parseArgs(process.argv.slice(2));
  runIcloudDataSyncAcceptanceRunbook({
    operations: args.operations,
    all: args.all,
    timeoutMs: args.timeoutMs,
  })
    .then((report) => {
      const outPath = args.out || process.env.LIFEOS_ICLOUD_ACCEPTANCE_OUT || "";
      if (outPath) {
        fs.mkdirSync(path.dirname(path.resolve(outPath)), { recursive: true });
        fs.writeFileSync(outPath, `${JSON.stringify(report, null, 2)}\n`, { mode: 0o600 });
      }
      if (args.json || process.env.LIFEOS_ICLOUD_ACCEPTANCE_JSON === "1") console.log(JSON.stringify(report, null, 2));
      else printHuman(report);
      if (!report.automatedChecks.ok) process.exitCode = 1;
      if (args.strict && report.automatedChecks.ok && report.completionStatus === "helper-prerequisites-partial") process.exitCode = 2;
    })
    .catch((error) => {
      console.error(`[FAIL] ${redact(error?.message || error, 400)}`);
      process.exitCode = 1;
    });
}
