export type PwaCapabilityStatus = {
  standalone: boolean;
  serviceWorkerSupported: boolean;
  serviceWorkerControlled: boolean;
  backgroundSyncSupported: boolean;
  indexedDbSupported: boolean;
  online: boolean;
  recommendations: string[];
};

export type RemoteEntryKind =
  | "configured-match"
  | "configured-mismatch"
  | "localhost"
  | "same-lan"
  | "tailscale"
  | "temporary-cloudflare"
  | "stable-https"
  | "insecure-remote"
  | "unknown";

export type RemoteEntryStatus = {
  kind: RemoteEntryKind;
  okForRemote: boolean;
  currentBase: string;
  configuredBase: string;
  titleKey: string;
  bodyKey: string;
};

export type MobileConnectivityStep = {
  id: "health" | "mobile-shell" | "websocket";
  ok: boolean;
  url: string;
  latencyMs: number;
  status?: number;
  error?: string;
};

export type MobileConnectivityResult = {
  ok: boolean;
  currentBase: string;
  latencyMs: number;
  steps: MobileConnectivityStep[];
  error?: string;
};

export type MobileRecoveryHintKey =
  | "mobileDevice.connectivityGuidanceTemporary"
  | "mobileDevice.connectivityGuidanceTailscale"
  | "mobileDevice.connectivityGuidanceTailscaleHttp"
  | "mobileDevice.connectivityGuidanceLan"
  | "mobileDevice.connectivityGuidanceLocalhost"
  | "mobileDevice.connectivityGuidanceHttps"
  | "mobileDevice.connectivityGuidanceWebSocket"
  | "mobileDevice.connectivityGuidanceHealth"
  | "mobileDevice.connectivityGuidanceOfflineQueue"
  | "mobileDevice.connectivityGuidanceFailedQueue"
  | "mobileDevice.connectivityGuidanceDefault";

export type MobileConnectivityIssueKey =
  | "mobileDevice.connectivityIssueOk"
  | "mobileDevice.connectivityIssueTemporaryExpired"
  | "mobileDevice.connectivityIssueTailscaleOffline"
  | "mobileDevice.connectivityIssueTailscaleHttp"
  | "mobileDevice.connectivityIssueLanOnly"
  | "mobileDevice.connectivityIssueLocalhost"
  | "mobileDevice.connectivityIssueConfiguredMismatch"
  | "mobileDevice.connectivityIssueHealth"
  | "mobileDevice.connectivityIssueMobileShell"
  | "mobileDevice.connectivityIssueWebSocket"
  | "mobileDevice.connectivityIssueQueueBlocked"
  | "mobileDevice.connectivityIssueUnknown";

function normalizeBaseUrl(value?: string | null) {
  if (!value) return "";
  try {
    const url = new URL(value);
    const pathname = url.pathname.replace(/\/+$/, "");
    return `${url.origin}${pathname === "/" ? "" : pathname}`.replace(/\/$/, "");
  } catch {
    return value.replace(/\/+$/, "");
  }
}

function currentBaseFromHref(currentHref?: string) {
  if (!currentHref && typeof window === "undefined") return "";
  try {
    const url = new URL(currentHref || window.location.href);
    const pathname = url.pathname.replace(/\/mobile\/.*$/, "").replace(/\/+$/, "");
    return `${url.origin}${pathname === "/" ? "" : pathname}`.replace(/\/$/, "");
  } catch {
    return "";
  }
}

function currentBasePathFromHref(currentHref?: string) {
  if (!currentHref && typeof window === "undefined") return "";
  try {
    const url = new URL(currentHref || window.location.href);
    const pathname = url.pathname.replace(/\/mobile\/.*$/, "").replace(/\/+$/, "");
    return pathname === "/" ? "" : pathname;
  } catch {
    return "";
  }
}

export function isHttpRemoteBase(value?: string | null) {
  if (!value) return false;
  try {
    return new URL(value).protocol === "http:";
  } catch {
    return value.startsWith("http://");
  }
}

function isPrivateIpv4(hostname: string) {
  const parts = hostname.split(".").map((part) => Number(part));
  if (parts.length !== 4 || parts.some((part) => !Number.isInteger(part) || part < 0 || part > 255)) return false;
  const [a, b] = parts;
  return a === 10 || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168);
}

function isTailscaleIpv4(hostname: string) {
  const parts = hostname.split(".").map((part) => Number(part));
  if (parts.length !== 4 || parts.some((part) => !Number.isInteger(part) || part < 0 || part > 255)) return false;
  return parts[0] === 100 && parts[1] >= 64 && parts[1] <= 127;
}

export function getRemoteEntryStatus(options: { currentHref?: string; configuredBaseUrl?: string | null } = {}): RemoteEntryStatus {
  const currentBase = currentBaseFromHref(options.currentHref);
  const configuredBase = normalizeBaseUrl(options.configuredBaseUrl);
  const fallback: RemoteEntryStatus = {
    kind: "unknown",
    okForRemote: false,
    currentBase,
    configuredBase,
    titleKey: "mobileDevice.remoteUnknownTitle",
    bodyKey: "mobileDevice.remoteUnknownBody",
  };
  if (!currentBase) return fallback;

  let url: URL;
  try {
    url = new URL(currentBase);
  } catch {
    return fallback;
  }

  if (configuredBase && normalizeBaseUrl(currentBase) !== configuredBase) {
    return {
      kind: "configured-mismatch",
      okForRemote: false,
      currentBase,
      configuredBase,
      titleKey: "mobileDevice.entryMismatchTitle",
      bodyKey: "mobileDevice.entryMismatchBody",
    };
  }

  const hostname = url.hostname.toLowerCase();
  const https = url.protocol === "https:";
  const isLocalhost = hostname === "localhost" || hostname === "127.0.0.1" || hostname === "::1" || hostname === "[::1]";
  const isLan = isPrivateIpv4(hostname) || hostname.endsWith(".local");
  const isTailscale = hostname.endsWith(".ts.net") || isTailscaleIpv4(hostname);
  const isTryCloudflare = hostname.endsWith(".trycloudflare.com");

  if (configuredBase) {
    return {
      kind: "configured-match",
      okForRemote: https,
      currentBase,
      configuredBase,
      titleKey: https ? "mobileDevice.remoteConfiguredTitle" : "mobileDevice.remoteInsecureTitle",
      bodyKey: https ? "mobileDevice.remoteConfiguredBody" : "mobileDevice.remoteInsecureBody",
    };
  }

  if (isLocalhost) {
    return {
      kind: "localhost",
      okForRemote: false,
      currentBase,
      configuredBase,
      titleKey: "mobileDevice.localEntryTitle",
      bodyKey: "mobileDevice.localEntryBody",
    };
  }

  if (isLan) {
    return {
      kind: "same-lan",
      okForRemote: false,
      currentBase,
      configuredBase,
      titleKey: "mobileDevice.lanEntryTitle",
      bodyKey: "mobileDevice.lanEntryBody",
    };
  }

  if (isTryCloudflare) {
    return {
      kind: "temporary-cloudflare",
      okForRemote: true,
      currentBase,
      configuredBase,
      titleKey: "mobileDevice.temporaryEntryTitle",
      bodyKey: "mobileDevice.temporaryEntryBody",
    };
  }

  if (isTailscale) {
    return {
      kind: "tailscale",
      okForRemote: https,
      currentBase,
      configuredBase,
      titleKey: https ? "mobileDevice.tailscaleEntryTitle" : "mobileDevice.tailscaleHttpEntryTitle",
      bodyKey: https ? "mobileDevice.tailscaleEntryBody" : "mobileDevice.tailscaleHttpEntryBody",
    };
  }

  if (https) {
    return {
      kind: "stable-https",
      okForRemote: true,
      currentBase,
      configuredBase,
      titleKey: "mobileDevice.remoteHttpsTitle",
      bodyKey: "mobileDevice.remoteHttpsBody",
    };
  }

  return {
    kind: "insecure-remote",
    okForRemote: false,
    currentBase,
    configuredBase,
    titleKey: "mobileDevice.remoteInsecureTitle",
    bodyKey: "mobileDevice.remoteInsecureBody",
  };
}

async function probeMobileHealth(basePath: string, signal: AbortSignal): Promise<MobileConnectivityStep> {
  const startedAt = Date.now();
  const url = `${basePath}/api/v1/health`;
  try {
    const response = await fetch(url, { credentials: "same-origin", signal });
    const body = await response.json().catch(() => ({}));
    const ok = response.ok && body?.service === "lifeos-local-core";
    return {
      id: "health",
      ok,
      url,
      status: response.status,
      latencyMs: Date.now() - startedAt,
      error: ok ? undefined : `HTTP ${response.status}`,
    };
  } catch (error: any) {
    return {
      id: "health",
      ok: false,
      url,
      latencyMs: Date.now() - startedAt,
      error: error?.name === "AbortError" ? "Connection test timed out" : error?.message || "Health check failed",
    };
  }
}

async function probeMobileShell(basePath: string, signal: AbortSignal): Promise<MobileConnectivityStep> {
  const startedAt = Date.now();
  const url = `${basePath}/mobile/chat`;
  try {
    const response = await fetch(url, { credentials: "same-origin", signal });
    const body = await response.text().catch(() => "");
    const ok = response.ok && /(<div id="root"|<div id=root|LifeOS AI|生命操作系统)/i.test(body);
    return {
      id: "mobile-shell",
      ok,
      url,
      status: response.status,
      latencyMs: Date.now() - startedAt,
      error: ok ? undefined : `HTTP ${response.status}`,
    };
  } catch (error: any) {
    return {
      id: "mobile-shell",
      ok: false,
      url,
      latencyMs: Date.now() - startedAt,
      error: error?.name === "AbortError" ? "Mobile chat test timed out" : error?.message || "Mobile chat shell check failed",
    };
  }
}

function probeMobileWebSocket(basePath: string, timeoutMs: number): Promise<MobileConnectivityStep> {
  const startedAt = Date.now();
  const protocol = typeof window !== "undefined" && window.location.protocol === "https:" ? "wss" : "ws";
  const host = typeof window !== "undefined" ? window.location.host : "";
  const url = `${protocol}://${host}${basePath}/api/v1/ws`;
  return new Promise((resolve) => {
    if (typeof WebSocket === "undefined" || !host) {
      resolve({ id: "websocket", ok: false, url, latencyMs: 0, error: "WebSocket is unavailable" });
      return;
    }
    let settled = false;
    let ws: WebSocket | null = null;
    const timer = globalThis.setTimeout(() => {
      done({ id: "websocket", ok: false, url, latencyMs: Date.now() - startedAt, error: "WebSocket test timed out" });
    }, timeoutMs);
    const done = (step: MobileConnectivityStep) => {
      if (settled) return;
      settled = true;
      globalThis.clearTimeout(timer);
      try {
        ws?.close();
      } catch {}
      resolve(step);
    };
    try {
      ws = new WebSocket(url);
      ws.addEventListener("open", () => done({ id: "websocket", ok: true, url, status: 101, latencyMs: Date.now() - startedAt }), { once: true });
      ws.addEventListener("error", () => done({ id: "websocket", ok: false, url, latencyMs: Date.now() - startedAt, error: "WebSocket connection failed" }), { once: true });
    } catch (error: any) {
      done({ id: "websocket", ok: false, url, latencyMs: Date.now() - startedAt, error: error?.message || "WebSocket connection failed" });
    }
  });
}

export async function testMobileRemoteConnectivity(options: { currentHref?: string; timeoutMs?: number } = {}): Promise<MobileConnectivityResult> {
  const timeoutMs = options.timeoutMs || 3000;
  const basePath = currentBasePathFromHref(options.currentHref);
  const currentBase = currentBaseFromHref(options.currentHref);
  const controller = new AbortController();
  const timer = globalThis.setTimeout(() => controller.abort(), timeoutMs);
  const startedAt = Date.now();
  try {
    const health = await probeMobileHealth(basePath, controller.signal);
    const mobileShell = await probeMobileShell(basePath, controller.signal);
    const websocket = await probeMobileWebSocket(basePath, timeoutMs);
    const steps = [health, mobileShell, websocket];
    const ok = steps.every((step) => step.ok);
    return {
      ok,
      currentBase,
      latencyMs: Date.now() - startedAt,
      steps,
      error: ok ? undefined : steps.find((step) => !step.ok)?.error || "Mobile connectivity test failed",
    };
  } finally {
    globalThis.clearTimeout(timer);
  }
}

export function getMobileRecoveryHints(
  result: MobileConnectivityResult,
  entryKind?: RemoteEntryKind,
  queue?: { pending?: number; failed?: number; syncing?: number },
): MobileRecoveryHintKey[] {
  const hints = new Set<MobileRecoveryHintKey>();
  const healthFailed = result.steps.some((step) => step.id === "health" && !step.ok);
  const websocketFailed = result.steps.some((step) => step.id === "websocket" && !step.ok);
  if (entryKind === "temporary-cloudflare") hints.add("mobileDevice.connectivityGuidanceTemporary");
  else if (entryKind === "tailscale") {
    hints.add(isHttpRemoteBase(result.currentBase) ? "mobileDevice.connectivityGuidanceTailscaleHttp" : "mobileDevice.connectivityGuidanceTailscale");
  }
  else if (entryKind === "same-lan") hints.add("mobileDevice.connectivityGuidanceLan");
  else if (entryKind === "localhost") hints.add("mobileDevice.connectivityGuidanceLocalhost");
  else if (entryKind === "stable-https" || entryKind === "configured-match") hints.add("mobileDevice.connectivityGuidanceHttps");
  else hints.add("mobileDevice.connectivityGuidanceDefault");
  if (healthFailed) hints.add("mobileDevice.connectivityGuidanceHealth");
  if (websocketFailed) hints.add("mobileDevice.connectivityGuidanceWebSocket");
  if ((queue?.pending || 0) + (queue?.syncing || 0) > 0) hints.add("mobileDevice.connectivityGuidanceOfflineQueue");
  if ((queue?.failed || 0) > 0) hints.add("mobileDevice.connectivityGuidanceFailedQueue");
  return Array.from(hints);
}

export function getMobileConnectivityIssue(
  result: MobileConnectivityResult,
  entryKind?: RemoteEntryKind,
  queue?: { pending?: number; failed?: number; syncing?: number },
): MobileConnectivityIssueKey {
  const healthFailed = result.steps.some((step) => step.id === "health" && !step.ok);
  const mobileShellFailed = result.steps.some((step) => step.id === "mobile-shell" && !step.ok);
  const websocketFailed = result.steps.some((step) => step.id === "websocket" && !step.ok);
  const queueBlocked = (queue?.failed || 0) > 0 || ((queue?.pending || 0) + (queue?.syncing || 0) > 0 && !result.ok);

  if (result.ok && !queueBlocked) return "mobileDevice.connectivityIssueOk";
  if (entryKind === "temporary-cloudflare" && (healthFailed || mobileShellFailed)) return "mobileDevice.connectivityIssueTemporaryExpired";
  if (entryKind === "tailscale" && isHttpRemoteBase(result.currentBase)) return "mobileDevice.connectivityIssueTailscaleHttp";
  if (entryKind === "tailscale" && (healthFailed || mobileShellFailed)) return "mobileDevice.connectivityIssueTailscaleOffline";
  if (entryKind === "same-lan" && (healthFailed || mobileShellFailed)) return "mobileDevice.connectivityIssueLanOnly";
  if (entryKind === "localhost") return "mobileDevice.connectivityIssueLocalhost";
  if (entryKind === "configured-mismatch") return "mobileDevice.connectivityIssueConfiguredMismatch";
  if (healthFailed) return "mobileDevice.connectivityIssueHealth";
  if (mobileShellFailed) return "mobileDevice.connectivityIssueMobileShell";
  if (websocketFailed) return "mobileDevice.connectivityIssueWebSocket";
  if (queueBlocked) return "mobileDevice.connectivityIssueQueueBlocked";
  return "mobileDevice.connectivityIssueUnknown";
}

export function getRemoteEntryGuidance(
  entry: Pick<RemoteEntryStatus, "kind" | "currentBase" | "okForRemote">,
  queue?: { pending?: number; failed?: number; syncing?: number },
): MobileRecoveryHintKey[] {
  const hints = new Set<MobileRecoveryHintKey>();
  if (entry.kind === "temporary-cloudflare") hints.add("mobileDevice.connectivityGuidanceTemporary");
  else if (entry.kind === "tailscale") {
    hints.add(isHttpRemoteBase(entry.currentBase) ? "mobileDevice.connectivityGuidanceTailscaleHttp" : "mobileDevice.connectivityGuidanceTailscale");
  }
  else if (entry.kind === "same-lan") hints.add("mobileDevice.connectivityGuidanceLan");
  else if (entry.kind === "localhost") hints.add("mobileDevice.connectivityGuidanceLocalhost");
  else if (entry.kind === "stable-https" || entry.kind === "configured-match") hints.add("mobileDevice.connectivityGuidanceHttps");
  else hints.add(entry.okForRemote ? "mobileDevice.connectivityGuidanceHttps" : "mobileDevice.connectivityGuidanceDefault");
  if ((queue?.pending || 0) + (queue?.syncing || 0) > 0) hints.add("mobileDevice.connectivityGuidanceOfflineQueue");
  if ((queue?.failed || 0) > 0) hints.add("mobileDevice.connectivityGuidanceFailedQueue");
  return Array.from(hints);
}

function standaloneDisplayMode() {
  if (typeof window === "undefined") return false;
  return window.matchMedia?.("(display-mode: standalone)")?.matches || Boolean((navigator as any).standalone);
}

function serviceWorkerSupported() {
  return typeof navigator !== "undefined" && "serviceWorker" in navigator;
}

function serviceWorkerControlled() {
  return serviceWorkerSupported() && Boolean(navigator.serviceWorker?.controller);
}

function backgroundSyncSupported() {
  return serviceWorkerSupported() && typeof window !== "undefined" && "SyncManager" in window;
}

function indexedDbSupported() {
  return typeof window !== "undefined" && "indexedDB" in window;
}

function onlineStatus() {
  if (typeof navigator === "undefined") return true;
  return navigator.onLine !== false;
}

export function getPwaCapabilityStatus(): PwaCapabilityStatus {
  const status: PwaCapabilityStatus = {
    standalone: standaloneDisplayMode(),
    serviceWorkerSupported: serviceWorkerSupported(),
    serviceWorkerControlled: serviceWorkerControlled(),
    backgroundSyncSupported: backgroundSyncSupported(),
    indexedDbSupported: indexedDbSupported(),
    online: onlineStatus(),
    recommendations: [],
  };

  if (!status.standalone) {
    status.recommendations.push("After pairing, add LifeOS to the home screen so it opens like a regular app.");
  }
  if (!status.serviceWorkerSupported) {
    status.recommendations.push("This browser does not support the offline shell. Try Safari, Chrome, or Edge.");
  } else if (!status.serviceWorkerControlled) {
    status.recommendations.push("The offline shell is taking control. Refresh once for more reliable offline startup.");
  }
  if (!status.backgroundSyncSupported) {
    status.recommendations.push("When background sync is unavailable, reopen chat to continue writing back offline messages.");
  }
  if (!status.indexedDbSupported) {
    status.recommendations.push("IndexedDB is unavailable, which affects device credentials and long-term offline state. Check private browsing settings.");
  }
  if (!status.online) {
    status.recommendations.push("You are offline. Messages will enter the local queue and sync when the network returns.");
  }

  return status;
}
