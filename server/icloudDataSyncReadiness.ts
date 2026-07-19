import { accessSync, constants, existsSync, readFileSync } from "fs";
import path from "path";
import { cloudKitNativeHelperContract } from "./cloudKitNativeHelper.ts";
import {
  getBlockedCloudKitDataTypes,
  getCloudKitDataSyncConfig,
  safeCloudKitDataTypes,
  type CloudKitDataSyncConfig,
  type SafeCloudKitDataType,
} from "./cloudKitDataSyncConfig";

const blockedCloudKitDataTypes = ["ai-keys", "device-credentials", "session-cookies", "raw-tokens", "sqlite-database"] as const;

type AcceptanceGateStatus = "passed" | "blocked" | "manual-required";

export type IcloudDataSyncStatus =
  | "not-enabled"
  | "missing-apple-platform"
  | "missing-container"
  | "missing-apple-identity"
  | "missing-native-helper"
  | "missing-entitlements"
  | "no-data-types"
  | "ready-to-test";

const cloudKitRecordPlans: Record<SafeCloudKitDataType, {
  dataType: SafeCloudKitDataType;
  zone: string;
  recordTypes: string[];
  safeFields: string[];
  forbiddenFields: string[];
  mutationModel: string;
  conflictPolicy: string;
  requiresUserReview: boolean;
}> = {
  "chat-history": {
    dataType: "chat-history",
    zone: "LifeOSChatZone",
    recordTypes: ["LifeOSConversation", "LifeOSMessage", "LifeOSChatRequest", "LifeOSChatResponse", "LifeOSSyncCheckpoint"],
    safeFields: ["conversationId", "messageId", "requestId", "responseId", "role", "content", "status", "createdAt", "expiresAt", "mutationId", "logicalClock", "redactionFlags"],
    forbiddenFields: ["aiKey", "providerApiKey", "rawToken", "sessionCookie", "deviceCredential", "sqliteBlob"],
    mutationModel: "Append-only messages plus immutable phone requests and deterministic Mac responses with stable mutation IDs and per-device checkpoints.",
    conflictPolicy: "Chat requests are idempotent by request ID; response updates follow the queued/processing/completed/failed/expired state machine; conversation metadata merges automatically unless local data is newer.",
    requiresUserReview: true,
  },
  memory: {
    dataType: "memory",
    zone: "LifeOSMemoryZone",
    recordTypes: ["LifeOSMemory", "LifeOSMemoryTombstone", "LifeOSSyncCheckpoint"],
    safeFields: ["memoryId", "text", "source", "tags", "createdAt", "updatedAt", "mutationId", "logicalClock"],
    forbiddenFields: ["aiKey", "rawToken", "sessionCookie", "devicePrivateKey", "sqliteDatabase", "backupArchive"],
    mutationModel: "Upserts and tombstones with logical clocks; deletes stay reversible until backup age-out.",
    conflictPolicy: "Metadata can merge conservatively; memory text conflicts go to the review center.",
    requiresUserReview: true,
  },
  tasks: {
    dataType: "tasks",
    zone: "LifeOSTaskZone",
    recordTypes: ["LifeOSTask", "LifeOSTaskTombstone", "LifeOSTaskListSnapshot", "LifeOSSyncCheckpoint"],
    safeFields: ["taskId", "title", "state", "dueAt", "originConnector", "externalRef", "mutationId", "logicalClock"],
    forbiddenFields: ["calendarAccessToken", "reminderCredential", "rawOAuthRefreshToken", "sessionCookie", "deviceCredential"],
    mutationModel: "Guarded task state transitions with stable mutation IDs and reversible tombstones.",
    conflictPolicy: "Completion can move forward automatically; title, due date, and external refs require review.",
    requiresUserReview: true,
  },
  "generated-app-state": {
    dataType: "generated-app-state",
    zone: "LifeOSGeneratedAppZone",
    recordTypes: ["LifeOSGeneratedAppState", "LifeOSGeneratedAppMutation", "LifeOSSyncCheckpoint"],
    safeFields: ["appId", "versionId", "stateJson", "schemaVersion", "mutationId", "createdAt", "updatedAt"],
    forbiddenFields: ["secretEnv", "aiKey", "rawToken", "sessionCookie", "deviceCredential", "localFilePath"],
    mutationModel: "Versioned snapshots plus ordered mutations; conflicting edits create a new candidate version.",
    conflictPolicy: "Never overwrite generated app state silently; compare versions before merging.",
    requiresUserReview: true,
  },
  "device-trust": {
    dataType: "device-trust",
    zone: "LifeOSDeviceTrustZone",
    recordTypes: ["LifeOSDeviceTrust", "LifeOSDeviceKey", "LifeOSSyncCheckpoint"],
    safeFields: ["deviceIdHash", "displayName", "deviceType", "trustState", "publicKeyFingerprint", "accessExpiresAt", "createdAt", "lastSeenAt", "revokedAt", "mutationId", "logicalClock"],
    forbiddenFields: ["accessToken", "accessTokenHash", "rawDeviceCredential", "devicePrivateKey", "sessionCookie", "privateKey", "sqliteDatabase"],
    mutationModel: "Metadata-only device trust snapshots; raw credentials never leave the local device.",
    conflictPolicy: "Imported devices require rebind or explicit trust review before local access is granted.",
    requiresUserReview: true,
  },
};

const requiredNativeCapabilities = [
  "private-database",
  "custom-zones",
  "change-token-fetch",
  "account-status",
  "quota-status",
  "background-sync",
  "delete-tombstones",
  "subscription-push",
] as const;

const credentialBoundary = {
  policy: "CloudKit may mirror reviewable device trust metadata, but it must never grant access or sync login material.",
  safeDataType: "device-trust",
  safeFields: ["deviceIdHash", "displayName", "deviceType", "trustState", "publicKeyFingerprint", "accessExpiresAt", "lastSeenAt", "revokedAt"],
  neverSyncedFields: ["device access token", "device token hash", "raw device credential", "device private key", "session cookie", "private key", "raw public key"],
  importedDeviceAction: "Imported Apple device records stay review-only until the user rebinds the phone or explicitly approves local trust.",
  phoneRecoveryAction: "If a phone loses its local credential, create a new pairing QR and rotate the old device token instead of restoring credentials from iCloud.",
  userFacingSummary: "iCloud can help OwnOrbit remember which Apple device was seen, but it cannot silently log that device in.",
} as const;

function cleanText(value: unknown, limit = 160) {
  return String(value || "").replace(/\s+/g, " ").trim().slice(0, limit);
}

function cleanIdentifier(value: unknown, limit = 120) {
  return cleanText(value, limit).replace(/[^a-zA-Z0-9._:-]+/g, "");
}

function executable(filePath: string) {
  try {
    accessSync(filePath, constants.X_OK);
    return true;
  } catch {
    return false;
  }
}

function readEntitlements(inputPath: string, containerId: string) {
  const resolved = inputPath ? path.resolve(inputPath) : "";
  if (!resolved || !existsSync(resolved)) {
    return {
      path: resolved,
      detected: false,
      mentionsCloudKit: false,
      mentionsContainer: false,
    };
  }
  try {
    const body = readFileSync(resolved, "utf8");
    return {
      path: resolved,
      detected: true,
      mentionsCloudKit: body.includes("com.apple.developer.icloud-container-identifiers") || body.includes("CloudKit"),
      mentionsContainer: Boolean(containerId && body.includes(containerId)),
    };
  } catch {
    return {
      path: resolved,
      detected: true,
      mentionsCloudKit: false,
      mentionsContainer: false,
    };
  }
}

function acceptanceGate(id: string, status: AcceptanceGateStatus, detail: string) {
  return { id, status, detail };
}

export function getIcloudDataSyncReadiness(options: { platformSupported?: boolean; config?: CloudKitDataSyncConfig } = {}) {
  const config = options.config || getCloudKitDataSyncConfig();
  const enabled = config.enabled;
  const containerId = cleanIdentifier(process.env.LIFEOS_CLOUDKIT_CONTAINER_ID);
  const teamId = cleanIdentifier(process.env.LIFEOS_CLOUDKIT_TEAM_ID || process.env.APPLE_TEAM_ID, 40);
  const bundleId = cleanIdentifier(process.env.LIFEOS_CLOUDKIT_BUNDLE_ID || process.env.LIFEOS_APP_BUNDLE_ID);
  const helperPath = cleanText(process.env.LIFEOS_CLOUDKIT_HELPER_BIN, 300);
  const helperResolved = helperPath ? path.resolve(helperPath) : "";
  const helperDetected = Boolean(helperResolved && existsSync(helperResolved));
  const helperExecutable = helperDetected && executable(helperResolved);
  const entitlements = readEntitlements(cleanText(process.env.LIFEOS_CLOUDKIT_ENTITLEMENTS_PATH, 300), containerId);
  const selectedDataTypes = config.selectedDataTypes.filter((item): item is SafeCloudKitDataType => safeCloudKitDataTypes.includes(item));
  const requestedEnvironmentDataTypes = String(process.env.LIFEOS_CLOUDKIT_SYNC_TYPES || "").trim();
  const blockedDataTypes = getBlockedCloudKitDataTypes(requestedEnvironmentDataTypes)
    .filter((item) => blockedCloudKitDataTypes.includes(item as typeof blockedCloudKitDataTypes[number]));
  const nativeHelper = {
    configured: Boolean(helperPath),
    detected: helperDetected,
    executable: helperExecutable,
    path: helperResolved,
  };
  const selectedRecordPlan = enabled ? selectedDataTypes.map((dataType) => cloudKitRecordPlans[dataType]) : [];

  let setupStatus: Exclude<IcloudDataSyncStatus, "not-enabled"> = "ready-to-test";
  if (options.platformSupported === false) setupStatus = "missing-apple-platform";
  else if (!containerId) setupStatus = "missing-container";
  else if (!teamId || !bundleId) setupStatus = "missing-apple-identity";
  else if (!helperExecutable) setupStatus = "missing-native-helper";
  else if (!entitlements.detected || !entitlements.mentionsCloudKit || !entitlements.mentionsContainer) setupStatus = "missing-entitlements";
  else if (selectedDataTypes.length === 0) setupStatus = "no-data-types";

  const setupReady = setupStatus === "ready-to-test";
  const status: IcloudDataSyncStatus = enabled ? setupStatus : "not-enabled";

  const ready = status === "ready-to-test";
  const nextActionByStatus: Record<IcloudDataSyncStatus, string> = {
    "not-enabled": setupReady
      ? "Native CloudKit prerequisites are ready. Enable private iCloud data sync from the admin console when the user opts in."
      : "Finish the native CloudKit prerequisite shown by setupStatus, then enable private iCloud data sync from the admin console.",
    "missing-apple-platform": "Run the native CloudKit sync helper from macOS or iOS with iCloud entitlements.",
    "missing-container": "Create an iCloud Container in Apple Developer and set LIFEOS_CLOUDKIT_CONTAINER_ID.",
    "missing-apple-identity": "Set LIFEOS_CLOUDKIT_TEAM_ID and LIFEOS_CLOUDKIT_BUNDLE_ID for the signed Apple app.",
    "missing-native-helper": "Build or configure the native CloudKit helper and set LIFEOS_CLOUDKIT_HELPER_BIN.",
    "missing-entitlements": "Point LIFEOS_CLOUDKIT_ENTITLEMENTS_PATH at entitlements that include the CloudKit container.",
    "no-data-types": "Set LIFEOS_CLOUDKIT_SYNC_TYPES to one or more safe types: chat-history, memory, tasks, generated-app-state, device-trust.",
    "ready-to-test": "Run the native helper acceptance test before claiming real iCloud data sync.",
  };

  const entitlementReady = entitlements.detected && entitlements.mentionsCloudKit && entitlements.mentionsContainer;
  return {
    enabled,
    ready,
    setupReady,
    setupStatus,
    mode: enabled ? "cloudkit-native" as const : "handoff-only" as const,
    status,
    severity: ready ? "warning" as const : enabled ? "danger" as const : "warning" as const,
    dataSyncScope: ready ? "cloudkit-native-candidate" as const : "entry-file-only" as const,
    containerId,
    teamIdConfigured: Boolean(teamId),
    bundleId,
    nativeHelper,
    entitlements,
    selectedDataTypes,
    configuration: {
      enabledSource: config.enabledSource,
      dataTypesSource: config.dataTypesSource,
      environmentLocked: config.environmentLocked,
      updatedAt: config.updatedAt || null,
    },
    blockedDataTypes,
    blockedDataTypePolicy: "Never sync AI keys, raw device credentials, session cookies, raw tokens, or whole SQLite databases through CloudKit user records.",
    notSyncedDataTypes: ["ai-keys", "device-credentials", "session-cookies", "raw-tokens", "sqlite-database"],
    credentialBoundary,
    recordPlan: selectedRecordPlan,
    requiredNativeCapabilities: enabled ? [...requiredNativeCapabilities] : [],
    nativeHelperContract: cloudKitNativeHelperContract(),
    acceptanceGates: [
      acceptanceGate("explicit-opt-in", enabled ? "passed" : "blocked", enabled ? "CloudKit data sync is explicitly enabled." : "Enable private iCloud data sync from the admin console only after the user opts in."),
      acceptanceGate("apple-platform", options.platformSupported === false ? "blocked" : "passed", options.platformSupported === false ? "CloudKit sync requires macOS or iOS native runtime." : "Apple native runtime is available or not blocked by this check."),
      acceptanceGate("cloudkit-container", containerId ? "passed" : "blocked", containerId ? "CloudKit container id is configured." : "Create an iCloud Container and set LIFEOS_CLOUDKIT_CONTAINER_ID."),
      acceptanceGate("apple-identity", teamId && bundleId ? "passed" : "blocked", teamId && bundleId ? "Team and bundle identifiers are configured." : "Set LIFEOS_CLOUDKIT_TEAM_ID and LIFEOS_CLOUDKIT_BUNDLE_ID."),
      acceptanceGate("native-helper", helperExecutable ? "passed" : "blocked", helperExecutable ? "Native helper is detected and executable." : "Build a signed CloudKit helper and set LIFEOS_CLOUDKIT_HELPER_BIN."),
      acceptanceGate("entitlements", entitlementReady ? "passed" : "blocked", entitlementReady ? "Entitlements mention CloudKit and the selected container." : "Point LIFEOS_CLOUDKIT_ENTITLEMENTS_PATH at CloudKit entitlements for this container."),
      acceptanceGate("safe-data-types", selectedDataTypes.length ? "passed" : "blocked", selectedDataTypes.length ? "At least one safe data class is selected." : "Choose safe data types such as chat-history, memory, tasks, generated-app-state, or device-trust."),
      acceptanceGate("blocked-types-filtered", blockedDataTypes.length ? "manual-required" : "passed", blockedDataTypes.length ? "Unsafe requested data types were filtered and must be removed before release." : "No unsafe data type was requested."),
      acceptanceGate("credential-boundary", "passed", "Device credentials, access tokens, private keys, and session material are never synced; CloudKit device trust records are review-only metadata."),
      acceptanceGate("backup-before-first-sync", setupReady ? "manual-required" : "blocked", setupReady ? "A redacted local SQLite backup will be created automatically before first CloudKit write." : "Backup gate opens only after native CloudKit readiness passes."),
      acceptanceGate("helper-roundtrip", setupReady ? "manual-required" : "blocked", setupReady ? "Run a native helper create/fetch/delete roundtrip in the private CloudKit database." : "Roundtrip gate opens only after native CloudKit readiness passes."),
      acceptanceGate("redaction-proof", selectedDataTypes.length ? "manual-required" : "blocked", selectedDataTypes.length ? "Prove selected records do not include keys, tokens, credentials, cookies, or SQLite blobs." : "Redaction proof requires at least one selected data class."),
    ],
    requiresNativeAppleClient: true,
    requiresCloudKitContainer: true,
    requiresExplicitUserOptIn: true,
    nextAction: nextActionByStatus[status],
  };
}
