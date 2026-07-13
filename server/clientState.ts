import { db } from "./db";

const MAX_CLIENT_STATE_BYTES = Number(process.env.LIFEOS_MAX_STATE_BYTES || 256 * 1024);
const MAX_STATE_ITEMS = 50;
const BLOCKED_URL_SCHEMES = new Set(["javascript", "data", "file", "blob", "filesystem", "view-source"]);
const SENSITIVE_CLIENT_STATE_KEY = /api[-_]?key|byok[-_]?key|token|password|passphrase|secret|authorization|cookie|private/i;
const SENSITIVE_CLIENT_VALUE_KEY = /api[-_]?key|token|password|passphrase|secret|authorization|cookie|hash|ciphertext|auth[-_]?tag|private/i;
const SENSITIVE_CLIENT_SHORT_VALUE_KEY = /(^|[-_])iv([-_]|$)/i;
const SENSITIVE_CLIENT_QUERY_KEY = /api[-_]?key|token|password|passphrase|secret|authorization|cookie/i;
const SERVER_MANAGED_CLIENT_STATE_KEYS = new Set([
  "lifeos_cloudkit_data_sync_config",
  "lifeos_cloudkit_auto_sync_schedule",
]);

export function isAllowedClientStateKey(key: string) {
  return /^lifeos_[a-z0-9_:-]{1,80}$/i.test(key);
}

export function isWritableClientStateKey(key: string) {
  return isAllowedClientStateKey(key) && !SERVER_MANAGED_CLIENT_STATE_KEYS.has(key);
}

function invalidStatePayload(message: string) {
  const error = new Error(`Invalid state payload: ${message}`);
  (error as any).statusCode = 400;
  return error;
}

function assertPlainObject(value: unknown, label: string): asserts value is Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw invalidStatePayload(`${label} must be an object`);
}

function assertString(value: unknown, label: string, maxLength = 200) {
  if (typeof value !== "string") throw invalidStatePayload(`${label} must be a string`);
  if (value.length > maxLength) throw invalidStatePayload(`${label} is too long`);
  return value;
}

function getUrlScheme(value: string) {
  return value.trim().match(/^([a-zA-Z][a-zA-Z0-9+.-]*):/)?.[1]?.toLowerCase() || "";
}

function assertSafeActionUrl(value: unknown, label: string) {
  const url = assertString(value, label, 2000).trim();
  const scheme = getUrlScheme(url);
  if (!scheme) throw invalidStatePayload(`${label} must include a URL scheme`);
  if (BLOCKED_URL_SCHEMES.has(scheme)) throw invalidStatePayload(`${label} uses a blocked URL scheme`);
  return url;
}

function assertSafeActionLogUrl(value: unknown, label: string) {
  const url = assertString(value, label, 2000).trim();
  if (url === "[invalid-url]") return url;
  const scheme = getUrlScheme(url);
  if (scheme && BLOCKED_URL_SCHEMES.has(scheme)) throw invalidStatePayload(`${label} uses a blocked URL scheme`);
  return url;
}

function validateAllowedUrlSchemes(value: unknown) {
  if (!Array.isArray(value)) throw invalidStatePayload("allowed URL schemes must be an array");
  if (value.length > MAX_STATE_ITEMS) throw invalidStatePayload("allowed URL schemes list is too large");
  for (const scheme of value) {
    const normalized = assertString(scheme, "URL scheme", 32).trim().toLowerCase();
    if (!/^[a-z][a-z0-9+.-]{1,31}$/.test(normalized)) throw invalidStatePayload("URL scheme is malformed");
    if (BLOCKED_URL_SCHEMES.has(normalized)) throw invalidStatePayload("URL scheme is blocked");
  }
}

function normalizeAllowedUrlSchemes(value: unknown) {
  validateAllowedUrlSchemes(value);
  return Array.from(new Set((value as string[]).map((scheme) => scheme.trim().toLowerCase())));
}

function validateSystemActions(value: unknown) {
  if (!Array.isArray(value)) throw invalidStatePayload("system actions must be an array");
  if (value.length > MAX_STATE_ITEMS) throw invalidStatePayload("system actions list is too large");
  for (const item of value) {
    assertPlainObject(item, "system action");
    assertString(item.id, "system action id", 80);
    assertString(item.name, "system action name", 80);
    assertSafeActionUrl(item.url, "system action URL");
  }
}

function validateSystemActionLogs(value: unknown) {
  if (!Array.isArray(value)) throw invalidStatePayload("system action logs must be an array");
  if (value.length > MAX_STATE_ITEMS) throw invalidStatePayload("system action logs list is too large");
  for (const item of value) {
    assertPlainObject(item, "system action log");
    assertString(item.id, "system action log id", 100);
    assertString(item.label, "system action log label", 200);
    assertSafeActionLogUrl(item.url, "system action log URL");
    const scheme = assertString(item.scheme, "system action log scheme", 32).toLowerCase();
    if (BLOCKED_URL_SCHEMES.has(scheme)) throw invalidStatePayload("system action log scheme is blocked");
    if (!["opened", "blocked", "cancelled"].includes(String(item.status))) throw invalidStatePayload("system action log status is invalid");
    if (!["low", "medium", "high"].includes(String(item.risk))) throw invalidStatePayload("system action log risk is invalid");
    if (typeof item.createdAt !== "number" || !Number.isFinite(item.createdAt)) throw invalidStatePayload("system action log timestamp is invalid");
  }
}

export function validateClientStateValue(key: string, value: unknown) {
  if (key === "lifeos_allowed_url_schemes") validateAllowedUrlSchemes(value);
  if (key === "lifeos_system_actions") validateSystemActions(value);
  if (key === "lifeos_system_action_logs") validateSystemActionLogs(value);
}

export function normalizeClientStateValue(key: string, value: unknown) {
  if (key === "lifeos_allowed_url_schemes") return normalizeAllowedUrlSchemes(value);
  validateClientStateValue(key, value);
  return value;
}

export function serializeClientStateValue(value: unknown) {
  const valueJson = JSON.stringify(value);
  if (Buffer.byteLength(valueJson, "utf8") > MAX_CLIENT_STATE_BYTES) {
    throw new Error(`State payload exceeds ${MAX_CLIENT_STATE_BYTES} bytes`);
  }
  return valueJson;
}

export function getClientState(key: string) {
  const row = db.prepare("SELECT key, value_json as valueJson, updated_at as updatedAt FROM client_state WHERE key = ?").get(key) as any;
  if (!row) return undefined;
  return {
    key: row.key,
    value: JSON.parse(row.valueJson),
    updatedAt: row.updatedAt,
  };
}

function redactClientStateUrl(value: string) {
  try {
    const parsed = new URL(value);
    let changed = false;
    if (parsed.username || parsed.password) {
      parsed.username = "";
      parsed.password = "";
      changed = true;
    }
    for (const key of Array.from(parsed.searchParams.keys())) {
      if (SENSITIVE_CLIENT_QUERY_KEY.test(key)) {
        parsed.searchParams.set(key, "[redacted]");
        changed = true;
      }
    }
    if (parsed.hash && SENSITIVE_CLIENT_QUERY_KEY.test(parsed.hash)) {
      parsed.hash = "#[redacted]";
      changed = true;
    }
    return changed ? parsed.toString() : value;
  } catch {
    return value;
  }
}

function redactClientStateString(value: string) {
  const redacted = value
    .replace(/Bearer\s+[A-Za-z0-9._~+/-]+/gi, "Bearer [redacted]")
    .replace(/Basic\s+[A-Za-z0-9._~+/-]+={0,2}/gi, "Basic [redacted]")
    .replace(/\b(?:github_pat_[A-Za-z0-9_]+|ghp_[A-Za-z0-9_]{20,})\b/g, "[redacted]")
    .replace(/\bAIzaSy[A-Za-z0-9_-]{20,}\b/g, "[redacted]")
    .replace(/\bsk-(?:or-)?[A-Za-z0-9_-]{16,}\b/g, "[redacted]")
    .replace(/\b(?:bind|device)_[A-Za-z0-9_-]{8,}\b/g, "[redacted]")
    .replace(/\/Users\/[^\s,;"]+/g, "[local-path]")
    .replace(/[A-Za-z]:\\[^\s,;"]+/g, "[local-path]")
    .replace(/[a-zA-Z][a-zA-Z0-9+.-]*:\/\/[^\s,;"'<>]+/g, (match) => redactClientStateUrl(match));
  return /^[a-zA-Z][a-zA-Z0-9+.-]*:\/\//.test(redacted.trim()) ? redactClientStateUrl(redacted) : redacted;
}

function redactClientStateValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(redactClientStateValue);
  if (typeof value === "string") return redactClientStateString(value);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(Object.entries(value as Record<string, unknown>).map(([key, item]) => {
    if ((SENSITIVE_CLIENT_VALUE_KEY.test(key) || SENSITIVE_CLIENT_SHORT_VALUE_KEY.test(key)) && typeof item !== "boolean" && typeof item !== "number") {
      return [key, "[redacted]"];
    }
    return [key, redactClientStateValue(item)];
  }));
}

export function publicClientState(state: ReturnType<typeof getClientState>) {
  if (!state) return state;
  return {
    ...state,
    value: SENSITIVE_CLIENT_STATE_KEY.test(state.key) ? "[redacted]" : redactClientStateValue(state.value),
  };
}

function writeClientState(key: string, value: unknown, updatedAt: number, actor?: { type: string; id: string }) {
  const normalizedValue = normalizeClientStateValue(key, value);
  const valueJson = serializeClientStateValue(normalizedValue);
  db.prepare(`
    INSERT INTO client_state (key, value_json, updated_at, updated_by_type, updated_by_id)
    VALUES (?, ?, ?, ?, ?)
    ON CONFLICT(key) DO UPDATE SET
      value_json = excluded.value_json,
      updated_at = excluded.updated_at,
      updated_by_type = excluded.updated_by_type,
      updated_by_id = excluded.updated_by_id
  `).run(key, valueJson, updatedAt, actor?.type || null, actor?.id || null);
  return getClientState(key);
}

export function setClientState(key: string, value: unknown, actor?: { type: string; id: string }) {
  return writeClientState(key, value, Date.now(), actor);
}

export function setClientStateAt(key: string, value: unknown, updatedAt: number, actor?: { type: string; id: string }) {
  const normalizedTimestamp = Number.isFinite(updatedAt) && updatedAt > 0 ? Math.floor(updatedAt) : Date.now();
  return writeClientState(key, value, normalizedTimestamp, actor);
}
