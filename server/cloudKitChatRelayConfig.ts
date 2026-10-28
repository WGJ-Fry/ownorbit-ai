import { getClientState, setClientState } from "./clientState";

export const CLOUDKIT_CHAT_RELAY_CONFIG_STATE_KEY = "lifeos_cloudkit_chat_relay_config";
export const CLOUDKIT_CHAT_RELAY_ZONE = "LifeOSChatRelayZone";
export const CLOUDKIT_CHAT_RELAY_CONTROL_ZONE = "LifeOSChatRelayControlZone";
export const CLOUDKIT_CHAT_RELAY_RECORD_TYPES = [
  "LifeOSDeviceKey",
  "LifeOSChatRequest",
  "LifeOSChatResponse",
  "LifeOSChatReceipt",
] as const;

type CloudKitChatRelayConfigurationSource = "environment" | "sqlite" | "default";

export type CloudKitChatRelayConfig = {
  enabled: boolean;
  mode: "armed_receive_only" | "disabled";
  updatedAt?: number;
  source: CloudKitChatRelayConfigurationSource;
  environmentLocked: boolean;
  privacy: {
    uploadsLocalHistory: false;
    uploadsMemory: false;
    uploadsTasks: false;
    uploadsGeneratedApps: false;
    allowedZone: typeof CLOUDKIT_CHAT_RELAY_ZONE;
    allowedRecordTypes: typeof CLOUDKIT_CHAT_RELAY_RECORD_TYPES;
  };
};

type PersistedCloudKitChatRelayConfig = {
  version: 1;
  enabled: boolean;
  updatedAt: number;
};

function normalizePersistedConfig(value: unknown): PersistedCloudKitChatRelayConfig | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  const raw = value as Record<string, unknown>;
  const updatedAt = Number(raw.updatedAt || 0);
  return {
    version: 1,
    enabled: raw.enabled !== false,
    updatedAt: Number.isFinite(updatedAt) && updatedAt > 0 ? Math.floor(updatedAt) : 0,
  };
}

function privacyBoundary(): CloudKitChatRelayConfig["privacy"] {
  return {
    uploadsLocalHistory: false,
    uploadsMemory: false,
    uploadsTasks: false,
    uploadsGeneratedApps: false,
    allowedZone: CLOUDKIT_CHAT_RELAY_ZONE,
    allowedRecordTypes: CLOUDKIT_CHAT_RELAY_RECORD_TYPES,
  };
}

export function getCloudKitChatRelayConfig(): CloudKitChatRelayConfig {
  const state = getClientState(CLOUDKIT_CHAT_RELAY_CONFIG_STATE_KEY);
  const persisted = normalizePersistedConfig(state?.value);
  const environmentValue = String(process.env.LIFEOS_CLOUDKIT_CHAT_RELAY || "").trim();
  const environmentOverride = environmentValue === "1" || environmentValue === "0";
  const enabled = environmentOverride ? environmentValue === "1" : persisted?.enabled ?? true;
  return {
    enabled,
    mode: enabled ? "armed_receive_only" : "disabled",
    updatedAt: persisted?.updatedAt || state?.updatedAt,
    source: environmentOverride ? "environment" : persisted ? "sqlite" : "default",
    environmentLocked: environmentOverride,
    privacy: privacyBoundary(),
  };
}

export function updateCloudKitChatRelayConfig(
  input: { enabled: boolean },
  actor?: { type: string; id: string },
) {
  const current = getCloudKitChatRelayConfig();
  if (current.environmentLocked) {
    const error = new Error("CloudKit chat relay is managed by LIFEOS_CLOUDKIT_CHAT_RELAY.");
    (error as any).statusCode = 409;
    throw error;
  }
  const persisted: PersistedCloudKitChatRelayConfig = {
    version: 1,
    enabled: Boolean(input.enabled),
    updatedAt: Date.now(),
  };
  setClientState(CLOUDKIT_CHAT_RELAY_CONFIG_STATE_KEY, persisted, actor);
  return getCloudKitChatRelayConfig();
}
