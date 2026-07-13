import { getClientState, setClientState } from "./clientState";

export const CLOUDKIT_DATA_SYNC_CONFIG_STATE_KEY = "lifeos_cloudkit_data_sync_config";
export const CLOUDKIT_DATA_SYNC_ENABLE_CONFIRMATION = "ENABLE_PRIVATE_ICLOUD_SYNC";
export const CLOUDKIT_DATA_SYNC_DISABLE_CONFIRMATION = "DISABLE_PRIVATE_ICLOUD_SYNC";

export const safeCloudKitDataTypes = [
  "chat-history",
  "memory",
  "tasks",
  "generated-app-state",
  "device-trust",
] as const;

export type SafeCloudKitDataType = typeof safeCloudKitDataTypes[number];
export type CloudKitDataSyncConfigurationSource = "environment" | "sqlite" | "default";

export type CloudKitDataSyncConfig = {
  enabled: boolean;
  selectedDataTypes: SafeCloudKitDataType[];
  updatedAt?: number;
  enabledSource: CloudKitDataSyncConfigurationSource;
  dataTypesSource: CloudKitDataSyncConfigurationSource;
  environmentLocked: boolean;
};

type PersistedCloudKitDataSyncConfig = {
  version: 1;
  enabled: boolean;
  selectedDataTypes: SafeCloudKitDataType[];
  updatedAt: number;
};

function splitDataTypes(value: unknown) {
  if (Array.isArray(value)) return value.map((item) => String(item || "").trim().toLowerCase()).filter(Boolean);
  return String(value || "")
    .split(",")
    .map((item) => item.trim().toLowerCase())
    .filter(Boolean);
}

export function normalizeCloudKitDataTypes(value: unknown): SafeCloudKitDataType[] {
  return Array.from(new Set(splitDataTypes(value).filter((item): item is SafeCloudKitDataType => (
    safeCloudKitDataTypes.includes(item as SafeCloudKitDataType)
  ))));
}

export function getBlockedCloudKitDataTypes(value: unknown) {
  return Array.from(new Set(splitDataTypes(value).filter((item) => !safeCloudKitDataTypes.includes(item as SafeCloudKitDataType))));
}

function normalizePersistedConfig(value: unknown): PersistedCloudKitDataSyncConfig | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  const raw = value as Record<string, unknown>;
  const selectedDataTypes = normalizeCloudKitDataTypes(raw.selectedDataTypes);
  const updatedAt = Number(raw.updatedAt || 0);
  return {
    version: 1,
    enabled: Boolean(raw.enabled),
    selectedDataTypes: selectedDataTypes.length ? selectedDataTypes : [...safeCloudKitDataTypes],
    updatedAt: Number.isFinite(updatedAt) && updatedAt > 0 ? Math.floor(updatedAt) : 0,
  };
}

export function getCloudKitDataSyncConfig(): CloudKitDataSyncConfig {
  const state = getClientState(CLOUDKIT_DATA_SYNC_CONFIG_STATE_KEY);
  const persisted = normalizePersistedConfig(state?.value);
  const enabledEnvironmentValue = String(process.env.LIFEOS_ICLOUD_DATA_SYNC || "").trim();
  const enabledEnvironmentOverride = enabledEnvironmentValue === "1" || enabledEnvironmentValue === "0";
  const dataTypesEnvironmentValue = String(process.env.LIFEOS_CLOUDKIT_SYNC_TYPES || "").trim();
  const dataTypesEnvironmentOverride = Boolean(dataTypesEnvironmentValue);
  const environmentDataTypes = normalizeCloudKitDataTypes(dataTypesEnvironmentValue);

  return {
    enabled: enabledEnvironmentOverride ? enabledEnvironmentValue === "1" : persisted?.enabled || false,
    selectedDataTypes: dataTypesEnvironmentOverride
      ? environmentDataTypes
      : persisted?.selectedDataTypes || [...safeCloudKitDataTypes],
    updatedAt: persisted?.updatedAt || state?.updatedAt,
    enabledSource: enabledEnvironmentOverride ? "environment" : persisted ? "sqlite" : "default",
    dataTypesSource: dataTypesEnvironmentOverride ? "environment" : persisted ? "sqlite" : "default",
    environmentLocked: enabledEnvironmentOverride || dataTypesEnvironmentOverride,
  };
}

export function updateCloudKitDataSyncConfig(
  input: { enabled: boolean; selectedDataTypes?: unknown },
  actor?: { type: string; id: string },
) {
  const current = getCloudKitDataSyncConfig();
  if (current.environmentLocked) {
    const error = new Error("CloudKit data sync is managed by environment variables and cannot be changed in the UI.");
    (error as any).statusCode = 409;
    throw error;
  }

  const requested = input.selectedDataTypes === undefined ? current.selectedDataTypes : input.selectedDataTypes;
  const blockedDataTypes = getBlockedCloudKitDataTypes(requested);
  if (blockedDataTypes.length) {
    const error = new Error("CloudKit data sync includes unsupported or sensitive data types.");
    (error as any).statusCode = 400;
    (error as any).blockedDataTypes = blockedDataTypes;
    throw error;
  }
  const selectedDataTypes = normalizeCloudKitDataTypes(requested);
  if (!selectedDataTypes.length) {
    const error = new Error("Choose at least one safe CloudKit data type.");
    (error as any).statusCode = 400;
    throw error;
  }

  const persisted: PersistedCloudKitDataSyncConfig = {
    version: 1,
    enabled: Boolean(input.enabled),
    selectedDataTypes,
    updatedAt: Date.now(),
  };
  setClientState(CLOUDKIT_DATA_SYNC_CONFIG_STATE_KEY, persisted, actor);
  return getCloudKitDataSyncConfig();
}
