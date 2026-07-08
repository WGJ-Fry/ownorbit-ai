import { accessSync, constants, existsSync, readFileSync } from "fs";
import path from "path";

const safeCloudKitDataTypes = ["chat-history", "memory", "tasks", "generated-app-state"] as const;
const blockedCloudKitDataTypes = ["ai-keys", "device-credentials", "session-cookies", "raw-tokens", "sqlite-database"] as const;

export type IcloudDataSyncStatus =
  | "not-enabled"
  | "missing-apple-platform"
  | "missing-container"
  | "missing-apple-identity"
  | "missing-native-helper"
  | "missing-entitlements"
  | "no-data-types"
  | "ready-to-test";

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
    requiresNativeAppleClient: true,
    requiresCloudKitContainer: true,
    requiresExplicitUserOptIn: true,
    nextAction: nextActionByStatus[status],
  };
}
