import crypto from "crypto";
import { db } from "./db";
import { redactAuditString } from "./audit";
import { getClientState } from "./clientState";

const MAX_APP_NAME_LENGTH = 120;
const MAX_APP_DESCRIPTION_LENGTH = 800;
const MAX_APP_CODE_BYTES = Number(process.env.LIFEOS_MAX_CUSTOM_APP_CODE_BYTES || 512 * 1024);
const MAX_APP_STATE_BYTES = Number(process.env.LIFEOS_MAX_CUSTOM_APP_STATE_BYTES || 256 * 1024);
const sensitiveStateKey = /api[-_]?key|byok[-_]?key|token|password|passphrase|secret|authorization|cookie|private/i;
const DEFAULT_ALLOWED_ACTION_SCHEMES = ["http", "https", "tel", "sms", "mailto", "geo", "maps", "shortcuts", "iosamap", "androidamap", "comgooglemaps"];
const BLOCKED_ACTION_SCHEMES = new Set(["javascript", "data", "file", "blob", "filesystem", "view-source"]);
const HIGH_RISK_ACTION_SCHEMES = new Set(["tel", "sms", "shortcuts"]);
const CUSTOM_APP_ACTION_POLICY_SCHEMES = {
  web: ["http", "https"],
  navigation: ["http", "https", "geo", "maps", "iosamap", "androidamap", "comgooglemaps"],
  communication: ["tel", "sms", "mailto"],
  shortcuts: ["shortcuts"],
  locked: [],
} as const;
const CUSTOM_APP_CAPABILITY_IDS = [
  "storage",
  "openExternal",
  "navigation",
  "communication",
  "shortcuts",
  "network",
  "clipboard",
  "fileImport",
  "backgroundSync",
] as const;
const DEFAULT_CUSTOM_APP_CAPABILITIES: CustomAppCapabilityId[] = ["storage", "openExternal", "navigation", "communication", "shortcuts"];
const HIGH_RISK_CUSTOM_APP_CAPABILITIES = new Set<CustomAppCapabilityId>(["communication", "shortcuts", "fileImport"]);
const MEDIUM_RISK_CUSTOM_APP_CAPABILITIES = new Set<CustomAppCapabilityId>(["openExternal", "navigation", "network", "clipboard", "backgroundSync"]);

export type CustomAppVisibility = "private" | "public";
export type CustomAppStatus = "active" | "building";
export type CustomAppSource = "studio" | "chat" | "import" | "migration";
export type CustomAppActionRisk = "low" | "medium" | "high";
export type CustomAppActionStatus = "pending" | "approved" | "cancelled" | "blocked";
export type CustomAppActionPolicyTemplate = "global" | keyof typeof CUSTOM_APP_ACTION_POLICY_SCHEMES;
export type CustomAppCapabilityId = typeof CUSTOM_APP_CAPABILITY_IDS[number];
export type CustomAppCapabilityRisk = "low" | "medium" | "high";

export type StoredCustomApp = {
  id: string;
  name: string;
  description: string;
  visibility: CustomAppVisibility;
  status: CustomAppStatus;
  source: CustomAppSource;
  problemBlueprintId?: string | null;
  code: string;
  createdByType?: string | null;
  createdById?: string | null;
  createdAt: number;
  updatedAt: number;
  deletedAt?: number | null;
};

export type StoredCustomAppVersion = {
  id: string;
  appId: string;
  version: number;
  code: string;
  note?: string | null;
  createdByType?: string | null;
  createdById?: string | null;
  createdAt: number;
};

export type StoredCustomAppState = {
  appId: string;
  state: unknown;
  updatedByType?: string | null;
  updatedById?: string | null;
  updatedAt: number;
};

export type StoredCustomAppActionRequest = {
  id: string;
  appId: string;
  actionType: "open_url";
  label: string;
  targetUrl: string;
  targetScheme: string;
  paramsSummary: string;
  risk: CustomAppActionRisk;
  status: CustomAppActionStatus;
  reason?: string | null;
  createdByType?: string | null;
  createdById?: string | null;
  createdAt: number;
  decidedByType?: string | null;
  decidedById?: string | null;
  decidedAt?: number | null;
  decisionNote?: string | null;
};

export type StoredCustomAppActionPolicy = {
  appId: string;
  template: CustomAppActionPolicyTemplate;
  allowedSchemes: string[];
  requireConfirmation: boolean;
  updatedByType?: string | null;
  updatedById?: string | null;
  updatedAt: number;
};

export type StoredCustomAppCapabilityManifest = {
  appId: string;
  allowedCapabilities: CustomAppCapabilityId[];
  declaredCapabilities: CustomAppCapabilityId[];
  riskLevel: CustomAppCapabilityRisk;
  updatedByType?: string | null;
  updatedById?: string | null;
  updatedAt: number;
};

function statusError(message: string, statusCode = 400) {
  const error = new Error(message);
  (error as any).statusCode = statusCode;
  return error;
}

function normalizeId(value: unknown) {
  const candidate = String(value || "").trim();
  if (/^[a-zA-Z0-9_:-]{1,120}$/.test(candidate)) return candidate;
  return `custom-${crypto.randomUUID()}`;
}

function sanitizeText(value: unknown, label: string, maxLength: number, fallback = "") {
  const text = redactAuditString(String(value ?? fallback).replace(/\s+/g, " ").trim());
  if (!text) throw statusError(`${label} is required`);
  return text.slice(0, maxLength);
}

function sanitizeOptionalText(value: unknown, maxLength: number) {
  if (value === undefined || value === null) return undefined;
  const text = redactAuditString(String(value).replace(/\s+/g, " ").trim());
  return text.slice(0, maxLength);
}

function sanitizeActionText(value: unknown, maxLength: number, fallback = "") {
  return redactAuditString(String(value ?? fallback).replace(/\s+/g, " ").trim())
    .replace(/\+?\d[\d ().-]{6,}\d/g, "[redacted]")
    .slice(0, maxLength);
}

function sanitizeCode(value: unknown) {
  const code = redactAuditString(String(value ?? ""));
  if (Buffer.byteLength(code, "utf8") > MAX_APP_CODE_BYTES) {
    throw statusError(`custom app code exceeds ${MAX_APP_CODE_BYTES} bytes`, 413);
  }
  return code;
}

function sanitizeState(value: unknown) {
  const normalized = sanitizeStateValue(value ?? {});
  const json = JSON.stringify(normalized);
  if (Buffer.byteLength(json, "utf8") > MAX_APP_STATE_BYTES) {
    throw statusError(`custom app state exceeds ${MAX_APP_STATE_BYTES} bytes`, 413);
  }
  return { state: normalized, json };
}

function sanitizeStateValue(value: unknown): unknown {
  if (typeof value === "string") return redactAuditString(value);
  if (Array.isArray(value)) return value.map(sanitizeStateValue);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>).map(([key, item]) => [
      sensitiveStateKey.test(key) ? "[redacted]" : redactAuditString(String(key)).slice(0, 120),
      sanitizeStateValue(item),
    ]),
  );
}

function getUrlScheme(value: string) {
  return value.trim().match(/^([a-zA-Z][a-zA-Z0-9+.-]*):/)?.[1]?.toLowerCase() || "";
}

function redactActionUrl(value: string) {
  const trimmed = value.trim();
  const scheme = getUrlScheme(trimmed);
  if (!scheme) return "[invalid-url]";
  try {
    const parsed = new URL(trimmed);
    const hasQuery = Array.from(parsed.searchParams.keys()).length > 0;
    const query = hasQuery ? "?[redacted]" : "";
    if (["tel", "sms", "mailto"].includes(scheme)) return `${scheme}:[redacted]${query}`;
    if (scheme === "shortcuts") return `${parsed.protocol}//${parsed.host || "run-shortcut"}${query}`;
    if (["http", "https"].includes(scheme)) return `${parsed.origin}${parsed.pathname}${query}`;
    return `${scheme}://[redacted]${query}`;
  } catch {
    return `${scheme}:[redacted]`;
  }
}

function summarizeActionParams(value: string) {
  try {
    const parsed = new URL(value);
    const keys = Array.from(parsed.searchParams.keys());
    return keys.length ? keys.slice(0, 4).join(", ") : "-";
  } catch {
    return "-";
  }
}

function riskForActionScheme(scheme: string): CustomAppActionRisk {
  if (HIGH_RISK_ACTION_SCHEMES.has(scheme)) return "high";
  if (!["http", "https"].includes(scheme)) return "medium";
  return "low";
}

function normalizeActionSchemes(value: unknown, fallback: string[] = DEFAULT_ALLOWED_ACTION_SCHEMES) {
  if (!Array.isArray(value)) return fallback;
  const normalized = Array.from(new Set(
    value
      .filter((item): item is string => typeof item === "string")
      .map((item) => item.trim().toLowerCase())
      .filter((scheme) => /^[a-z][a-z0-9+.-]{1,31}$/.test(scheme))
      .filter((scheme) => !BLOCKED_ACTION_SCHEMES.has(scheme)),
  ));
  return normalized.length || fallback.length === 0 ? normalized : fallback;
}

function allowedActionSchemes() {
  const state = getClientState("lifeos_allowed_url_schemes")?.value;
  return normalizeActionSchemes(state, DEFAULT_ALLOWED_ACTION_SCHEMES);
}

function normalizePolicyTemplate(value: unknown): CustomAppActionPolicyTemplate {
  if (value === "web" || value === "navigation" || value === "communication" || value === "shortcuts" || value === "locked") return value;
  return "global";
}

function normalizeCustomAppCapabilities(value: unknown, fallback: CustomAppCapabilityId[] = DEFAULT_CUSTOM_APP_CAPABILITIES) {
  if (!Array.isArray(value)) return fallback;
  const allowed = new Set<string>(CUSTOM_APP_CAPABILITY_IDS);
  return Array.from(new Set(
    value
      .filter((item): item is string => typeof item === "string")
      .map((item) => item.trim())
      .filter((item): item is CustomAppCapabilityId => allowed.has(item)),
  ));
}

function riskForCustomAppCapabilities(capabilities: CustomAppCapabilityId[]): CustomAppCapabilityRisk {
  if (capabilities.some((capability) => HIGH_RISK_CUSTOM_APP_CAPABILITIES.has(capability))) return "high";
  if (capabilities.some((capability) => MEDIUM_RISK_CUSTOM_APP_CAPABILITIES.has(capability))) return "medium";
  return "low";
}

function requiredCapabilitiesForActionScheme(scheme: string): CustomAppCapabilityId[] {
  const required = new Set<CustomAppCapabilityId>(["openExternal"]);
  if (["geo", "maps", "iosamap", "androidamap", "comgooglemaps"].includes(scheme)) required.add("navigation");
  if (["tel", "sms", "mailto"].includes(scheme)) required.add("communication");
  if (scheme === "shortcuts") required.add("shortcuts");
  return Array.from(required);
}

function sanitizeActionTargetUrl(value: unknown) {
  const targetUrl = String(value || "").trim();
  if (!targetUrl) throw statusError("targetUrl is required");
  if (targetUrl.length > 2000) throw statusError("targetUrl is too long", 413);
  const scheme = getUrlScheme(targetUrl);
  if (!scheme) throw statusError("targetUrl must include a URL scheme");
  return { targetUrl, scheme };
}

function normalizeVisibility(value: unknown): CustomAppVisibility {
  return value === "public" ? "public" : "private";
}

function normalizeStatus(value: unknown): CustomAppStatus {
  return value === "building" ? "building" : "active";
}

function normalizeSource(value: unknown): CustomAppSource {
  if (value === "chat" || value === "import" || value === "migration") return value;
  return "studio";
}

function normalizeLimit(value: unknown) {
  const parsed = Number.parseInt(String(value || ""), 10);
  if (!Number.isFinite(parsed) || parsed <= 0) return 50;
  return Math.min(parsed, 100);
}

function rowToCustomApp(row: any): StoredCustomApp {
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    visibility: row.visibility,
    status: row.status,
    source: row.source,
    problemBlueprintId: row.problemBlueprintId,
    code: row.code,
    createdByType: row.createdByType,
    createdById: row.createdById,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    deletedAt: row.deletedAt,
  };
}

function rowToCustomAppVersion(row: any): StoredCustomAppVersion {
  return {
    id: row.id,
    appId: row.appId,
    version: row.version,
    code: row.code,
    note: row.note,
    createdByType: row.createdByType,
    createdById: row.createdById,
    createdAt: row.createdAt,
  };
}

function rowToCustomAppState(row: any): StoredCustomAppState {
  let state: unknown = {};
  try {
    state = JSON.parse(row.stateJson || "{}");
  } catch {
    state = {};
  }
  return {
    appId: row.appId,
    state,
    updatedByType: row.updatedByType,
    updatedById: row.updatedById,
    updatedAt: row.updatedAt,
  };
}

function rowToCustomAppActionRequest(row: any): StoredCustomAppActionRequest {
  return {
    id: row.id,
    appId: row.appId,
    actionType: row.actionType,
    label: row.label,
    targetUrl: row.targetUrl,
    targetScheme: row.targetScheme,
    paramsSummary: row.paramsSummary,
    risk: row.risk,
    status: row.status,
    reason: row.reason,
    createdByType: row.createdByType,
    createdById: row.createdById,
    createdAt: row.createdAt,
    decidedByType: row.decidedByType,
    decidedById: row.decidedById,
    decidedAt: row.decidedAt,
    decisionNote: row.decisionNote,
  };
}

function rowToCustomAppActionPolicy(row: any): StoredCustomAppActionPolicy {
  let allowedSchemes: string[] = [];
  try {
    allowedSchemes = normalizeActionSchemes(JSON.parse(row.allowedSchemesJson || "[]"), []);
  } catch {
    allowedSchemes = [];
  }
  return {
    appId: row.appId,
    template: normalizePolicyTemplate(row.template),
    allowedSchemes,
    requireConfirmation: Boolean(row.requireConfirmation),
    updatedByType: row.updatedByType,
    updatedById: row.updatedById,
    updatedAt: row.updatedAt,
  };
}

function defaultCustomAppActionPolicy(appId: string): StoredCustomAppActionPolicy {
  return {
    appId,
    template: "global",
    allowedSchemes: allowedActionSchemes(),
    requireConfirmation: true,
    updatedByType: null,
    updatedById: null,
    updatedAt: 0,
  };
}

function rowToCustomAppCapabilityManifest(row: any): StoredCustomAppCapabilityManifest {
  let allowedCapabilities: CustomAppCapabilityId[] = DEFAULT_CUSTOM_APP_CAPABILITIES;
  let declaredCapabilities: CustomAppCapabilityId[] = [];
  try {
    allowedCapabilities = normalizeCustomAppCapabilities(JSON.parse(row.allowedCapabilitiesJson || "[]"), []);
  } catch {
    allowedCapabilities = [];
  }
  try {
    declaredCapabilities = normalizeCustomAppCapabilities(JSON.parse(row.declaredCapabilitiesJson || "[]"), []);
  } catch {
    declaredCapabilities = [];
  }
  return {
    appId: row.appId,
    allowedCapabilities,
    declaredCapabilities,
    riskLevel: row.riskLevel === "high" || row.riskLevel === "low" ? row.riskLevel : "medium",
    updatedByType: row.updatedByType,
    updatedById: row.updatedById,
    updatedAt: row.updatedAt,
  };
}

function defaultCustomAppCapabilityManifest(appId: string): StoredCustomAppCapabilityManifest {
  return {
    appId,
    allowedCapabilities: DEFAULT_CUSTOM_APP_CAPABILITIES,
    declaredCapabilities: DEFAULT_CUSTOM_APP_CAPABILITIES,
    riskLevel: riskForCustomAppCapabilities(DEFAULT_CUSTOM_APP_CAPABILITIES),
    updatedByType: null,
    updatedById: null,
    updatedAt: 0,
  };
}

function latestCustomAppVersion(appId: string) {
  const row = db.prepare(`
    SELECT id, app_id as appId, version, code, note,
           created_by_type as createdByType, created_by_id as createdById, created_at as createdAt
    FROM custom_app_versions
    WHERE app_id = ?
    ORDER BY version DESC
    LIMIT 1
  `).get(appId) as any;
  return row ? rowToCustomAppVersion(row) : null;
}

function appendCustomAppVersionIfChanged(appId: string, code: string, note: string, actor?: { type: string; id: string }) {
  const latest = latestCustomAppVersion(appId);
  if (latest && latest.code === code) return latest;
  const now = Date.now();
  const nextVersion = (latest?.version || 0) + 1;
  const id = `appver-${crypto.randomUUID()}`;
  db.prepare(`
    INSERT INTO custom_app_versions (id, app_id, version, code, note, created_by_type, created_by_id, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    id,
    appId,
    nextVersion,
    code,
    sanitizeOptionalText(note, 240) || null,
    actor?.type || null,
    actor?.id || null,
    now,
  );
  return getCustomAppVersion(appId, nextVersion)!;
}

function selectCustomAppById(id: string) {
  return db.prepare(`
    SELECT id, name, description, visibility, status, source, problem_blueprint_id as problemBlueprintId,
           code, created_by_type as createdByType, created_by_id as createdById,
           created_at as createdAt, updated_at as updatedAt, deleted_at as deletedAt
    FROM custom_apps
    WHERE id = ? AND deleted_at IS NULL
  `).get(id) as any;
}

export function getCustomApp(id: string) {
  const row = selectCustomAppById(id);
  return row ? rowToCustomApp(row) : null;
}

export function getCustomAppVersion(appId: string, version: number) {
  const row = db.prepare(`
    SELECT id, app_id as appId, version, code, note,
           created_by_type as createdByType, created_by_id as createdById, created_at as createdAt
    FROM custom_app_versions
    WHERE app_id = ? AND version = ?
  `).get(appId, version) as any;
  return row ? rowToCustomAppVersion(row) : null;
}

export function listCustomAppVersions(appId: string, limitInput?: unknown) {
  const app = getCustomApp(appId);
  if (!app) return null;
  const limit = normalizeLimit(limitInput);
  return db.prepare(`
    SELECT id, app_id as appId, version, code, note,
           created_by_type as createdByType, created_by_id as createdById, created_at as createdAt
    FROM custom_app_versions
    WHERE app_id = ?
    ORDER BY version DESC
    LIMIT ?
  `).all(appId, limit).map(rowToCustomAppVersion);
}

export function listCustomApps(limitInput?: unknown) {
  const limit = normalizeLimit(limitInput);
  return db.prepare(`
    SELECT id, name, description, visibility, status, source, problem_blueprint_id as problemBlueprintId,
           code, created_by_type as createdByType, created_by_id as createdById,
           created_at as createdAt, updated_at as updatedAt, deleted_at as deletedAt
    FROM custom_apps
    WHERE deleted_at IS NULL
    ORDER BY updated_at DESC, created_at DESC
    LIMIT ?
  `).all(limit).map(rowToCustomApp);
}

export function createCustomApp(input: Record<string, unknown>, actor?: { type: string; id: string }) {
  const now = Date.now();
  const id = normalizeId(input.id);
  const name = sanitizeText(input.name, "name", MAX_APP_NAME_LENGTH, "Untitled Tool");
  const description = sanitizeText(input.description, "description", MAX_APP_DESCRIPTION_LENGTH, "Generated LifeOS tool");
  const visibility = normalizeVisibility(input.visibility);
  const status = normalizeStatus(input.status);
  const source = normalizeSource(input.source);
  const problemBlueprintId = sanitizeOptionalText(input.problemBlueprintId, 120) || null;
  const code = sanitizeCode(input.code);

  db.prepare(`
    INSERT INTO custom_apps (
      id, name, description, visibility, status, source, problem_blueprint_id, code,
      created_by_type, created_by_id, created_at, updated_at, deleted_at
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL)
    ON CONFLICT(id) DO UPDATE SET
      name = excluded.name,
      description = excluded.description,
      visibility = excluded.visibility,
      status = excluded.status,
      source = excluded.source,
      problem_blueprint_id = COALESCE(excluded.problem_blueprint_id, custom_apps.problem_blueprint_id),
      code = excluded.code,
      updated_at = excluded.updated_at,
      deleted_at = NULL
  `).run(
    id,
    name,
    description,
    visibility,
    status,
    source,
    problemBlueprintId,
    code,
    actor?.type || null,
    actor?.id || null,
    now,
    now,
  );
  appendCustomAppVersionIfChanged(id, code, source === "migration" ? "Imported from legacy client state" : "Initial version", actor);

  return getCustomApp(id)!;
}

export function updateCustomApp(id: string, input: Record<string, unknown>, actor?: { type: string; id: string }) {
  const existing = getCustomApp(id);
  if (!existing) return null;

  const next = {
    name: input.name === undefined ? existing.name : sanitizeText(input.name, "name", MAX_APP_NAME_LENGTH),
    description: input.description === undefined ? existing.description : sanitizeText(input.description, "description", MAX_APP_DESCRIPTION_LENGTH),
    visibility: input.visibility === undefined ? existing.visibility : normalizeVisibility(input.visibility),
    status: input.status === undefined ? existing.status : normalizeStatus(input.status),
    problemBlueprintId: input.problemBlueprintId === undefined ? existing.problemBlueprintId || null : sanitizeOptionalText(input.problemBlueprintId, 120) || null,
    code: input.code === undefined ? existing.code : sanitizeCode(input.code),
  };
  const updatedAt = Date.now();

  db.prepare(`
    UPDATE custom_apps
    SET name = ?, description = ?, visibility = ?, status = ?, problem_blueprint_id = ?, code = ?, updated_at = ?
    WHERE id = ? AND deleted_at IS NULL
  `).run(next.name, next.description, next.visibility, next.status, next.problemBlueprintId, next.code, updatedAt, id);
  if (input.code !== undefined) appendCustomAppVersionIfChanged(id, next.code, "Saved edit", actor);

  return getCustomApp(id);
}

export function rollbackCustomAppVersion(appId: string, version: number, actor?: { type: string; id: string }) {
  const app = getCustomApp(appId);
  if (!app) return null;
  const target = getCustomAppVersion(appId, version);
  if (!target) throw statusError("Custom app version not found", 404);
  const updatedAt = Date.now();
  db.prepare("UPDATE custom_apps SET code = ?, status = 'active', updated_at = ? WHERE id = ? AND deleted_at IS NULL").run(target.code, updatedAt, appId);
  const rollbackVersion = appendCustomAppVersionIfChanged(appId, target.code, `Rolled back to v${version}`, actor);
  return { app: getCustomApp(appId)!, version: rollbackVersion };
}

export function getCustomAppState(appId: string) {
  const app = getCustomApp(appId);
  if (!app) return null;
  const row = db.prepare(`
    SELECT app_id as appId, state_json as stateJson, updated_by_type as updatedByType,
           updated_by_id as updatedById, updated_at as updatedAt
    FROM custom_app_state
    WHERE app_id = ?
  `).get(appId) as any;
  if (row) return rowToCustomAppState(row);
  return { appId, state: {}, updatedAt: 0, updatedByType: null, updatedById: null };
}

export function updateCustomAppState(appId: string, value: unknown, actor?: { type: string; id: string }) {
  const app = getCustomApp(appId);
  if (!app) return null;
  const now = Date.now();
  const { state, json } = sanitizeState(value);
  db.prepare(`
    INSERT INTO custom_app_state (app_id, state_json, updated_by_type, updated_by_id, updated_at)
    VALUES (?, ?, ?, ?, ?)
    ON CONFLICT(app_id) DO UPDATE SET
      state_json = excluded.state_json,
      updated_by_type = excluded.updated_by_type,
      updated_by_id = excluded.updated_by_id,
      updated_at = excluded.updated_at
  `).run(appId, json, actor?.type || null, actor?.id || null, now);
  return { appId, state, updatedAt: now, updatedByType: actor?.type || null, updatedById: actor?.id || null };
}

function actionSchemesForPolicyTemplate(template: CustomAppActionPolicyTemplate) {
  if (template === "global") return allowedActionSchemes();
  return [...CUSTOM_APP_ACTION_POLICY_SCHEMES[template]];
}

export function getCustomAppActionPolicy(appId: string) {
  const app = getCustomApp(appId);
  if (!app) return null;
  const row = db.prepare(`
    SELECT app_id as appId, template, allowed_schemes_json as allowedSchemesJson,
           require_confirmation as requireConfirmation, updated_by_type as updatedByType,
           updated_by_id as updatedById, updated_at as updatedAt
    FROM custom_app_action_policies
    WHERE app_id = ?
  `).get(appId) as any;
  return row ? rowToCustomAppActionPolicy(row) : defaultCustomAppActionPolicy(appId);
}

export function updateCustomAppActionPolicy(appId: string, input: Record<string, unknown>, actor?: { type: string; id: string }) {
  const app = getCustomApp(appId);
  if (!app) return null;
  const template = normalizePolicyTemplate(input.template);
  const templateSchemes = actionSchemesForPolicyTemplate(template);
  const allowedSchemes = input.allowedSchemes === undefined
    ? templateSchemes
    : normalizeActionSchemes(input.allowedSchemes, templateSchemes);
  const requireConfirmation = input.requireConfirmation === undefined ? true : input.requireConfirmation !== false;
  const updatedAt = Date.now();

  db.prepare(`
    INSERT INTO custom_app_action_policies (
      app_id, template, allowed_schemes_json, require_confirmation, updated_by_type, updated_by_id, updated_at
    )
    VALUES (?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(app_id) DO UPDATE SET
      template = excluded.template,
      allowed_schemes_json = excluded.allowed_schemes_json,
      require_confirmation = excluded.require_confirmation,
      updated_by_type = excluded.updated_by_type,
      updated_by_id = excluded.updated_by_id,
      updated_at = excluded.updated_at
  `).run(
    appId,
    template,
    JSON.stringify(allowedSchemes),
    requireConfirmation ? 1 : 0,
    actor?.type || null,
    actor?.id || null,
    updatedAt,
  );

  return getCustomAppActionPolicy(appId)!;
}

export function getCustomAppCapabilityManifest(appId: string) {
  const app = getCustomApp(appId);
  if (!app) return null;
  const row = db.prepare(`
    SELECT app_id as appId, allowed_capabilities_json as allowedCapabilitiesJson,
           declared_capabilities_json as declaredCapabilitiesJson, risk_level as riskLevel,
           updated_by_type as updatedByType, updated_by_id as updatedById, updated_at as updatedAt
    FROM custom_app_capability_manifests
    WHERE app_id = ?
  `).get(appId) as any;
  return row ? rowToCustomAppCapabilityManifest(row) : defaultCustomAppCapabilityManifest(appId);
}

export function updateCustomAppCapabilityManifest(appId: string, input: Record<string, unknown>, actor?: { type: string; id: string }) {
  const app = getCustomApp(appId);
  if (!app) return null;
  const current = getCustomAppCapabilityManifest(appId) || defaultCustomAppCapabilityManifest(appId);
  const allowedCapabilities = normalizeCustomAppCapabilities(
    input.allowedCapabilities ?? input.capabilities,
    current.allowedCapabilities,
  );
  const declaredCapabilities = normalizeCustomAppCapabilities(
    input.declaredCapabilities,
    allowedCapabilities,
  );
  const riskLevel = riskForCustomAppCapabilities(allowedCapabilities);
  const updatedAt = Date.now();

  db.prepare(`
    INSERT INTO custom_app_capability_manifests (
      app_id, allowed_capabilities_json, declared_capabilities_json, risk_level,
      updated_by_type, updated_by_id, updated_at
    )
    VALUES (?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(app_id) DO UPDATE SET
      allowed_capabilities_json = excluded.allowed_capabilities_json,
      declared_capabilities_json = excluded.declared_capabilities_json,
      risk_level = excluded.risk_level,
      updated_by_type = excluded.updated_by_type,
      updated_by_id = excluded.updated_by_id,
      updated_at = excluded.updated_at
  `).run(
    appId,
    JSON.stringify(allowedCapabilities),
    JSON.stringify(declaredCapabilities),
    riskLevel,
    actor?.type || null,
    actor?.id || null,
    updatedAt,
  );

  return getCustomAppCapabilityManifest(appId)!;
}

export function customAppHasCapabilities(appId: string, requiredCapabilities: CustomAppCapabilityId[]) {
  const manifest = getCustomAppCapabilityManifest(appId);
  if (!manifest) return null;
  const allowed = new Set(manifest.allowedCapabilities);
  const missingCapabilities = requiredCapabilities.filter((capability) => !allowed.has(capability));
  return {
    manifest,
    ok: missingCapabilities.length === 0,
    missingCapabilities,
  };
}

function selectCustomAppActionRequest(appId: string, requestId: string) {
  return db.prepare(`
    SELECT id, app_id as appId, action_type as actionType, label, target_url as targetUrl,
           target_scheme as targetScheme, params_summary as paramsSummary, risk, status, reason,
           created_by_type as createdByType, created_by_id as createdById, created_at as createdAt,
           decided_by_type as decidedByType, decided_by_id as decidedById, decided_at as decidedAt,
           decision_note as decisionNote
    FROM custom_app_action_requests
    WHERE app_id = ? AND id = ?
  `).get(appId, requestId) as any;
}

export function getCustomAppActionRequest(appId: string, requestId: string) {
  const row = selectCustomAppActionRequest(appId, requestId);
  return row ? rowToCustomAppActionRequest(row) : null;
}

export function listCustomAppActionRequests(appId: string, limitInput?: unknown) {
  const app = getCustomApp(appId);
  if (!app) return null;
  const limit = normalizeLimit(limitInput);
  return db.prepare(`
    SELECT id, app_id as appId, action_type as actionType, label, target_url as targetUrl,
           target_scheme as targetScheme, params_summary as paramsSummary, risk, status, reason,
           created_by_type as createdByType, created_by_id as createdById, created_at as createdAt,
           decided_by_type as decidedByType, decided_by_id as decidedById, decided_at as decidedAt,
           decision_note as decisionNote
    FROM custom_app_action_requests
    WHERE app_id = ?
    ORDER BY created_at DESC
    LIMIT ?
  `).all(appId, limit).map(rowToCustomAppActionRequest);
}

export function createCustomAppActionRequest(appId: string, input: Record<string, unknown>, actor?: { type: string; id: string }) {
  const app = getCustomApp(appId);
  if (!app) return null;
  const actionType = String(input.actionType || input.type || "open_url").trim();
  if (actionType !== "open_url") throw statusError("Unsupported custom app action type");
  const { targetUrl, scheme } = sanitizeActionTargetUrl(input.targetUrl);
  const label = sanitizeActionText(input.label, 120, "Open URL") || "Open URL";
  const reason = sanitizeActionText(input.reason, 400) || null;
  const policy = getCustomAppActionPolicy(appId) || defaultCustomAppActionPolicy(appId);
  const allowedSchemes = policy.allowedSchemes;
  const requiredCapabilities = requiredCapabilitiesForActionScheme(scheme);
  const capabilityCheck = customAppHasCapabilities(appId, requiredCapabilities);
  const status: CustomAppActionStatus = BLOCKED_ACTION_SCHEMES.has(scheme) || !allowedSchemes.includes(scheme) || capabilityCheck?.ok === false
    ? "blocked"
    : "pending";
  const now = Date.now();
  const id = `app-action-${crypto.randomUUID()}`;
  const redactedTargetUrl = redactActionUrl(targetUrl);
  const paramsSummary = summarizeActionParams(targetUrl);
  const risk = status === "blocked" ? "high" : riskForActionScheme(scheme);
  db.prepare(`
    INSERT INTO custom_app_action_requests (
      id, app_id, action_type, label, target_url, target_scheme, params_summary, risk, status, reason,
      created_by_type, created_by_id, created_at
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    id,
    appId,
    actionType,
    label,
    redactedTargetUrl,
    scheme,
    paramsSummary,
    risk,
    status,
    reason,
    actor?.type || null,
    actor?.id || null,
    now,
  );
  return getCustomAppActionRequest(appId, id)!;
}

export function decideCustomAppActionRequest(
  appId: string,
  requestId: string,
  decision: "approved" | "cancelled",
  actor?: { type: string; id: string },
  note?: unknown,
) {
  const request = getCustomAppActionRequest(appId, requestId);
  if (!request) return null;
  if (request.status !== "pending") throw statusError(`Custom app action request is already ${request.status}`, 409);
  const decidedAt = Date.now();
  const decisionNote = sanitizeActionText(note, 240) || null;
  db.prepare(`
    UPDATE custom_app_action_requests
    SET status = ?, decided_by_type = ?, decided_by_id = ?, decided_at = ?, decision_note = ?
    WHERE app_id = ? AND id = ? AND status = 'pending'
  `).run(decision, actor?.type || null, actor?.id || null, decidedAt, decisionNote, appId, requestId);
  return getCustomAppActionRequest(appId, requestId)!;
}

export function deleteCustomApp(id: string) {
  const existing = getCustomApp(id);
  if (!existing) return null;
  const deletedAt = Date.now();
  db.prepare("UPDATE custom_apps SET deleted_at = ?, updated_at = ? WHERE id = ? AND deleted_at IS NULL").run(deletedAt, deletedAt, id);
  return { ...existing, deletedAt, updatedAt: deletedAt };
}

export function migrateLegacyCustomAppsFromClientState() {
  const migratedMarker = db.prepare("SELECT value_json as valueJson FROM client_state WHERE key = 'lifeos_apps_migrated_to_sqlite'").get() as any;
  if (migratedMarker) return 0;

  const row = db.prepare("SELECT value_json as valueJson FROM client_state WHERE key = 'lifeos_apps'").get() as any;
  if (!row) return 0;

  let imported = 0;
  try {
    const apps = JSON.parse(row.valueJson);
    if (!Array.isArray(apps)) return 0;
    for (const app of apps) {
      if (!app || typeof app !== "object") continue;
      const id = normalizeId((app as any).id);
      const exists = db.prepare("SELECT id FROM custom_apps WHERE id = ?").get(id);
      if (exists) continue;
      createCustomApp({ ...(app as any), id, source: "migration" });
      imported += 1;
    }
    db.prepare(`
      INSERT INTO client_state (key, value_json, updated_at, updated_by_type, updated_by_id)
      VALUES ('lifeos_apps_migrated_to_sqlite', 'true', ?, 'system', NULL)
      ON CONFLICT(key) DO UPDATE SET value_json = excluded.value_json, updated_at = excluded.updated_at
    `).run(Date.now());
  } catch (error) {
    console.warn("Failed to migrate legacy custom apps:", error);
  }
  return imported;
}
