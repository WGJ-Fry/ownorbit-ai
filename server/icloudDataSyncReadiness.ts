import { accessSync, constants, existsSync, readFileSync } from "fs";
import path from "path";

const safeCloudKitDataTypes = ["chat-history", "memory", "tasks", "generated-app-state"] as const;
const blockedCloudKitDataTypes = ["ai-keys", "device-credentials", "session-cookies", "raw-tokens", "sqlite-database"] as const;

type SafeCloudKitDataType = typeof safeCloudKitDataTypes[number];
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
    recordTypes: ["LifeOSConversation", "LifeOSMessage", "LifeOSSyncCheckpoint"],
    safeFields: ["conversationId", "messageId", "role", "content", "createdAt", "mutationId", "logicalClock", "redactionFlags"],
    forbiddenFields: ["aiKey", "providerApiKey", "rawToken", "sessionCookie", "deviceCredential", "sqliteBlob"],
    mutationModel: "Append-only messages with stable mutation IDs and per-device checkpoints.",
    conflictPolicy: "Message mutations are idempotent; conversation title and metadata conflicts require review.",
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
    recordTypes: ["LifeOSTask", "LifeOSTaskTombstone", "LifeOSSyncCheckpoint"],
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

function cleanText(value: unknown, limit = 160) {
  return String(value || "").replace(/\s+/g, " ").trim().slice(0, limit);
}

function cleanIdentifier(value: unknown, limit = 120) {
  return cleanText(value, limit).replace(/[^a-zA-Z0-9._:-]+/g, "");
}

function splitDataTypes(value: unknown) {
  return String(value || "")
    .split(",")
    .map((item) => item.trim().toLowerCase())
    .filter(Boolean);
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

export function getIcloudDataSyncReadiness(options: { platformSupported?: boolean } = {}) {
  const enabled = process.env.LIFEOS_ICLOUD_DATA_SYNC === "1";
  const containerId = cleanIdentifier(process.env.LIFEOS_CLOUDKIT_CONTAINER_ID);
  const teamId = cleanIdentifier(process.env.LIFEOS_CLOUDKIT_TEAM_ID || process.env.APPLE_TEAM_ID, 40);
  const bundleId = cleanIdentifier(process.env.LIFEOS_CLOUDKIT_BUNDLE_ID || process.env.LIFEOS_APP_BUNDLE_ID);
  const helperPath = cleanText(process.env.LIFEOS_CLOUDKIT_HELPER_BIN, 300);
  const helperResolved = helperPath ? path.resolve(helperPath) : "";
  const helperDetected = Boolean(helperResolved && existsSync(helperResolved));
  const helperExecutable = helperDetected && executable(helperResolved);
  const entitlements = readEntitlements(cleanText(process.env.LIFEOS_CLOUDKIT_ENTITLEMENTS_PATH, 300), containerId);
  const requestedDataTypes = splitDataTypes(process.env.LIFEOS_CLOUDKIT_SYNC_TYPES);
  const selectedDataTypes = requestedDataTypes.filter((item): item is typeof safeCloudKitDataTypes[number] => (
    safeCloudKitDataTypes.includes(item as typeof safeCloudKitDataTypes[number])
  ));
  const blockedDataTypes = requestedDataTypes.filter((item) => blockedCloudKitDataTypes.includes(item as typeof blockedCloudKitDataTypes[number]));
  const nativeHelper = {
    configured: Boolean(helperPath),
    detected: helperDetected,
    executable: helperExecutable,
    path: helperResolved,
  };
  const selectedRecordPlan = enabled ? selectedDataTypes.map((dataType) => cloudKitRecordPlans[dataType]) : [];

  let status: IcloudDataSyncStatus = "not-enabled";
  if (enabled && options.platformSupported === false) status = "missing-apple-platform";
  else if (enabled && !containerId) status = "missing-container";
  else if (enabled && (!teamId || !bundleId)) status = "missing-apple-identity";
  else if (enabled && !helperExecutable) status = "missing-native-helper";
  else if (enabled && (!entitlements.detected || !entitlements.mentionsCloudKit || !entitlements.mentionsContainer)) status = "missing-entitlements";
  else if (enabled && selectedDataTypes.length === 0) status = "no-data-types";
  else if (enabled) status = "ready-to-test";

  const ready = status === "ready-to-test";
  const nextActionByStatus: Record<IcloudDataSyncStatus, string> = {
    "not-enabled": "Keep using iCloud handoff for the phone entry, or opt in with LIFEOS_ICLOUD_DATA_SYNC=1 when native CloudKit work starts.",
    "missing-apple-platform": "Run the native CloudKit sync helper from macOS or iOS with iCloud entitlements.",
    "missing-container": "Create an iCloud Container in Apple Developer and set LIFEOS_CLOUDKIT_CONTAINER_ID.",
    "missing-apple-identity": "Set LIFEOS_CLOUDKIT_TEAM_ID and LIFEOS_CLOUDKIT_BUNDLE_ID for the signed Apple app.",
    "missing-native-helper": "Build or configure the native CloudKit helper and set LIFEOS_CLOUDKIT_HELPER_BIN.",
    "missing-entitlements": "Point LIFEOS_CLOUDKIT_ENTITLEMENTS_PATH at entitlements that include the CloudKit container.",
    "no-data-types": "Set LIFEOS_CLOUDKIT_SYNC_TYPES to one or more safe types: chat-history, memory, tasks, generated-app-state.",
    "ready-to-test": "Run the native helper acceptance test before claiming real iCloud data sync.",
  };

  const entitlementReady = entitlements.detected && entitlements.mentionsCloudKit && entitlements.mentionsContainer;
  return {
    enabled,
    ready,
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
    blockedDataTypes,
    blockedDataTypePolicy: "Never sync AI keys, raw device credentials, session cookies, raw tokens, or whole SQLite databases through CloudKit user records.",
    notSyncedDataTypes: ["ai-keys", "device-credentials", "session-cookies", "raw-tokens", "sqlite-database"],
    recordPlan: selectedRecordPlan,
    requiredNativeCapabilities: enabled ? [...requiredNativeCapabilities] : [],
    acceptanceGates: [
      acceptanceGate("explicit-opt-in", enabled ? "passed" : "blocked", enabled ? "CloudKit data sync is explicitly enabled." : "Set LIFEOS_ICLOUD_DATA_SYNC=1 only after the user opts in."),
      acceptanceGate("apple-platform", options.platformSupported === false ? "blocked" : "passed", options.platformSupported === false ? "CloudKit sync requires macOS or iOS native runtime." : "Apple native runtime is available or not blocked by this check."),
      acceptanceGate("cloudkit-container", containerId ? "passed" : "blocked", containerId ? "CloudKit container id is configured." : "Create an iCloud Container and set LIFEOS_CLOUDKIT_CONTAINER_ID."),
      acceptanceGate("apple-identity", teamId && bundleId ? "passed" : "blocked", teamId && bundleId ? "Team and bundle identifiers are configured." : "Set LIFEOS_CLOUDKIT_TEAM_ID and LIFEOS_CLOUDKIT_BUNDLE_ID."),
      acceptanceGate("native-helper", helperExecutable ? "passed" : "blocked", helperExecutable ? "Native helper is detected and executable." : "Build a signed CloudKit helper and set LIFEOS_CLOUDKIT_HELPER_BIN."),
      acceptanceGate("entitlements", entitlementReady ? "passed" : "blocked", entitlementReady ? "Entitlements mention CloudKit and the selected container." : "Point LIFEOS_CLOUDKIT_ENTITLEMENTS_PATH at CloudKit entitlements for this container."),
      acceptanceGate("safe-data-types", selectedDataTypes.length ? "passed" : "blocked", selectedDataTypes.length ? "At least one safe data class is selected." : "Choose safe data types such as chat-history, memory, tasks, or generated-app-state."),
      acceptanceGate("blocked-types-filtered", blockedDataTypes.length ? "manual-required" : "passed", blockedDataTypes.length ? "Unsafe requested data types were filtered and must be removed before release." : "No unsafe data type was requested."),
      acceptanceGate("backup-before-first-sync", ready ? "manual-required" : "blocked", ready ? "Create and verify a local SQLite backup before first CloudKit write." : "Backup gate opens only after native CloudKit readiness passes."),
      acceptanceGate("helper-roundtrip", ready ? "manual-required" : "blocked", ready ? "Run a native helper create/fetch/delete roundtrip in the private CloudKit database." : "Roundtrip gate opens only after native CloudKit readiness passes."),
      acceptanceGate("redaction-proof", selectedDataTypes.length ? "manual-required" : "blocked", selectedDataTypes.length ? "Prove selected records do not include keys, tokens, credentials, cookies, or SQLite blobs." : "Redaction proof requires at least one selected data class."),
    ],
    requiresNativeAppleClient: true,
    requiresCloudKitContainer: true,
    requiresExplicitUserOptIn: true,
    nextAction: nextActionByStatus[status],
  };
}
