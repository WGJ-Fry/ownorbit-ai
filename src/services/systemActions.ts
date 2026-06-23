export type ActionRisk = "low" | "medium" | "high";

export const DEFAULT_ALLOWED_SCHEMES = ["http", "https", "tel", "sms", "mailto", "geo", "maps", "shortcuts", "iosamap", "androidamap", "comgooglemaps"];
export const BLOCKED_URL_SCHEMES = new Set(["javascript", "data", "file", "blob", "filesystem", "view-source"]);
export const DANGEROUS_SCHEMES = new Set(["tel", "sms", "shortcuts"]);

export function getUrlScheme(url: string) {
  const match = url.trim().match(/^([a-zA-Z][a-zA-Z0-9+.-]*):/);
  return match?.[1]?.toLowerCase() || "";
}

export function normalizeAllowedUrlSchemes(value: unknown, fallback = DEFAULT_ALLOWED_SCHEMES) {
  if (!Array.isArray(value)) return fallback;
  const normalized = Array.from(
    new Set(
      value
        .filter((item): item is string => typeof item === "string")
        .map((item) => item.trim().toLowerCase())
        .filter((scheme) => /^[a-z][a-z0-9+.-]{1,31}$/.test(scheme))
        .filter((scheme) => !BLOCKED_URL_SCHEMES.has(scheme)),
    ),
  );
  return normalized.length > 0 ? normalized : fallback;
}

export function riskForScheme(scheme: string): ActionRisk {
  if (DANGEROUS_SCHEMES.has(scheme)) return "high";
  if (!["http", "https"].includes(scheme)) return "medium";
  return "low";
}

export function summarizeActionParams(url: string) {
  try {
    const parsed = new URL(url);
    const keys = Array.from(parsed.searchParams.keys());
    return keys.length ? keys.slice(0, 4).join(", ") : "-";
  } catch {
    return "-";
  }
}

export function redactActionUrl(url: string) {
  const trimmed = url.trim();
  const scheme = getUrlScheme(trimmed);
  if (!scheme) return "[invalid-url]";
  try {
    const parsed = new URL(trimmed);
    const keys = Array.from(parsed.searchParams.keys());
    const query = keys.length ? `?${keys.slice(0, 6).map((key) => `${encodeURIComponent(key)}=[redacted]`).join("&")}` : "";
    if (["tel", "sms", "mailto"].includes(scheme)) return `${scheme}:[redacted]${query}`;
    if (scheme === "shortcuts") return `${parsed.protocol}//${parsed.host || "run-shortcut"}${query}`;
    if (["http", "https"].includes(scheme)) return `${parsed.origin}${parsed.pathname}${query}`;
    return `${scheme}://[redacted]${query}`;
  } catch {
    return `${scheme}:[redacted]`;
  }
}

export function redactActionTarget(target: string, scheme: string) {
  const trimmed = target.trim();
  const normalizedScheme = scheme.trim().toLowerCase();
  if (["tel", "sms"].includes(normalizedScheme)) return "[redacted phone]";
  if (normalizedScheme === "mailto") return "[redacted email]";
  if (getUrlScheme(trimmed)) return redactActionUrl(trimmed);
  return trimmed.slice(0, 160) || "[redacted]";
}

function safeActionSource(source: unknown) {
  const value = typeof source === "string" ? source.trim() : "";
  if (!value) return "Unknown";
  if (getUrlScheme(value)) return redactActionUrl(value);
  return value.replace(/(bearer|token|key|secret|password)=\S+/gi, "$1=[redacted]").slice(0, 80);
}

export function buildActionLogSourceSummary(logs: Array<{ source?: unknown; status?: unknown; risk?: unknown }>) {
  const sourceCounts = new Map<string, number>();
  const blockedSources = new Set<string>();
  const highRiskSources = new Set<string>();

  for (const log of logs) {
    const source = safeActionSource(log.source);
    sourceCounts.set(source, (sourceCounts.get(source) || 0) + 1);
    if (log.status === "blocked") blockedSources.add(source);
    if (log.risk === "high") highRiskSources.add(source);
  }

  const [topSource = "Unknown", topSourceCount = 0] = [...sourceCounts.entries()].sort((a, b) => b[1] - a[1])[0] || [];
  return {
    totalSources: sourceCounts.size,
    topSource,
    topSourceCount,
    blockedSources: blockedSources.size,
    highRiskSources: highRiskSources.size,
  };
}

export function buildShortcutUrl(name: string, input: string) {
  const params = new URLSearchParams({ name: name.trim() });
  if (input.trim()) {
    params.set("input", "text");
    params.set("text", input.trim());
  }
  return `shortcuts://run-shortcut?${params.toString()}`;
}
