import crypto from "crypto";
import { getNetworkDiagnostics } from "./networkDiagnostics.ts";
import { isLoopbackBindHost, pairingBaseUrlNeedsLanBinding } from "./phoneReachability.ts";
import { broadcastRealtime } from "./realtime.ts";

// A paired phone keeps working only while the address it was paired on stays
// reachable. This snapshot gives an already-authenticated device every address
// the desktop is currently reachable at, so losing one path (a restarted
// temporary tunnel, a changed LAN IP) is survivable as long as any other path
// still works. It intentionally carries addresses only — never tokens, keys,
// pairing secrets, env templates, or local paths.

export type DeviceEndpointCandidate = {
  id: string;
  mode: "configured" | "cloudflare" | "tailscale" | "lan";
  baseUrl: string;
  priority: number;
  secure: boolean;
  stability: "stable" | "temporary";
};

export type DeviceEndpointsSnapshot = {
  version: string;
  generatedAt: number;
  candidates: DeviceEndpointCandidate[];
};

type RawConnectionCandidate = {
  id?: unknown;
  mode?: unknown;
  baseUrl?: unknown;
  priority?: unknown;
  stability?: unknown;
};

type CandidateFetcher = () => RawConnectionCandidate[];

const PHONE_REACHABLE_MODES = new Set(["configured", "cloudflare", "tailscale", "lan"]);

export function runtimeBindHost() {
  return process.env.LIFEOS_HOST || "127.0.0.1";
}

export function buildDeviceEndpointsSnapshot(input: {
  candidates: RawConnectionCandidate[];
  bindHost: string;
  now?: number;
}): DeviceEndpointsSnapshot {
  const byBaseUrl = new Map<string, DeviceEndpointCandidate>();
  for (const raw of input.candidates || []) {
    const mode = String(raw?.mode || "");
    const baseUrl = String(raw?.baseUrl || "").replace(/\/+$/, "");
    if (!PHONE_REACHABLE_MODES.has(mode)) continue;
    if (!/^https?:\/\//i.test(baseUrl)) continue;
    // A LAN address the core does not actually listen on would only teach the
    // phone a dead address — the same rule pairing QR codes enforce.
    if (pairingBaseUrlNeedsLanBinding(baseUrl, input.bindHost)) continue;
    // Bound to loopback, every direct-connection address is dead regardless of
    // its host: only tunnel-terminated paths reach the core, and each of those
    // (Tailscale Serve, Cloudflare, configured reverse proxy) is HTTPS. This
    // drops the plain-HTTP MagicDNS/Tailscale-IP variants diagnostics list.
    if (isLoopbackBindHost(input.bindHost) && !baseUrl.startsWith("https://")) continue;
    const priority = Number(raw?.priority);
    const candidate: DeviceEndpointCandidate = {
      id: String(raw?.id || mode).slice(0, 80),
      mode: mode as DeviceEndpointCandidate["mode"],
      baseUrl,
      priority: Number.isFinite(priority) ? priority : 0,
      secure: baseUrl.startsWith("https://"),
      stability: raw?.stability === "temporary" ? "temporary" : "stable",
    };
    const existing = byBaseUrl.get(baseUrl);
    if (!existing || candidate.priority > existing.priority) byBaseUrl.set(baseUrl, candidate);
  }

  const candidates = Array.from(byBaseUrl.values()).sort((a, b) => b.priority - a.priority);
  const version = crypto.createHash("sha256")
    .update(candidates.map((item) => `${item.mode}|${item.baseUrl}|${item.priority}`).join("\n"))
    .digest("hex")
    .slice(0, 16);
  return { version, generatedAt: input.now ?? Date.now(), candidates };
}

function defaultCandidateFetcher(): RawConnectionCandidate[] {
  const diagnostics = getNetworkDiagnostics() as { connectionCandidates?: RawConnectionCandidate[] };
  return Array.isArray(diagnostics?.connectionCandidates) ? diagnostics.connectionCandidates : [];
}

function cacheTtlMs() {
  const value = Number.parseInt(String(process.env.LIFEOS_DEVICE_ENDPOINTS_CACHE_MS || ""), 10);
  if (Number.isFinite(value) && value >= 0) return value;
  return 20_000;
}

let cached: { snapshot: DeviceEndpointsSnapshot; computedAt: number; bindHost: string } | null = null;

// Network diagnostics shell out to the tailscale/cloudflared CLIs, so a phone
// polling this endpoint must not trigger that work on every request.
export function getDeviceEndpointsSnapshot(
  bindHost = runtimeBindHost(),
  options: { maxAgeMs?: number; fetcher?: CandidateFetcher } = {},
): DeviceEndpointsSnapshot {
  const maxAge = options.maxAgeMs ?? cacheTtlMs();
  const now = Date.now();
  // Strict comparison so maxAgeMs 0 always recomputes, even within the same
  // millisecond — the change detector relies on that.
  if (cached && cached.bindHost === bindHost && now - cached.computedAt < maxAge) {
    return cached.snapshot;
  }
  const snapshot = buildDeviceEndpointsSnapshot({
    candidates: (options.fetcher || defaultCandidateFetcher)(),
    bindHost,
  });
  cached = { snapshot, computedAt: now, bindHost };
  return snapshot;
}

let lastObservedVersion = "";

// Realtime nudge so phones that are still connected somewhere learn about new
// or changed addresses before the old one dies. The payload deliberately
// carries no addresses — each device fetches the list through its own
// authenticated request.
export function maybeBroadcastDeviceEndpointsChange(
  reason = "check",
  options: { bindHost?: string; fetcher?: CandidateFetcher; broadcast?: typeof broadcastRealtime } = {},
) {
  const snapshot = getDeviceEndpointsSnapshot(options.bindHost ?? runtimeBindHost(), {
    maxAgeMs: 0,
    fetcher: options.fetcher,
  });
  if (!lastObservedVersion) {
    // First observation after boot: phones re-fetch on reconnect anyway, so a
    // broadcast here would only be startup noise.
    lastObservedVersion = snapshot.version;
    return { changed: false, version: snapshot.version, first: true };
  }
  if (snapshot.version === lastObservedVersion) {
    return { changed: false, version: snapshot.version, first: false };
  }
  lastObservedVersion = snapshot.version;
  (options.broadcast || broadcastRealtime)({
    type: "endpoints.changed",
    version: snapshot.version,
    generatedAt: snapshot.generatedAt,
    reason: String(reason || "check").slice(0, 60),
    timestamp: Date.now(),
  });
  return { changed: true, version: snapshot.version, first: false };
}

// The mobile fallback probe fetches /api/v1/health cross-origin from a sibling
// candidate origin. Reflecting CORS only for origins in the current snapshot
// lets that probe positively identify the desktop without opening health data
// to arbitrary websites.
export function isKnownCandidateOrigin(origin: unknown, bindHost = runtimeBindHost()) {
  let target = "";
  try {
    target = new URL(String(origin || "")).origin.toLowerCase();
  } catch {
    return false;
  }
  if (!target) return false;
  try {
    return getDeviceEndpointsSnapshot(bindHost).candidates.some((candidate) => {
      try {
        return new URL(candidate.baseUrl).origin.toLowerCase() === target;
      } catch {
        return false;
      }
    });
  } catch {
    return false;
  }
}

export function resetDeviceEndpointsStateForTests() {
  cached = null;
  lastObservedVersion = "";
}
