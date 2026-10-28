import { getCloudKitDataSyncConfig } from "./cloudKitDataSyncConfig";
import {
  CLOUDKIT_CHAT_RELAY_RECORD_TYPES,
  CLOUDKIT_CHAT_RELAY_ZONE,
  getCloudKitChatRelayConfig,
} from "./cloudKitChatRelayConfig";
import { getIcloudDataSyncReadiness } from "./icloudDataSyncReadiness";

const relayRecordPlan = {
  dataType: "chat-relay",
  zone: CLOUDKIT_CHAT_RELAY_ZONE,
  recordTypes: [...CLOUDKIT_CHAT_RELAY_RECORD_TYPES],
  safeFields: [
    "deviceId",
    "deviceIdHash",
    "publicKey",
    "publicKeyFingerprint",
    "requestId",
    "conversationId",
    "userMessageId",
    "prompt",
    "locale",
    "status",
    "signature",
    "createdAt",
    "expiresAt",
    "responseId",
    "assistantMessageId",
    "text",
    "safeErrorCode",
    "providerLabel",
    "modelLabel",
    "requestContentHash",
    "updatedAt",
  ],
  forbiddenFields: [
    "aiKey",
    "providerApiKey",
    "rawToken",
    "sessionCookie",
    "deviceCredential",
    "devicePrivateKey",
    "sqliteBlob",
    "memory",
    "tasks",
    "generatedApps",
  ],
  mutationModel: "Immutable signed iPhone request records and deterministic Mac response records.",
  conflictPolicy: "Device keys and requests are immutable by content hash; responses advance through a bounded job state machine.",
  requiresUserReview: false,
} as const;

export function getCloudKitChatRelayReadiness(options: { platformSupported?: boolean } = {}) {
  const relay = getCloudKitChatRelayConfig();
  const fullConfig = getCloudKitDataSyncConfig();
  const prerequisite = getIcloudDataSyncReadiness({
    platformSupported: options.platformSupported,
    config: {
      ...fullConfig,
      enabled: true,
      selectedDataTypes: ["chat-history"],
    },
  });
  const ready = relay.enabled && prerequisite.setupReady;
  return {
    ...prerequisite,
    enabled: relay.enabled,
    ready,
    status: relay.enabled ? prerequisite.setupStatus : "not-enabled",
    mode: relay.mode,
    dataSyncScope: "chat-relay-only",
    selectedDataTypes: relay.enabled ? ["chat-relay"] : [],
    recordPlan: relay.enabled ? [{ ...relayRecordPlan }] : [],
    configuration: {
      source: relay.source,
      environmentLocked: relay.environmentLocked,
      updatedAt: relay.updatedAt || null,
    },
    privacy: relay.privacy,
    blockedDataTypes: [
      "chat-history",
      "memory",
      "tasks",
      "generated-app-state",
      "device-trust",
      "ai-keys",
      "device-credentials",
      "session-cookies",
      "raw-tokens",
      "sqlite-database",
    ],
    notSyncedDataTypes: [
      "chat-history",
      "memory",
      "tasks",
      "generated-app-state",
      "device-trust",
      "ai-keys",
      "device-credentials",
      "session-cookies",
      "raw-tokens",
      "sqlite-database",
    ],
    blockedDataTypePolicy: "The chat relay accepts only one signed iPhone prompt and its matching response. It never mirrors local history, memory, tasks, generated apps, credentials, or SQLite.",
    nextAction: !relay.enabled
      ? "Enable the private iPhone chat relay."
      : ready
      ? "The private iPhone chat relay is ready."
      : prerequisite.nextAction,
  };
}

export type CloudKitChatRelayReadiness = ReturnType<typeof getCloudKitChatRelayReadiness>;
