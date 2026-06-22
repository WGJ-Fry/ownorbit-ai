import crypto from "crypto";
import fs from "fs";
import path from "path";
import { db, dataDir } from "./db";
import { getClientState, setClientState } from "./clientState";

const keyPath = path.join(dataDir, "lifeos-secret.key");
const aiModelStateKey = "lifeos_ai_provider_models";
const activeAiProviderStateKey = "lifeos_active_ai_provider";
const legacyByokProviderStateKey = "lifeos_byok_provider";
const legacyModelEngineStateKey = "lifeos_model_engine";
export const aiProviders = [
  {
    id: "gemini",
    name: "Google Gemini",
    envVar: "GEMINI_API_KEY",
    secretId: "ai.google_gemini.api_key",
    enabled: true,
    defaultModel: "gemini-3.5-flash",
    models: ["gemini-3.5-flash", "gemini-1.5-pro"],
  },
  {
    id: "openai",
    name: "OpenAI",
    envVar: "OPENAI_API_KEY",
    secretId: "ai.openai.api_key",
    enabled: true,
    defaultModel: "gpt-4o-mini",
    models: ["gpt-4o-mini", "gpt-4o"],
  },
  {
    id: "openrouter",
    name: "OpenRouter",
    envVar: "OPENROUTER_API_KEY",
    secretId: "ai.openrouter.api_key",
    enabled: true,
    defaultModel: "openai/gpt-4o-mini",
    models: ["openai/gpt-4o-mini", "anthropic/claude-3.5-sonnet"],
  },
  {
    id: "local",
    name: "Local Model",
    envVar: "LOCAL_MODEL_BASE_URL",
    secretId: "ai.local_model.endpoint",
    enabled: true,
    defaultModel: "llama3.2",
    models: ["llama3.2", "llama3.2:1b", "llama3.1", "qwen2.5", "mistral"],
  },
] as const;

export type AiProviderId = typeof aiProviders[number]["id"];

type SecretStorageKind = "electron_safe_storage" | "local_aes_gcm";

type EncryptedSecret = {
  ciphertext: string;
  iv: string;
  tag: string;
  storage: SecretStorageKind;
};

function getElectronSafeStorage() {
  try {
    if (!process.versions.electron) return null;
    if (typeof require !== "function") return null;
    const electron = require("electron");
    const safeStorage = typeof electron === "object" ? electron.safeStorage : null;
    if (!safeStorage?.isEncryptionAvailable?.()) return null;
    return safeStorage as {
      encryptString(value: string): Buffer;
      decryptString(value: Buffer): string;
      isEncryptionAvailable(): boolean;
    };
  } catch {
    return null;
  }
}

function canUseElectronSafeStorageStatus() {
  return Boolean(process.versions.electron);
}

function getPreferredSecretStorage(): SecretStorageKind {
  return canUseElectronSafeStorageStatus() ? "electron_safe_storage" : "local_aes_gcm";
}

function getSecretStorageLabel(storage: SecretStorageKind) {
  return storage === "electron_safe_storage" ? getSystemSecureStoreName() : "Local AES-GCM encrypted file";
}

function getSystemSecureStoreName(platform = process.platform) {
  if (platform === "darwin") return "macOS Keychain";
  if (platform === "win32") return "Windows system credential store";
  if (platform === "linux") return "Linux Secret Service";
  return "System secure storage";
}

function getSecretStorageStatus(row?: { secret_storage?: SecretStorageKind } | null) {
  const preferred = getPreferredSecretStorage();
  const current = row?.secret_storage as SecretStorageKind | undefined;
  const systemAvailable = preferred === "electron_safe_storage";
  return {
    preferred,
    current,
    label: getSecretStorageLabel(current || preferred),
    systemAvailable,
    systemName: getSystemSecureStoreName(),
    fallbackLabel: "Local AES-GCM encrypted file",
    fallbackActive: current === "local_aes_gcm" || (!current && !systemAvailable),
    migrationRecommended: Boolean(current === "local_aes_gcm" && systemAvailable),
  };
}

function getProvider(providerId: string) {
  return aiProviders.find((provider) => provider.id === providerId);
}

export function getActiveAiProviderId(): AiProviderId {
  const envProvider = process.env.LIFEOS_ACTIVE_AI_PROVIDER;
  if (envProvider && getProvider(envProvider)) {
    return envProvider as AiProviderId;
  }
  if (process.env.LOCAL_MODEL_BASE_URL) {
    return "local";
  }
  const state = getClientState(activeAiProviderStateKey)?.value;
  return typeof state === "string" && getProvider(state) ? state as AiProviderId : "gemini";
}

export function saveActiveAiProvider(providerId: AiProviderId, actor?: { type: string; id: string }) {
  const provider = getProvider(providerId);
  if (!provider) throw new Error("Unknown AI provider");
  setClientState(activeAiProviderStateKey, providerId, actor);
  syncLegacyAiRuntimeState(providerId, getSelectedAiModel(providerId), actor);
  return providerId;
}

function getAiModelState() {
  const state = getClientState(aiModelStateKey)?.value;
  return state && typeof state === "object" && !Array.isArray(state)
    ? state as Partial<Record<AiProviderId, string>>
    : {};
}

export function getAiProviderModelCatalog(providerId: AiProviderId) {
  const provider = getProvider(providerId);
  if (!provider) throw new Error("Unknown AI provider");
  return [...provider.models];
}

export function getDefaultAiModel(providerId: AiProviderId) {
  const provider = getProvider(providerId);
  if (!provider) throw new Error("Unknown AI provider");
  return provider.defaultModel;
}

export function isAllowedAiModel(providerId: AiProviderId, model: string) {
  const provider = getProvider(providerId);
  const normalized = model.trim();
  if (!provider || normalized.length < 2 || normalized.length > 120) return false;
  if (provider.id === "local") {
    return /^[a-zA-Z0-9._:/@-]+$/.test(normalized);
  }
  return (provider.models as readonly string[]).includes(normalized);
}

export function getSelectedAiModel(providerId: AiProviderId) {
  if (providerId === "local") {
    const envModel = process.env.LIFEOS_LOCAL_MODEL_NAME || process.env.LOCAL_MODEL_NAME;
    if (envModel && isAllowedAiModel(providerId, envModel)) {
      return envModel.trim();
    }
  }
  const state = getAiModelState();
  const selected = state[providerId];
  return selected && isAllowedAiModel(providerId, selected) ? selected : getDefaultAiModel(providerId);
}

export function saveSelectedAiModel(providerId: AiProviderId, model: string, actor?: { type: string; id: string }) {
  const normalized = model.trim();
  if (!isAllowedAiModel(providerId, normalized)) throw new Error("Unsupported AI model");
  setClientState(aiModelStateKey, { ...getAiModelState(), [providerId]: normalized }, actor);
  if (getActiveAiProviderId() === providerId) {
    syncLegacyAiRuntimeState(providerId, normalized, actor);
  }
  return getAiProviderStatus(providerId);
}

function syncLegacyAiRuntimeState(providerId: AiProviderId, model: string, actor?: { type: string; id: string }) {
  const provider = getProvider(providerId);
  if (!provider) throw new Error("Unknown AI provider");
  setClientState(legacyByokProviderStateKey, provider.name, actor);
  setClientState(legacyModelEngineStateKey, model, actor);
}

function getMasterKey() {
  if (process.env.LIFEOS_SECRET_KEY) {
    return crypto.createHash("sha256").update(process.env.LIFEOS_SECRET_KEY).digest();
  }

  if (!fs.existsSync(keyPath)) {
    fs.writeFileSync(keyPath, crypto.randomBytes(32).toString("base64url"), { mode: 0o600 });
  }
  return crypto.createHash("sha256").update(fs.readFileSync(keyPath, "utf8")).digest();
}

function encryptSecret(value: string): EncryptedSecret {
  const safeStorage = getElectronSafeStorage();
  if (safeStorage) {
    return {
      ciphertext: safeStorage.encryptString(value).toString("base64url"),
      iv: "electron_safe_storage",
      tag: "",
      storage: "electron_safe_storage",
    };
  }

  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", getMasterKey(), iv);
  const ciphertext = Buffer.concat([cipher.update(value, "utf8"), cipher.final()]);
  return {
    ciphertext: ciphertext.toString("base64url"),
    iv: iv.toString("base64url"),
    tag: cipher.getAuthTag().toString("base64url"),
    storage: "local_aes_gcm",
  };
}

function normalizeProviderCredential(providerId: AiProviderId, value: string) {
  const credential = value.trim();
  if (providerId !== "local") return credential;

  let parsed: URL;
  try {
    parsed = new URL(credential);
  } catch {
    throw new Error("Local model endpoint must be a valid HTTP/HTTPS URL");
  }
  if (!["http:", "https:"].includes(parsed.protocol)) {
    throw new Error("Local model endpoint must use HTTP or HTTPS");
  }
  if (parsed.username || parsed.password || parsed.search || parsed.hash) {
    throw new Error("Local model endpoint must not contain credentials, query strings, or fragments");
  }
  return parsed.toString().replace(/\/$/, "");
}

function decryptSecret(row: any) {
  if (row.secret_storage === "electron_safe_storage") {
    const safeStorage = getElectronSafeStorage();
    if (!safeStorage) {
      throw new Error("System secure storage is unavailable. Open LifeOS AI from the desktop app on this computer.");
    }
    return safeStorage.decryptString(Buffer.from(row.ciphertext, "base64url"));
  }

  const decipher = crypto.createDecipheriv("aes-256-gcm", getMasterKey(), Buffer.from(row.iv, "base64url"));
  decipher.setAuthTag(Buffer.from(row.auth_tag, "base64url"));
  return Buffer.concat([
    decipher.update(Buffer.from(row.ciphertext, "base64url")),
    decipher.final(),
  ]).toString("utf8");
}

export function getStoredAiApiKey(providerId: AiProviderId = "gemini") {
  const provider = getProvider(providerId);
  if (!provider) return "";
  const row = db.prepare("SELECT * FROM app_secrets WHERE id = ?").get(provider.secretId) as any;
  return row ? decryptSecret(row) : "";
}

export function getAiApiKey(providerId: AiProviderId = "gemini") {
  const provider = getProvider(providerId);
  if (!provider) return "";
  return process.env[provider.envVar] || getStoredAiApiKey(providerId);
}

export function getAiProviderStatus(providerId: AiProviderId) {
  const provider = getProvider(providerId);
  if (!provider) throw new Error("Unknown AI provider");
  const activeProviderId = getActiveAiProviderId();

  if (process.env[provider.envVar]) {
    return {
      configured: true,
      id: provider.id,
      provider: provider.name,
      envVar: provider.envVar,
      source: "environment" as const,
      enabled: provider.enabled,
      active: provider.id === activeProviderId,
      models: getAiProviderModelCatalog(provider.id),
      defaultModel: getDefaultAiModel(provider.id),
      selectedModel: getSelectedAiModel(provider.id),
      secureStorage: getSecretStorageStatus(),
      restartRequired: true,
    };
  }

  const row = db.prepare("SELECT updated_at, secret_storage FROM app_secrets WHERE id = ?").get(provider.secretId) as any;
  const storage = (row?.secret_storage || getPreferredSecretStorage()) as SecretStorageKind;
  return {
    configured: Boolean(row),
    id: provider.id,
    provider: provider.name,
    envVar: provider.envVar,
    source: row?.secret_storage === "electron_safe_storage" ? ("system_secure_store" as const) : row ? ("encrypted_store" as const) : ("missing" as const),
    enabled: provider.enabled,
    active: provider.id === activeProviderId,
    models: getAiProviderModelCatalog(provider.id),
    defaultModel: getDefaultAiModel(provider.id),
    selectedModel: getSelectedAiModel(provider.id),
    secureStorage: getSecretStorageStatus(row ? { secret_storage: storage } : null),
    restartRequired: false,
    updatedAt: row?.updated_at,
  };
}

export function getAiConfigStatus() {
  return getAiProviderStatus("gemini");
}

export function listAiProviderStatuses() {
  return aiProviders.map((provider) => getAiProviderStatus(provider.id));
}

export function saveAiApiKey(apiKey: string, providerId: AiProviderId = "gemini") {
  const provider = getProvider(providerId);
  if (!provider) throw new Error("Unknown AI provider");
  const credential = normalizeProviderCredential(providerId, apiKey);
  const encrypted = encryptSecret(credential);
  const now = Date.now();
  db.prepare(`
    INSERT INTO app_secrets (id, provider, secret_storage, ciphertext, iv, auth_tag, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET
      provider = excluded.provider,
      secret_storage = excluded.secret_storage,
      ciphertext = excluded.ciphertext,
      iv = excluded.iv,
      auth_tag = excluded.auth_tag,
      updated_at = excluded.updated_at
  `).run(provider.secretId, provider.id, encrypted.storage, encrypted.ciphertext, encrypted.iv, encrypted.tag, now, now);
}

export function deleteAiApiKey(providerId: AiProviderId = "gemini") {
  const provider = getProvider(providerId);
  if (!provider) throw new Error("Unknown AI provider");
  db.prepare("DELETE FROM app_secrets WHERE id = ?").run(provider.secretId);
}
