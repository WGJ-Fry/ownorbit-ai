export function normalizePublicBaseUrl(value: unknown) {
  const raw = String(value || "").trim();
  if (!raw) return "";
  let parsed: URL;
  try {
    parsed = new URL(raw);
  } catch {
    return "";
  }
  if (!["http:", "https:"].includes(parsed.protocol)) return "";
  parsed.username = "";
  parsed.password = "";
  parsed.search = "";
  parsed.hash = "";
  const pathname = parsed.pathname === "/" ? "" : parsed.pathname.replace(/\/+$/, "");
  return `${parsed.origin}${pathname}`;
}

export function isTemporaryTryCloudflareUrl(value: unknown) {
  const raw = String(value || "").trim();
  if (!raw) return false;
  try {
    const parsed = new URL(raw);
    return parsed.protocol === "https:" && parsed.hostname.toLowerCase().endsWith(".trycloudflare.com");
  } catch {
    return false;
  }
}

export function getConfiguredPublicBaseUrl() {
  return normalizePublicBaseUrl(process.env.PUBLIC_BASE_URL || process.env.APP_URL || "");
}

export function inspectConfiguredPublicBaseUrlInput() {
  const raw = String(process.env.PUBLIC_BASE_URL || process.env.APP_URL || "").trim();
  if (!raw) return { configured: false, unsafe: false, reason: "not_configured" as const };
  try {
    const parsed = new URL(raw);
    if (parsed.username || parsed.password || parsed.search || parsed.hash) {
      return { configured: true, unsafe: true, reason: "contains_credentials_or_tokens" as const };
    }
    if (!["http:", "https:"].includes(parsed.protocol)) {
      return { configured: true, unsafe: true, reason: "unsupported_protocol" as const };
    }
    return { configured: true, unsafe: false, reason: "ok" as const };
  } catch {
    return { configured: true, unsafe: true, reason: "invalid_url" as const };
  }
}

export function getConfiguredPublicOrigin() {
  const baseUrl = getConfiguredPublicBaseUrl();
  if (!baseUrl) return "";
  try {
    return new URL(baseUrl).origin;
  } catch {
    return "";
  }
}

export function getConfiguredPublicBasePath() {
  const baseUrl = getConfiguredPublicBaseUrl();
  if (!baseUrl) return "";
  try {
    const pathname = new URL(baseUrl).pathname.replace(/\/+$/, "");
    return pathname === "/" ? "" : pathname;
  } catch {
    return "";
  }
}

export function stripConfiguredPublicBasePath(pathname: string) {
  const basePath = getConfiguredPublicBasePath();
  if (!basePath) return pathname || "/";
  if (pathname === basePath) return "/";
  if (pathname.startsWith(`${basePath}/`)) return pathname.slice(basePath.length) || "/";
  return pathname || "/";
}
