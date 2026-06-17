import type { Message } from "../types";
import { clearDevicePrivateKey, createDeviceKeyPair, isDeviceSignatureAvailable, sha256Base64Url, signDevicePayload } from "./deviceKeyStore";
import { clearDeviceCredential, getCachedDeviceCredential, getDeviceCredentialStorageStatus, hydrateDeviceCredential, saveDeviceCredential } from "./deviceCredentialStore";
import { clearActiveChatSessionId } from "./chatSessionStorage";
import type { StoredDeviceCredential } from "./deviceCredentialStore";

export type BoundDevice = {
  id: string;
  name: string;
  type: "mobile" | "desktop" | "browser";
  status: "online" | "offline" | "revoked";
  publicKey?: string;
  createdAt: number;
  lastSeenAt: number;
  revokedAt?: number;
  connectivityReport?: DeviceConnectivityReport | null;
};

export type DeviceConnectivityReport = {
  id: string;
  deviceId: string;
  ok: boolean;
  currentBaseUrl: string;
  healthOk: boolean;
  websocketOk: boolean;
  latencyMs: number;
  error?: string;
  createdAt: number;
};

export type MobileConnectivityReportInput = {
  ok: boolean;
  currentBase: string;
  latencyMs: number;
  error?: string;
  steps: Array<{ id: "health" | "websocket"; ok: boolean; url: string; latencyMs: number; status?: number; error?: string }>;
};

export type BindingSession = {
  id: string;
  token: string;
  expiresAt: number;
  baseUrl?: string;
  pairingUrl: string;
  localName: string;
};

export type { StoredDeviceCredential };

export type DeviceCredentialStorageStatus = Awaited<ReturnType<typeof getDeviceCredentialStorageStatus>>;

export type AdminSession = {
  expiresAt: number;
  onboardingRequired?: boolean;
  nextPath?: string;
};

export type OnboardingStatus = {
  steps: Array<{
    id: "ai" | "backup" | "device" | "security";
    label: string;
    done: boolean;
    actionPath: string;
    message: string;
  }>;
  completed: boolean;
  completedAt: number | null;
  required: boolean;
  securityOverall: "ok" | "warning" | "critical";
  nextPath: string;
};

export type ChatSession = {
  id: string;
  title: string;
  createdAt: number;
  updatedAt: number;
};

export type StoredChatMessage = {
  id: string;
  sessionId: string;
  role: "user" | "assistant" | "system" | "tool";
  contentJson: Message;
  sourceDeviceId?: string | null;
  createdAt: number;
};

export type MemoryRecord = {
  id: string;
  title: string;
  content: string;
  sensitivity: "normal" | "sensitive";
  createdAt: number;
  updatedAt: number;
  deletedAt?: number;
};

export type AuditLogRecord = {
  id: string;
  actorType: string;
  actorId?: string | null;
  action: string;
  targetType?: string | null;
  targetId?: string | null;
  metadata: unknown;
  createdAt: number;
};

export type BackupRecord = {
  file: string;
  size: number;
  createdAt: number;
  redaction?: {
    appSecretsDeleted: number;
    sensitiveClientStateDeleted: number;
    adminSessionsDeleted: number;
  };
};

export type PendingRestore = {
  restoredFrom: string;
  preRestoreBackup: BackupRecord;
  scheduledAt: number;
  scheduledForNextStart: boolean;
  restartRequired: boolean;
};

export type BackupPreview = {
  backup: BackupRecord;
  tables: Record<string, number | null>;
  migrations: Array<{ version: number; name: string; appliedAt: number }>;
  sensitiveData?: {
    appSecretsRows: number;
    sensitiveClientStateRows: number;
    ordinaryBackupExcludesSecrets: boolean;
  };
  warnings: string[];
};

export type CleanupResult = {
  auditLogsDeleted: number;
  chatSessionsDeleted: number;
  messagesDeleted: number;
  backupsDeleted: number;
};

export type BackupSchedule = {
  enabled: boolean;
  intervalHours: number;
  lastRunAt?: number;
  nextRunAt?: number;
  updatedAt?: number;
};

export type ConfigDiagnostics = {
  ai: {
    configured: boolean;
    id?: AiProviderId;
    provider: string;
    envVar: string;
    source: "environment" | "system_secure_store" | "encrypted_store" | "missing";
    enabled?: boolean;
    models?: string[];
    defaultModel?: string;
    selectedModel?: string;
    secureStorage?: {
      preferred: "electron_safe_storage" | "local_aes_gcm";
      current?: "electron_safe_storage" | "local_aes_gcm";
      label: string;
      systemAvailable: boolean;
      systemName?: string;
      fallbackLabel?: string;
      fallbackActive?: boolean;
      migrationRecommended?: boolean;
    };
    restartRequired: boolean;
    updatedAt?: number;
    recommendations: string[];
  };
  network: {
    host: string;
    publicBaseUrl: string;
    publicAccessAllowed: boolean;
    publicAccessWarning: boolean;
    recommendations: string[];
  };
  storage: {
    dataDir: string;
    dataDirConfigured: boolean;
    backupRetentionCount: string;
    backupSchedule: {
      enabled: boolean;
      intervalHours: number;
      nextRunAt?: number;
    };
    recommendations: string[];
  };
  release: {
    manifestAvailable: boolean;
    checksumAvailable: boolean;
    version: string;
    generatedAt: string;
    artifactCount: number;
    artifacts: Array<{
      platform: string;
      fileName: string;
      feedFile: string;
      size: number;
      sha512Present: boolean;
      sha256: string;
      releaseDate: string;
    }>;
    recommendations: string[];
  };
  securityCheck: {
    publicMode: boolean;
    overall: "ok" | "warning" | "critical";
    items: Array<{
      id: string;
      label: string;
      status: "ok" | "warning" | "critical";
      message: string;
      action: string;
    }>;
  };
};

export type AiProviderId = "gemini" | "openai" | "openrouter" | "local";
export type AiProviderStatus = ConfigDiagnostics["ai"] & {
  id: AiProviderId;
  enabled: boolean;
  active: boolean;
};

export type NetworkDiagnostics = {
  host: string;
  port: string;
  publicBaseUrl: string;
  publicAccessAllowed: boolean;
  lanUrls: string[];
  lanEnvTemplate: string;
  recommendedBaseUrl: string;
  remoteReadiness: {
    status: "ready" | "needs-restart" | "temporary" | "local-only" | "lan-only" | "blocked";
    severity: "ok" | "warning" | "danger";
    candidateId: string;
    baseUrl: string;
    blockers: Array<{ id: "noRemoteEntry" | "localOnly" | "lanOnly" | "needsHttps" | "needsPublicOptIn" | "needsRestart" | "temporaryTunnel" | "ready"; detail?: string }>;
    actions: Array<{ id: "noRemoteEntry" | "localOnly" | "lanOnly" | "needsHttps" | "needsPublicOptIn" | "needsRestart" | "temporaryTunnel" | "ready"; detail?: string }>;
  };
  connectionCandidates: Array<{
    id: string;
    label: string;
    baseUrl: string;
    mode: "configured" | "cloudflare" | "tailscale" | "lan" | "local";
    priority: number;
    requiresRestart: boolean;
    stability: "stable" | "temporary" | "local";
    secure: boolean;
    envTemplate: string;
    restartInstruction: string;
    mobilePairUrl: string;
    mobileChatUrl: string;
    notes: string[];
  }>;
  desktopRuntimeConfig: {
    mode: "configured" | "cloudflare" | "tailscale" | "lan" | "local";
    label: string;
    host: "127.0.0.1" | "0.0.0.0";
    port: number;
    publicBaseUrl: string;
    allowPublic: boolean;
    baseUrl: string;
    updatedAt: number;
  } | null;
  remoteValidationReport: {
    id: string;
    label: string;
    baseUrl: string;
    url: string;
    ok: boolean;
    status: number;
    latencyMs: number;
    passed: number;
    total: number;
    createdAt: number;
    error?: string;
    steps: Array<{
      id: string;
      ok: boolean;
      status: number;
      url: string;
      latencyMs: number;
      error?: string;
    }>;
  } | null;
  remoteHealthSummary: {
    status: "healthy" | "unchecked" | "failing" | "stale" | "temporary" | "insecure" | "missing";
    severity: "ok" | "warning" | "danger";
    baseUrl: string;
    lastCheckedAt: number | null;
    ageMs: number | null;
    recommendations: Array<
      | "save-long-term-entry"
      | "run-remote-health"
      | "replace-temporary-tunnel"
      | "use-https"
      | "refresh-stale-check"
      | "fix-health-check"
      | "fix-mobile-shell"
      | "fix-websocket"
      | "refresh-pairing-qr"
      | "ready"
    >;
    checks: Array<{
      id: "https" | "health" | "mobile-shell" | "websocket" | "qr-entry";
      status: "ok" | "warning" | "fail" | "unknown";
      detail?: string;
    }>;
  };
  latestBindingSession: {
    id: string;
    expiresAt: number;
    confirmedAt: number | null;
    expired: boolean;
  } | null;
  cloudflare: {
    installed: boolean;
    running: boolean;
    managed: {
      running: boolean;
      starting: boolean;
      url: string;
      pid: number | null;
      startedAt: number | null;
      command: string;
      lastOutput: string;
      lastError: string;
    };
    version: string;
    detectedUrls: string[];
    suggestedCommand: string;
    installCommand: string;
    installUrl: string;
    envTemplate: string;
    notes: string[];
  };
  cloudflareNamedTunnel: {
    configured: boolean;
    ready: boolean;
    configPath: string;
    configExists: boolean;
    name: string;
    hostname: string;
    credentialsFile: string;
    baseUrl: string;
    command: string;
    configPreview: string;
    notes: string[];
  };
  tailscale: {
    installed: boolean;
    online: boolean;
    version: string;
    deviceName: string;
    tailnetName: string;
    urls: string[];
    magicDnsUrls: string[];
    httpsServeUrl: string;
    serveRunning: boolean;
    serveCommand: string;
    serveStatus: string;
    mobileUrls: string[];
    installCommand: string;
    installUrl: string;
    envTemplate: string;
    notes: string[];
  };
  safety: {
    publicModeRequired: boolean;
    requiresHttpsForInternet: boolean;
    notes: string[];
  };
};

export type ConnectionTestResult = {
  ok: boolean;
  status: number;
  url: string;
  latencyMs: number;
  service?: string;
  publicAccessWarning?: boolean;
  error?: string;
  steps?: Array<{
    id: "health" | "mobile-shell" | "websocket";
    ok: boolean;
    status: number;
    url: string;
    latencyMs: number;
    error?: string;
  }>;
};

export type MobilePairingIntent = {
  token: string;
};

export function getLifeOSBasePath(pathname = typeof window === "undefined" ? "/" : window.location?.pathname || "/") {
  const match = String(pathname || "/").match(/^(.*?)(?:\/(?:admin|mobile|chat)(?:\/|$)|\/?$)/);
  const basePath = (match?.[1] || "").replace(/\/+$/, "");
  return basePath === "/" ? "" : basePath;
}

export function apiUrl(path: string) {
  const normalizedPath = path.startsWith("/") ? path : `/${path}`;
  return `${getLifeOSBasePath()}${normalizedPath}`;
}

export function realtimeWebSocketUrl(path = "/api/v1/ws") {
  const protocol = window.location.protocol === "https:" ? "wss" : "ws";
  return `${protocol}://${window.location.host}${apiUrl(path)}`;
}

async function requestJson<T>(url: string, init?: RequestInit): Promise<T> {
  const method = init?.method || "GET";
  const body = typeof init?.body === "string" ? init.body : "";
  const response = await fetch(apiUrl(url), {
    ...init,
    credentials: "same-origin",
    headers: {
      "Content-Type": "application/json",
      ...getCsrfHeader(),
      ...(await getAuthHeaders(method, url, body)),
      ...(init?.headers || {}),
    },
  });

  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(data?.error || `Request failed: ${response.status}`);
  }
  return data;
}

export async function getMobilePairingIntent(): Promise<MobilePairingIntent> {
  const response = await fetch(apiUrl("/api/v1/mobile/pairing-intent"), {
    credentials: "same-origin",
    headers: {
      "Content-Type": "application/json",
    },
  });
  return response.json().catch(() => ({ token: "" }));
}

function getCookie(name: string) {
  return document.cookie
    .split(";")
    .map((cookie) => cookie.trim())
    .find((cookie) => cookie.startsWith(`${name}=`))
    ?.slice(name.length + 1);
}

function getCsrfHeader(): Record<string, string> {
  const token = getCookie("lifeos_csrf");
  return token ? { "X-LifeOS-CSRF": decodeURIComponent(token) } : {};
}

export async function getAuthHeaders(method = "GET", url = "/", body = ""): Promise<Record<string, string>> {
  const deviceCredential = await getStoredDeviceCredentialAsync();
  if (deviceCredential?.device?.id && deviceCredential.accessToken) {
    return {
      "X-LifeOS-Device-ID": deviceCredential.device.id,
      "X-LifeOS-Device-Token": deviceCredential.accessToken,
    };
  }

  if (deviceCredential?.device?.id && deviceCredential.authMethod === "signature") {
    const timestamp = String(Date.now());
    const nonce = crypto.randomUUID();
    const path = new URL(url, window.location.origin).pathname;
    const bodyHash = await sha256Base64Url(body);
    const payload = buildDeviceSignaturePayload({ method, path, bodyHash, timestamp, nonce });
    const signature = await signDevicePayload(payload);
    if (signature) {
      return {
        "X-LifeOS-Device-ID": deviceCredential.device.id,
        "X-LifeOS-Device-Timestamp": timestamp,
        "X-LifeOS-Device-Nonce": nonce,
        "X-LifeOS-Device-Signature": signature,
      };
    }
  }

  return {};
}

export function buildDeviceSignaturePayload(input: { method: string; path: string; bodyHash: string; timestamp: string; nonce: string }) {
  return [input.method.toUpperCase(), input.path, input.bodyHash, input.timestamp, input.nonce].join("\n");
}

export function getStoredAdminSession(): AdminSession | null {
  const raw = localStorage.getItem("lifeos_admin_session");
  if (!raw) return null;
  try {
    const session = JSON.parse(raw);
    if (!session?.expiresAt || session.expiresAt <= Date.now()) {
      localStorage.removeItem("lifeos_admin_session");
      return null;
    }
    return session;
  } catch {
    return null;
  }
}

export function saveStoredAdminSession(session: AdminSession) {
  localStorage.setItem("lifeos_admin_session", JSON.stringify({ expiresAt: session.expiresAt }));
}

export function clearStoredAdminSession() {
  localStorage.removeItem("lifeos_admin_session");
}

export function getStoredDeviceCredential(): StoredDeviceCredential | null {
  return getCachedDeviceCredential();
}

export function getStoredDeviceCredentialAsync(): Promise<StoredDeviceCredential | null> {
  return hydrateDeviceCredential();
}

export function getStoredDeviceCredentialStorageStatus() {
  return getDeviceCredentialStorageStatus();
}

export function saveStoredDeviceCredential(credential: StoredDeviceCredential) {
  return saveDeviceCredential(credential);
}

export async function clearStoredDeviceCredential() {
  await clearDeviceCredential();
  await clearDevicePrivateKey().catch(() => null);
}

export function getAdminStatus() {
  return requestJson<{ configured: boolean; authenticated: boolean; envManaged: boolean; onboardingRequired: boolean | null; nextPath: string | null }>("/api/v1/admin/status");
}

export function getOnboardingStatus() {
  return requestJson<{ onboarding: OnboardingStatus }>("/api/v1/admin/onboarding");
}

export function completeOnboarding() {
  return requestJson<{ onboarding: OnboardingStatus }>("/api/v1/admin/onboarding/complete", { method: "PUT" });
}

export function getConfigDiagnostics() {
  return requestJson<ConfigDiagnostics>("/api/v1/admin/config-diagnostics");
}

export function getNetworkDiagnostics() {
  return requestJson<NetworkDiagnostics>("/api/v1/admin/network-diagnostics");
}

export function testConnectionUrl(baseUrl: string, options: { persist?: boolean; label?: string } = {}) {
  return requestJson<{ result: ConnectionTestResult; remoteValidationReport?: NetworkDiagnostics["remoteValidationReport"] }>("/api/v1/admin/network-diagnostics/test-url", {
    method: "POST",
    body: JSON.stringify({ baseUrl, ...options }),
  });
}

export function saveDesktopConnectionConfig(input: { mode: NetworkDiagnostics["connectionCandidates"][number]["mode"]; label: string; baseUrl: string }) {
  return requestJson<{
    config: NonNullable<NetworkDiagnostics["desktopRuntimeConfig"]>;
    restartRequired: boolean;
    message: string;
  }>("/api/v1/admin/desktop-connection-config", {
    method: "PUT",
    body: JSON.stringify(input),
  });
}

export function getCloudflareTunnelStatus() {
  return requestJson<{
    tunnel: NetworkDiagnostics["cloudflare"]["managed"];
    diagnostics: NetworkDiagnostics;
  }>("/api/v1/admin/cloudflare-tunnel");
}

export function startCloudflareTunnel() {
  return requestJson<{
    tunnel: NetworkDiagnostics["cloudflare"]["managed"];
    config: NonNullable<NetworkDiagnostics["desktopRuntimeConfig"]>;
    diagnostics: NetworkDiagnostics;
    message: string;
  }>("/api/v1/admin/cloudflare-tunnel/start", { method: "POST" });
}

export function stopCloudflareTunnel() {
  return requestJson<{
    tunnel: NetworkDiagnostics["cloudflare"]["managed"];
    diagnostics: NetworkDiagnostics;
    message: string;
  }>("/api/v1/admin/cloudflare-tunnel/stop", { method: "POST" });
}

export function generateCloudflareNamedTunnelConfig(input: { name: string; hostname: string; credentialsFile: string }) {
  return requestJson<{
    namedTunnel: NetworkDiagnostics["cloudflareNamedTunnel"];
    diagnostics: NetworkDiagnostics;
    message: string;
  }>("/api/v1/admin/cloudflare-named-tunnel/config", {
    method: "POST",
    body: JSON.stringify(input),
  });
}

export function startCloudflareNamedTunnel() {
  return requestJson<{
    tunnel: NetworkDiagnostics["cloudflare"]["managed"];
    namedTunnel: NetworkDiagnostics["cloudflareNamedTunnel"];
    diagnostics: NetworkDiagnostics;
    message: string;
  }>("/api/v1/admin/cloudflare-named-tunnel/start", { method: "POST" });
}

export function runRemoteHealthCheck() {
  return requestJson<{
    skipped: boolean;
    reason: string;
    report: NetworkDiagnostics["remoteValidationReport"];
    diagnostics: NetworkDiagnostics;
  }>("/api/v1/admin/network-diagnostics/remote-health", { method: "POST" });
}

export function startTailscaleHttpsServe() {
  return requestJson<{
    serve: {
      ok: boolean;
      command: string;
      output: string;
      url: string;
      status: NetworkDiagnostics["tailscale"];
    };
    config: NonNullable<NetworkDiagnostics["desktopRuntimeConfig"]>;
    diagnostics: NetworkDiagnostics;
    message: string;
  }>("/api/v1/admin/tailscale-serve/start", { method: "POST" });
}

export function stopTailscaleHttpsServe() {
  return requestJson<{
    serve: {
      ok: boolean;
      command: string;
      output: string;
      url: string;
      status: NetworkDiagnostics["tailscale"];
    };
    diagnostics: NetworkDiagnostics;
    message: string;
  }>("/api/v1/admin/tailscale-serve/stop", { method: "POST" });
}

export function diagnosticBundleDownloadUrl() {
  return "/api/v1/admin/diagnostic-bundle";
}

export function saveAiKey(apiKey: string) {
  return requestJson<{ ai: ConfigDiagnostics["ai"] }>("/api/v1/admin/ai-key", {
    method: "PUT",
    body: JSON.stringify({ apiKey }),
  });
}

export function deleteAiKey() {
  return requestJson<{ ai: ConfigDiagnostics["ai"] }>("/api/v1/admin/ai-key", { method: "DELETE" });
}

export function listAiProviders() {
  return requestJson<{ providers: AiProviderStatus[] }>("/api/v1/admin/ai-providers");
}

export function saveAiProviderKey(providerId: AiProviderId, apiKey: string) {
  return requestJson<{ provider: AiProviderStatus }>(`/api/v1/admin/ai-providers/${providerId}/key`, {
    method: "PUT",
    body: JSON.stringify({ apiKey }),
  });
}

export function deleteAiProviderKey(providerId: AiProviderId) {
  return requestJson<{ provider: AiProviderStatus }>(`/api/v1/admin/ai-providers/${providerId}/key`, { method: "DELETE" });
}

export function updateAiProviderModel(providerId: AiProviderId, model: string) {
  return requestJson<{ provider: AiProviderStatus }>(`/api/v1/admin/ai-providers/${providerId}/model`, {
    method: "PUT",
    body: JSON.stringify({ model }),
  });
}

export function updateActiveAiProvider(providerId: AiProviderId) {
  return requestJson<{ provider: AiProviderStatus; providers: AiProviderStatus[] }>(`/api/v1/admin/ai-providers/${providerId}/active`, { method: "PUT" });
}

export function testAiProvider(providerId: AiProviderId) {
  return requestJson<{ ok: boolean; provider: AiProviderStatus; message: string }>(`/api/v1/admin/ai-providers/${providerId}/test`, { method: "POST" });
}

export async function setupAdmin(password: string) {
  const session = await requestJson<AdminSession>("/api/v1/admin/setup", {
    method: "POST",
    body: JSON.stringify({ password }),
  });
  saveStoredAdminSession(session);
  return session;
}

export async function loginAdmin(password: string) {
  const session = await requestJson<AdminSession>("/api/v1/admin/login", {
    method: "POST",
    body: JSON.stringify({ password }),
  });
  saveStoredAdminSession(session);
  return session;
}

export function changeAdminPassword(input: { currentPassword: string; newPassword: string }) {
  return requestJson<{ ok: true; passwordPolicy: unknown; securityCheck: ConfigDiagnostics["securityCheck"] }>("/api/v1/admin/password", {
    method: "PUT",
    body: JSON.stringify(input),
  });
}

export async function logoutAdmin() {
  try {
    await requestJson<{ ok: true }>("/api/v1/admin/logout", { method: "POST" });
  } finally {
    clearStoredAdminSession();
  }
}

export function startBindingSession(baseUrl?: string) {
  return requestJson<BindingSession>("/api/v1/devices/bind/start", {
    method: "POST",
    body: JSON.stringify(baseUrl ? { baseUrl } : {}),
  });
}

export function getBindingSession(bindingId: string) {
  return requestJson<{
    id: string;
    expiresAt: number;
    confirmedAt?: number;
    device: BoundDevice | null;
  }>(`/api/v1/devices/bind/${bindingId}`);
}

export async function confirmBinding(token: string, deviceName: string) {
  const keyPair = isDeviceSignatureAvailable() ? await createDeviceKeyPair() : null;
  const credential = await requestJson<StoredDeviceCredential>("/api/v1/devices/bind/confirm", {
    method: "POST",
    body: JSON.stringify({
      token,
      deviceName,
      deviceType: "mobile",
      ...(keyPair ? { publicKey: keyPair.publicKey } : {}),
    }),
  });
  if (!keyPair) return credential;
  return {
    device: credential.device,
    authMethod: "signature" as const,
    accessTokenExpiresAt: credential.accessTokenExpiresAt,
  };
}

export async function rotateDeviceToken() {
  const existingCredential = await getStoredDeviceCredentialAsync();
  if (existingCredential?.authMethod === "signature") return existingCredential;

  const credential = await requestJson<StoredDeviceCredential>("/api/v1/devices/token/rotate", { method: "POST" });
  await saveStoredDeviceCredential(credential);
  return credential;
}

export async function revokeCurrentDeviceBinding() {
  return requestJson<{ ok: true; device: BoundDevice }>("/api/v1/devices/me", { method: "DELETE" });
}

export function reportMobileConnectivity(result: MobileConnectivityReportInput) {
  return requestJson<{ ok: true; report: DeviceConnectivityReport }>("/api/v1/devices/me/connectivity-report", {
    method: "POST",
    body: JSON.stringify({
      ok: result.ok,
      currentBase: result.currentBase,
      latencyMs: result.latencyMs,
      error: result.error,
      steps: result.steps.map((step) => ({
        id: step.id,
        ok: step.ok,
        status: step.status,
        latencyMs: step.latencyMs,
        error: step.error,
      })),
    }),
  });
}

export async function createDeviceWebSocketAuthMessage() {
  const credential = await getStoredDeviceCredentialAsync();
  if (!credential) return null;

  if (credential.accessToken) {
    return {
      type: "auth",
      deviceId: credential.device.id,
      accessToken: credential.accessToken,
      timestamp: Date.now(),
    };
  }

  if (credential.authMethod === "signature") {
    const timestamp = String(Date.now());
    const nonce = crypto.randomUUID();
    const payload = buildDeviceSignaturePayload({
      method: "WS",
      path: "/api/v1/ws",
      bodyHash: "",
      timestamp,
      nonce,
    });
    const signature = await signDevicePayload(payload);
    if (!signature) return null;
    return {
      type: "auth",
      deviceId: credential.device.id,
      timestamp,
      nonce,
      signature,
    };
  }

  return null;
}

export function listDevices() {
  return requestJson<{ devices: BoundDevice[] }>("/api/v1/devices");
}

export function revokeDevice(deviceId: string) {
  return requestJson<{ ok: true }>(`/api/v1/devices/${deviceId}`, { method: "DELETE" });
}

export function requestDeviceTokenRotation(deviceId: string) {
  return requestJson<{ ok: true; delivered: boolean }>(`/api/v1/devices/${deviceId}/token/rotation-request`, { method: "POST" });
}

export function getHealth() {
  return requestJson<{
    ok: boolean;
    service: string;
    version: string;
    uptime: number;
    deviceCount: number;
    onlineDeviceCount: number;
    aiConfigured: boolean;
    adminConfigured: boolean;
    host: string;
    networkMode: "local" | "lan";
    publicBaseUrl: string;
    publicAccessWarning: boolean;
    publicAccessAllowed: boolean;
    publicSetupRisk: boolean;
    publicRisk: {
      overall: "ok" | "warning" | "critical";
      items: Array<{
        id: string;
        label: string;
        status: "ok" | "warning" | "critical";
        message: string;
        action: string;
      }>;
    };
    timestamp: number;
  }>("/api/v1/health");
}

export function listBackups() {
  return requestJson<{ backups: BackupRecord[] }>("/api/v1/backups");
}

export function getBackupSchedule() {
  return requestJson<{ schedule: BackupSchedule }>("/api/v1/backups/schedule");
}

export function updateBackupSchedule(input: { enabled: boolean; intervalHours: number }) {
  return requestJson<{ schedule: BackupSchedule }>("/api/v1/backups/schedule", {
    method: "PUT",
    body: JSON.stringify(input),
  });
}

export function listAuditLogs() {
  return requestJson<{ logs: AuditLogRecord[] }>("/api/v1/audit-logs");
}

export function getPendingRestore() {
  return requestJson<{ pendingRestore: PendingRestore | null }>("/api/v1/backups/pending-restore");
}

export function backupDownloadUrl(file: string) {
  return `/api/v1/backups/${encodeURIComponent(file)}/download`;
}

export type DataExportScope = "chat" | "memories" | "devices" | "auditLogs";

export function dataExportDownloadUrl(scopes?: DataExportScope[]) {
  const selected = scopes?.filter(Boolean) || [];
  if (!selected.length || selected.length === 4) return "/api/v1/data/export";
  return `/api/v1/data/export?scope=${encodeURIComponent(selected.join(","))}`;
}

export function createBackup() {
  return requestJson<{ backup: BackupRecord }>("/api/v1/backups", { method: "POST" });
}

export function exportEncryptedBackup(file: string, passphrase: string) {
  return requestJson<{ payload: unknown }>(`/api/v1/backups/${encodeURIComponent(file)}/encrypted-export`, {
    method: "POST",
    body: JSON.stringify({ passphrase }),
  });
}

export function importEncryptedBackup(payload: unknown, passphrase: string) {
  return requestJson<{ backup: BackupRecord; preview: BackupPreview }>("/api/v1/backups/encrypted-import", {
    method: "POST",
    body: JSON.stringify({ payload, passphrase }),
  });
}

export function restoreBackup(file: string) {
  return requestJson<{ restore: PendingRestore }>(
    `/api/v1/backups/${encodeURIComponent(file)}/restore`,
    { method: "POST" },
  );
}

export function cancelPendingRestore() {
  return requestJson<{ ok: true; cancelledRestore: PendingRestore | null }>("/api/v1/backups/pending-restore", { method: "DELETE" });
}

export function previewBackup(file: string) {
  return requestJson<{ preview: BackupPreview }>(`/api/v1/backups/${encodeURIComponent(file)}/preview`);
}

export function cleanupData(options: { auditOlderThanDays?: number; chatOlderThanDays?: number; backupKeepCount?: number }) {
  return requestJson<{ cleanup: CleanupResult }>("/api/v1/data/cleanup", {
    method: "POST",
    body: JSON.stringify(options),
  });
}

export function previewDataCleanup(options: { auditOlderThanDays?: number; chatOlderThanDays?: number; backupKeepCount?: number }) {
  return requestJson<{ cleanup: CleanupResult }>("/api/v1/data/cleanup/preview", {
    method: "POST",
    body: JSON.stringify(options),
  });
}

export function listChatSessions() {
  return requestJson<{ sessions: ChatSession[] }>("/api/v1/chat/sessions");
}

export function createChatSession(title = "JARVIS Main Session") {
  return requestJson<{ session: ChatSession }>("/api/v1/chat/sessions", {
    method: "POST",
    body: JSON.stringify({ title }),
  });
}

export function getChatSessionMessages(sessionId: string) {
  return requestJson<{ session: ChatSession; messages: StoredChatMessage[] }>(`/api/v1/chat/sessions/${sessionId}/messages`);
}

export async function saveChatMessage(sessionId: string, message: Message) {
  const credential = await getStoredDeviceCredentialAsync();
  return requestJson<{ message: StoredChatMessage }>(`/api/v1/chat/sessions/${sessionId}/messages`, {
    method: "POST",
    body: JSON.stringify({
      role: message.role === "model" ? "assistant" : message.role,
      content: message,
      sourceDeviceId: credential?.device.id,
    }),
  });
}

export function clearActiveChatSession() {
  clearActiveChatSessionId();
}

export function listMemories() {
  return requestJson<{ memories: MemoryRecord[] }>("/api/v1/memories");
}

export function createMemory(input: { title: string; content: string; sensitivity?: "normal" | "sensitive" }) {
  return requestJson<{ memory: MemoryRecord }>("/api/v1/memories", {
    method: "POST",
    body: JSON.stringify(input),
  });
}

export function updateMemory(memoryId: string, input: Partial<Pick<MemoryRecord, "title" | "content" | "sensitivity">>) {
  return requestJson<{ memory: MemoryRecord }>(`/api/v1/memories/${memoryId}`, {
    method: "PATCH",
    body: JSON.stringify(input),
  });
}

export function deleteMemory(memoryId: string) {
  return requestJson<{ ok: true }>(`/api/v1/memories/${memoryId}`, { method: "DELETE" });
}

export async function getClientState<T>(key: string, fallback: T): Promise<T> {
  try {
    const data = await requestJson<{ key: string; value: T; updatedAt: number }>(`/api/v1/state/${encodeURIComponent(key)}`);
    return data.value;
  } catch {
    return fallback;
  }
}

export function setClientState<T>(key: string, value: T) {
  return requestJson<{ key: string; value: T; updatedAt: number }>(`/api/v1/state/${encodeURIComponent(key)}`, {
    method: "PUT",
    body: JSON.stringify({ value }),
  });
}
