// Paired phones remember every address the desktop was reachable at, so losing
// the address they happen to be loaded from is recoverable. The list holds
// addresses only — credentials never enter this store, and web storage is
// origin-scoped anyway, so switching origins always goes through a fresh pair.

export type EndpointCandidate = {
  id: string;
  mode: string;
  baseUrl: string;
  priority: number;
  secure: boolean;
  stability: string;
};

export type EndpointCandidatesSnapshot = {
  version: string;
  generatedAt: number;
  candidates: EndpointCandidate[];
};

export type StoredEndpointCandidates = EndpointCandidatesSnapshot & { storedAt: number };

const STORAGE_KEY = "lifeos_endpoint_candidates_v1";

function storageAvailable() {
  try {
    return typeof localStorage !== "undefined";
  } catch {
    return false;
  }
}

function normalizeCandidate(raw: unknown): EndpointCandidate | null {
  const item = raw as Partial<EndpointCandidate> | null;
  const baseUrl = String(item?.baseUrl || "").replace(/\/+$/, "");
  if (!/^https?:\/\//i.test(baseUrl)) return null;
  return {
    id: String(item?.id || "").slice(0, 80),
    mode: String(item?.mode || "").slice(0, 20),
    baseUrl,
    priority: Number.isFinite(Number(item?.priority)) ? Number(item?.priority) : 0,
    secure: baseUrl.startsWith("https://"),
    stability: item?.stability === "temporary" ? "temporary" : "stable",
  };
}

export function saveEndpointCandidates(snapshot: EndpointCandidatesSnapshot | null | undefined) {
  if (!storageAvailable() || !snapshot || !Array.isArray(snapshot.candidates)) return false;
  const candidates = snapshot.candidates.map(normalizeCandidate).filter(Boolean) as EndpointCandidate[];
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({
      version: String(snapshot.version || ""),
      generatedAt: Number(snapshot.generatedAt) || Date.now(),
      candidates,
      storedAt: Date.now(),
    } satisfies StoredEndpointCandidates));
    return true;
  } catch {
    return false;
  }
}

export function getStoredEndpointCandidates(): StoredEndpointCandidates | null {
  if (!storageAvailable()) return null;
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as StoredEndpointCandidates;
    if (!parsed || !Array.isArray(parsed.candidates)) return null;
    const candidates = parsed.candidates.map(normalizeCandidate).filter(Boolean) as EndpointCandidate[];
    return {
      version: String(parsed.version || ""),
      generatedAt: Number(parsed.generatedAt) || 0,
      candidates,
      storedAt: Number(parsed.storedAt) || 0,
    };
  } catch {
    return null;
  }
}

export function clearEndpointCandidates() {
  if (!storageAvailable()) return;
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch {}
}

export type ProbeOutcome = "verified" | "reachable-unverified" | "unprobeable" | "unreachable";

// URL.origin folds default ports and drops paths, so a configured
// "https://host:443/lifeos" still matches window.location.origin.
export function normalizeOriginForComparison(value: string) {
  try {
    return new URL(String(value || "")).origin.toLowerCase();
  } catch {
    return "";
  }
}

// Probing order of trust:
// 1. A CORS fetch that returns the OwnOrbit health JSON proves our desktop
//    answers there (the desktop reflects CORS only for its own candidate
//    origins).
// 2. If CORS fails, a no-cors fetch that resolves proves *something* answers
//    HTTP there — possibly the desktop, possibly a tunnel edge error page, so
//    it is only "reachable-unverified".
// 3. From an https page, a plain-http candidate cannot be fetched at all
//    (mixed content) — that is "unprobeable", not "unreachable".
export async function probeEndpointCandidate(baseUrl: string, timeoutMs = 4000): Promise<ProbeOutcome> {
  const normalized = String(baseUrl || "").replace(/\/+$/, "");
  if (!/^https?:\/\//i.test(normalized)) return "unreachable";
  const pageIsHttps = typeof window !== "undefined" && window.location.protocol === "https:";
  if (pageIsHttps && normalized.toLowerCase().startsWith("http://")) return "unprobeable";

  const healthUrl = `${normalized}/api/v1/health`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    try {
      const response = await fetch(healthUrl, { mode: "cors", cache: "no-store", signal: controller.signal });
      if (response.ok) {
        const payload = await response.json().catch(() => null) as { service?: string } | null;
        if (payload?.service === "lifeos-local-core") return "verified";
        // Readable but not OwnOrbit — a different server lives there now.
        return "unreachable";
      }
      // A readable non-2xx (tunnel edge error page with CORS headers) is not
      // proof of the desktop.
      return "reachable-unverified";
    } catch {
      // CORS rejection and network failure look identical here; the opaque
      // probe below separates "something answered" from "nothing answered".
    }
    await fetch(healthUrl, { mode: "no-cors", cache: "no-store", signal: controller.signal });
    return "reachable-unverified";
  } catch {
    return "unreachable";
  } finally {
    clearTimeout(timer);
  }
}

export type ReachableFallback = {
  candidate: EndpointCandidate;
  pairUrl: string;
  outcome: ProbeOutcome;
};

// Walk stored candidates by priority, skip the origin that is already failing,
// and return the most trustworthy alternative: the first verified candidate
// wins outright; otherwise the best weaker signal is offered with its
// confidence attached. Probes run sequentially on purpose: candidate lists are
// short and parallel probes over a weak cellular link would compete with each
// other.
export async function findReachableFallbackCandidate(options: {
  currentOrigin?: string;
  timeoutMs?: number;
} = {}): Promise<ReachableFallback | null> {
  const stored = getStoredEndpointCandidates();
  if (!stored || !stored.candidates.length) return null;
  const currentOrigin = normalizeOriginForComparison(
    options.currentOrigin ?? (typeof window !== "undefined" ? window.location.origin : ""),
  );

  let weaker: ReachableFallback | null = null;
  for (const candidate of stored.candidates) {
    if (normalizeOriginForComparison(candidate.baseUrl) === currentOrigin) continue;
    const outcome = await probeEndpointCandidate(candidate.baseUrl, options.timeoutMs);
    if (outcome === "verified") {
      return { candidate, pairUrl: `${candidate.baseUrl}/mobile/pair`, outcome };
    }
    if (!weaker && (outcome === "reachable-unverified" || outcome === "unprobeable")) {
      weaker = { candidate, pairUrl: `${candidate.baseUrl}/mobile/pair`, outcome };
    }
  }
  return weaker;
}
