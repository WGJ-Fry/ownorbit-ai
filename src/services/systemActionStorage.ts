import {
  BLOCKED_URL_SCHEMES,
  DEFAULT_ALLOWED_SCHEMES,
  getUrlScheme,
  normalizeAllowedUrlSchemes,
  redactActionLabel,
  redactActionSource,
  redactActionTarget,
  redactActionUrl,
  summarizeActionParams,
  type ActionRisk,
} from "./systemActions";

export const SYSTEM_ACTIONS_STORAGE_KEY = "lifeos_system_actions";
export const SYSTEM_ACTION_LOGS_STORAGE_KEY = "lifeos_system_action_logs";
export const ALLOWED_URL_SCHEMES_STORAGE_KEY = "lifeos_allowed_url_schemes";

export type SavedSystemAction = {
  id: string;
  name: string;
  url: string;
};

export type SystemActionLog = {
  id: string;
  label: string;
  url: string;
  scheme: string;
  source: string;
  target: string;
  paramsSummary: string;
  status: "opened" | "blocked" | "cancelled";
  risk: ActionRisk;
  createdAt: number;
};

function readJsonStorage<T>(key: string, fallback: T, storage: Pick<Storage, "getItem"> = localStorage): T {
  try {
    const raw = storage.getItem(key);
    if (!raw) return fallback;
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

export function normalizeSystemActionLog(log: Partial<SystemActionLog>): SystemActionLog | null {
  if (!log || !log.url || !log.label || !log.scheme || !log.status || !log.risk) return null;
  return {
    id: log.id || `action-log-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    label: redactActionLabel(log.label, log.scheme),
    url: redactActionUrl(log.url),
    scheme: log.scheme,
    source: redactActionSource(log.source || "Manual action"),
    target: redactActionTarget(log.target || log.url, log.scheme),
    paramsSummary: log.paramsSummary || summarizeActionParams(log.url),
    status: log.status,
    risk: log.risk,
    createdAt: log.createdAt || Date.now(),
  };
}

export function loadAllowedUrlSchemes(storage?: Pick<Storage, "getItem">) {
  return normalizeAllowedUrlSchemes(readJsonStorage(ALLOWED_URL_SCHEMES_STORAGE_KEY, DEFAULT_ALLOWED_SCHEMES, storage));
}

export function loadSavedSystemActions(storage?: Pick<Storage, "getItem">): SavedSystemAction[] {
  const actions = readJsonStorage<unknown>(SYSTEM_ACTIONS_STORAGE_KEY, [], storage);
  if (!Array.isArray(actions)) return [];
  return actions
    .map(normalizeSavedSystemAction)
    .filter(Boolean)
    .slice(0, 12);
}

export function normalizeSavedSystemAction(action: unknown): SavedSystemAction | null {
  if (!action || typeof action !== "object") return null;
  const raw = action as Partial<SavedSystemAction>;
  if (typeof raw.id !== "string" || typeof raw.name !== "string" || typeof raw.url !== "string") return null;
  const url = raw.url.trim();
  const scheme = getUrlScheme(url);
  if (!scheme || BLOCKED_URL_SCHEMES.has(scheme)) return null;
  return {
    id: raw.id.trim().slice(0, 80) || `action-${Date.now()}`,
    name: raw.name.trim().slice(0, 40) || "Saved Action",
    url: url.slice(0, 600),
  };
}

export function loadSystemActionLogs(storage?: Pick<Storage, "getItem">): SystemActionLog[] {
  const logs = readJsonStorage<unknown>(SYSTEM_ACTION_LOGS_STORAGE_KEY, [], storage);
  if (!Array.isArray(logs)) return [];
  return logs.map(normalizeSystemActionLog).filter(Boolean).slice(0, 20) as SystemActionLog[];
}

export function writeSystemActionStorage<T>(key: string, value: T, storage: Pick<Storage, "setItem"> = localStorage) {
  try {
    storage.setItem(key, JSON.stringify(value));
    return true;
  } catch {
    return false;
  }
}
