import crypto from "crypto";
import fs from "fs";
import path from "path";
import { db, dataDir } from "./db";
import { getClientState, setClientState } from "./clientState";

const keyPath = path.join(dataDir, "lifeos-secret.key");
const aiModelStateKey = "lifeos_ai_provider_models";
const aiModelCatalogStateKey = "lifeos_ai_provider_model_catalogs";
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
    apiStyle: "gemini",
    defaultModel: "gemini-3.5-flash",
    models: ["gemini-3.5-flash", "gemini-3.1-flash-lite", "gemini-3.1-pro-preview", "gemini-3-flash-preview", "gemini-2.5-pro", "gemini-2.5-flash", "gemini-2.5-flash-lite"],
  },
  {
    id: "openai",
    name: "OpenAI",
    envVar: "OPENAI_API_KEY",
    secretId: "ai.openai.api_key",
    enabled: true,
    apiStyle: "openai-compatible",
    baseUrl: "https://api.openai.com/v1",
    supportsModelDiscovery: true,
    defaultModel: "gpt-4o-mini",
    models: ["gpt-5.5", "gpt-5.5-pro", "gpt-5.4", "gpt-5.4-pro", "gpt-5.4-mini", "gpt-5.4-nano", "gpt-5", "gpt-5-pro", "gpt-5-mini", "gpt-5-nano", "gpt-4.5", "gpt-4.1", "gpt-4.1-mini", "gpt-4o-mini", "gpt-4o", "o3", "o3-mini", "o4-mini"],
  },
  {
    id: "deepseek",
    name: "DeepSeek",
    envVar: "DEEPSEEK_API_KEY",
    secretId: "ai.deepseek.api_key",
    enabled: true,
    apiStyle: "openai-compatible",
    baseUrl: "https://api.deepseek.com",
    supportsModelDiscovery: true,
    defaultModel: "deepseek-v4-flash",
    models: ["deepseek-v4-flash", "deepseek-v3.2", "deepseek-v3.1", "deepseek-chat", "deepseek-reasoner"],
  },
  {
    id: "qwen",
    name: "Alibaba Qwen / DashScope",
    envVar: "DASHSCOPE_API_KEY",
    envAliases: ["QWEN_API_KEY", "ALIBABA_API_KEY"],
    secretId: "ai.alibaba_qwen.api_key",
    enabled: true,
    apiStyle: "openai-compatible",
    baseUrl: "https://dashscope.aliyuncs.com/compatible-mode/v1",
    supportsModelDiscovery: true,
    defaultModel: "qwen-plus",
    models: [
      "qwen-plus",
      "qwen3.7-max",
      "qwen3.7-max-2026-06-08",
      "qwen3.7-max-2026-05-20",
      "qwen3.7-plus",
      "qwen-max",
      "qwen-turbo",
      "qwen-long",
      "qwen3.7-coder",
      "qwen3.7-omni-flash",
      "qwen3-max",
      "qwen3-plus",
      "qwen3-coder-plus",
      "qwen3-coder-flash",
      "qwen2.5-plus",
      "qwen2.5-max",
      "qwen-vl-max",
      "qwq-plus",
    ],
  },
  {
    id: "moonshot",
    name: "Moonshot AI / Kimi",
    envVar: "MOONSHOT_API_KEY",
    envAliases: ["KIMI_API_KEY"],
    secretId: "ai.moonshot.api_key",
    enabled: true,
    apiStyle: "openai-compatible",
    baseUrl: "https://api.moonshot.ai/v1",
    supportsModelDiscovery: true,
    defaultModel: "kimi-latest",
    models: ["kimi-latest", "kimi-k2.7-code-preview", "kimi-k2.6", "kimi-k2.5", "kimi-k2", "moonshot-v1-8k", "moonshot-v1-32k", "moonshot-v1-128k"],
  },
  {
    id: "zhipu",
    name: "Zhipu AI / GLM",
    envVar: "ZHIPU_API_KEY",
    envAliases: ["BIGMODEL_API_KEY", "ZAI_API_KEY"],
    secretId: "ai.zhipu.api_key",
    enabled: true,
    apiStyle: "openai-compatible",
    baseUrl: "https://open.bigmodel.cn/api/paas/v4",
    supportsModelDiscovery: true,
    defaultModel: "glm-5.1",
    models: ["glm-5.1", "glm-5", "glm-4.7", "glm-4.6", "glm-4.5", "glm-4.5-air", "glm-4.5-flash", "glm-4.5v", "glm-4-plus", "glm-4-air", "glm-4-flash", "glm-z1-air", "glm-z1-flash"],
  },
  {
    id: "baidu_qianfan",
    name: "Baidu Qianfan",
    envVar: "QIANFAN_API_KEY",
    envAliases: ["BAIDU_QIANFAN_API_KEY"],
    secretId: "ai.baidu_qianfan.api_key",
    enabled: true,
    apiStyle: "openai-compatible",
    baseUrl: "https://api.baiduqianfan.ai/v1",
    supportsModelDiscovery: true,
    defaultModel: "ernie-4.5-turbo-128k",
    models: ["ernie-4.5-turbo-128k", "ernie-4.5-turbo-vl", "ernie-4.0-turbo-8k", "ernie-x1-turbo-32k", "ernie-x1-lite-8k", "ernie-3.5-8k", "ernie-speed-8k", "ernie-lite-8k"],
  },
  {
    id: "tencent_hunyuan",
    name: "Tencent Hunyuan",
    envVar: "HUNYUAN_API_KEY",
    envAliases: ["TENCENT_HUNYUAN_API_KEY"],
    secretId: "ai.tencent_hunyuan.api_key",
    enabled: true,
    apiStyle: "openai-compatible",
    baseUrl: "https://api.hunyuan.cloud.tencent.com/v1",
    supportsModelDiscovery: true,
    defaultModel: "hunyuan-turbos-latest",
    models: ["hunyuan-turbos-latest", "hunyuan-turbo-latest", "hunyuan-large", "hunyuan-standard", "hunyuan-lite", "hunyuan-vision", "hunyuan-code", "hunyuan-embedding"],
  },
  {
    id: "volcengine",
    name: "Volcengine Ark / Doubao",
    envVar: "ARK_API_KEY",
    envAliases: ["VOLCENGINE_API_KEY", "DOUBAO_API_KEY"],
    secretId: "ai.volcengine_ark.api_key",
    enabled: true,
    apiStyle: "openai-compatible",
    baseUrl: "https://ark.cn-beijing.volces.com/api/v3",
    supportsModelDiscovery: true,
    defaultModel: "doubao-seed-2.1",
    models: ["doubao-seed-2.1", "doubao-seed-2.0", "doubao-seed-1-6-250615", "doubao-seed-1-6-thinking-250615", "doubao-seed-1-6-flash-250615", "doubao-1-5-pro-256k-250115", "doubao-1-5-lite-32k-250115", "doubao-1-5-vision-pro-250328"],
  },
  {
    id: "minimax",
    name: "MiniMax",
    envVar: "MINIMAX_API_KEY",
    secretId: "ai.minimax.api_key",
    enabled: true,
    apiStyle: "openai-compatible",
    baseUrl: "https://api.minimax.io/v1",
    supportsModelDiscovery: true,
    defaultModel: "MiniMax-M3",
    models: ["MiniMax-M3", "MiniMax-M2.7", "MiniMax-M1", "MiniMax-Text-01", "abab6.5s-chat", "abab6.5g-chat", "abab6.5-chat"],
  },
  {
    id: "stepfun",
    name: "StepFun",
    envVar: "STEPFUN_API_KEY",
    secretId: "ai.stepfun.api_key",
    enabled: true,
    apiStyle: "openai-compatible",
    baseUrl: "https://api.stepfun.com/v1",
    supportsModelDiscovery: true,
    defaultModel: "step-3.7-flash",
    models: ["step-3.7-flash", "step-3.5-mini", "step-3", "step-3-mini", "step-2-16k", "step-2-mini", "step-1-256k", "step-1-128k", "step-1-32k", "step-1-8k"],
  },
  {
    id: "siliconflow",
    name: "SiliconFlow",
    envVar: "SILICONFLOW_API_KEY",
    secretId: "ai.siliconflow.api_key",
    enabled: true,
    apiStyle: "openai-compatible",
    baseUrl: "https://api.siliconflow.cn/v1",
    supportsModelDiscovery: true,
    defaultModel: "deepseek-ai/DeepSeek-V3.2",
    models: ["deepseek-ai/DeepSeek-V3.2", "deepseek-ai/DeepSeek-V3", "deepseek-ai/DeepSeek-R1", "Qwen/Qwen3-235B-A22B", "Qwen/Qwen3-32B", "THUDM/GLM-4-32B-0414", "moonshotai/Kimi-K2-Instruct"],
  },
  {
    id: "baichuan",
    name: "Baichuan AI",
    envVar: "BAICHUAN_API_KEY",
    secretId: "ai.baichuan.api_key",
    enabled: true,
    apiStyle: "openai-compatible",
    baseUrl: "https://api.baichuan-ai.com/v1",
    supportsModelDiscovery: true,
    defaultModel: "Baichuan4",
    models: ["Baichuan4", "Baichuan4-Turbo", "Baichuan3-Turbo", "Baichuan3-Turbo-128k"],
  },
  {
    id: "anthropic",
    name: "Anthropic Claude",
    envVar: "ANTHROPIC_API_KEY",
    secretId: "ai.anthropic.api_key",
    enabled: true,
    apiStyle: "anthropic",
    baseUrl: "https://api.anthropic.com/v1",
    supportsModelDiscovery: true,
    defaultModel: "claude-sonnet-4-5",
    models: ["claude-opus-4-5", "claude-sonnet-4-5", "claude-haiku-4-5", "claude-opus-4-1", "claude-sonnet-4-0", "claude-3-7-sonnet-latest", "claude-3-5-sonnet-latest", "claude-3-5-haiku-latest"],
  },
  {
    id: "mistral",
    name: "Mistral AI",
    envVar: "MISTRAL_API_KEY",
    secretId: "ai.mistral.api_key",
    enabled: true,
    apiStyle: "openai-compatible",
    baseUrl: "https://api.mistral.ai/v1",
    supportsModelDiscovery: true,
    defaultModel: "mistral-large-latest",
    models: ["mistral-large-latest", "mistral-medium-latest", "mistral-small-latest", "magistral-medium-latest", "magistral-small-latest", "codestral-latest", "ministral-8b-latest", "ministral-3b-latest"],
  },
  {
    id: "groq",
    name: "Groq",
    envVar: "GROQ_API_KEY",
    secretId: "ai.groq.api_key",
    enabled: true,
    apiStyle: "openai-compatible",
    baseUrl: "https://api.groq.com/openai/v1",
    supportsModelDiscovery: true,
    defaultModel: "llama-3.3-70b-versatile",
    models: ["openai/gpt-oss-120b", "openai/gpt-oss-20b", "llama-3.3-70b-versatile", "llama-3.1-8b-instant", "deepseek-r1-distill-llama-70b", "qwen/qwen3-32b"],
  },
  {
    id: "perplexity",
    name: "Perplexity",
    envVar: "PERPLEXITY_API_KEY",
    secretId: "ai.perplexity.api_key",
    enabled: true,
    apiStyle: "openai-compatible",
    baseUrl: "https://api.perplexity.ai",
    supportsModelDiscovery: false,
    defaultModel: "sonar-pro",
    models: ["sonar-pro", "sonar", "sonar-reasoning-pro", "sonar-reasoning", "sonar-deep-research"],
  },
  {
    id: "together",
    name: "Together AI",
    envVar: "TOGETHER_API_KEY",
    secretId: "ai.together.api_key",
    enabled: true,
    apiStyle: "openai-compatible",
    baseUrl: "https://api.together.xyz/v1",
    supportsModelDiscovery: true,
    defaultModel: "meta-llama/Llama-3.3-70B-Instruct-Turbo",
    models: ["meta-llama/Llama-3.3-70B-Instruct-Turbo", "Qwen/Qwen3-235B-A22B-fp8-tput", "deepseek-ai/DeepSeek-V3", "deepseek-ai/DeepSeek-R1", "mistralai/Mixtral-8x7B-Instruct-v0.1"],
  },
  {
    id: "xai",
    name: "xAI Grok",
    envVar: "XAI_API_KEY",
    secretId: "ai.xai.api_key",
    enabled: true,
    apiStyle: "openai-compatible",
    baseUrl: "https://api.x.ai/v1",
    supportsModelDiscovery: true,
    defaultModel: "grok-4",
    models: ["grok-4", "grok-4-fast", "grok-3", "grok-3-mini"],
  },
  {
    id: "openrouter",
    name: "OpenRouter",
    envVar: "OPENROUTER_API_KEY",
    secretId: "ai.openrouter.api_key",
    enabled: true,
    apiStyle: "openai-compatible",
    baseUrl: "https://openrouter.ai/api/v1",
    supportsModelDiscovery: true,
    defaultModel: "openai/gpt-4o-mini",
    models: ["openai/gpt-5.5", "openai/gpt-5", "openai/gpt-4o-mini", "anthropic/claude-sonnet-4.5", "anthropic/claude-3.5-sonnet", "deepseek/deepseek-chat", "deepseek/deepseek-r1", "qwen/qwen-2.5-72b-instruct", "google/gemini-2.5-pro", "x-ai/grok-4"],
  },
  {
    id: "local",
    name: "Local Model",
    envVar: "LOCAL_MODEL_BASE_URL",
    secretId: "ai.local_model.endpoint",
    enabled: true,
    apiStyle: "local-openai",
    defaultModel: "llama3.2",
    supportsModelDiscovery: true,
    models: ["llama3.2", "llama3.2:1b", "llama3.1", "qwen2.5", "qwen2.5:7b", "qwen3", "deepseek-r1", "mistral", "gemma3", "phi4"],
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

export function getAiProviderDefinition(providerId: AiProviderId) {
  const provider = getProvider(providerId);
  if (!provider) throw new Error("Unknown AI provider");
  return provider;
}

export function getAiProviderBaseUrl(providerId: AiProviderId, credential = "") {
  const provider = getAiProviderDefinition(providerId);
  if (provider.id === "local") return credential.replace(/\/$/, "");
  return "baseUrl" in provider && provider.baseUrl ? provider.baseUrl.replace(/\/$/, "") : "";
}

export function supportsAiProviderModelDiscovery(providerId: AiProviderId) {
  const provider = getAiProviderDefinition(providerId);
  return Boolean("supportsModelDiscovery" in provider && provider.supportsModelDiscovery);
}

function getProviderEnvCredential(provider: typeof aiProviders[number]) {
  const envVars = [provider.envVar, ...("envAliases" in provider ? provider.envAliases : [])];
  for (const envVar of envVars) {
    const value = process.env[envVar];
    if (value) return { value, envVar };
  }
  return null;
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
  if (typeof state === "string" && getProvider(state)) return state as AiProviderId;

  // Older installations stored provider credentials and model choices before
  // the explicit default-provider setting existed. Keep those installations
  // usable by selecting the first provider that is actually configured.
  const configuredProvider = aiProviders.find((provider) => (
    Boolean(getProviderEnvCredential(provider))
    || Boolean(db.prepare("SELECT 1 FROM app_secrets WHERE id = ?").get(provider.secretId))
  ));
  return configuredProvider?.id || "gemini";
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

function getAiModelCatalogState() {
  const state = getClientState(aiModelCatalogStateKey)?.value;
  return state && typeof state === "object" && !Array.isArray(state)
    ? state as Partial<Record<AiProviderId, string[]>>
    : {};
}

function normalizeDiscoveredModels(providerId: AiProviderId, models: string[]) {
  const provider = getProvider(providerId);
  if (!provider) throw new Error("Unknown AI provider");
  const staticModels = new Set(provider.models as readonly string[]);
  const normalized = models
    .map((model) => String(model || "").trim())
    .filter((model) => model.length >= 2 && model.length <= 120)
    .filter((model) => providerId === "local" ? /^[a-zA-Z0-9._:/@+-]+$/.test(model) : /^[^\r\n\t]+$/.test(model));
  return [...new Set([...provider.models, ...normalized])]
    .filter((model) => staticModels.has(model) || normalized.includes(model))
    .slice(0, 50);
}

export function getAiProviderModelCatalog(providerId: AiProviderId) {
  const provider = getProvider(providerId);
  if (!provider) throw new Error("Unknown AI provider");
  const discovered = getAiModelCatalogState()[providerId] || [];
  return normalizeDiscoveredModels(providerId, discovered);
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
  if (!/^[a-zA-Z0-9._:/@+-]+$/.test(normalized)) return false;
  return true;
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

export function saveDiscoveredAiModelCatalog(providerId: AiProviderId, models: string[], actor?: { type: string; id: string }) {
  const provider = getProvider(providerId);
  if (!provider) throw new Error("Unknown AI provider");
  const normalized = normalizeDiscoveredModels(providerId, models);
  setClientState(aiModelCatalogStateKey, { ...getAiModelCatalogState(), [providerId]: normalized }, actor);
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
      throw new Error("System secure storage is unavailable. Open OwnOrbit AI from the desktop app on this computer.");
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
  return getProviderEnvCredential(provider)?.value || getStoredAiApiKey(providerId);
}

export function getAiProviderStatus(providerId: AiProviderId) {
  const provider = getProvider(providerId);
  if (!provider) throw new Error("Unknown AI provider");
  const activeProviderId = getActiveAiProviderId();
  const envCredential = getProviderEnvCredential(provider);

  if (envCredential) {
    return {
      configured: true,
      id: provider.id,
      provider: provider.name,
      envVar: envCredential.envVar,
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
  const savedActiveProvider = getClientState(activeAiProviderStateKey)?.value;
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

  // A one-field first-run flow should not require a separate hidden default
  // selection. Preserve an existing explicit choice, but make the first saved
  // credential the durable default for chat and background CloudKit jobs.
  if (typeof savedActiveProvider !== "string" || !getProvider(savedActiveProvider)) {
    saveActiveAiProvider(providerId, { type: "system", id: "first-configured-provider" });
  }
}

export function deleteAiApiKey(providerId: AiProviderId = "gemini") {
  const provider = getProvider(providerId);
  if (!provider) throw new Error("Unknown AI provider");
  db.prepare("DELETE FROM app_secrets WHERE id = ?").run(provider.secretId);
}
