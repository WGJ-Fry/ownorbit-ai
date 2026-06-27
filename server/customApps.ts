import crypto from "crypto";
import { db } from "./db";
import { redactAuditString } from "./audit";
import { getClientState } from "./clientState";

const MAX_APP_NAME_LENGTH = 120;
const MAX_APP_DESCRIPTION_LENGTH = 800;
const MAX_APP_CODE_BYTES = Number(process.env.LIFEOS_MAX_CUSTOM_APP_CODE_BYTES || 512 * 1024);
const MAX_APP_STATE_BYTES = Number(process.env.LIFEOS_MAX_CUSTOM_APP_STATE_BYTES || 256 * 1024);
const MAX_APP_RUNTIME_DETAIL_BYTES = Number(process.env.LIFEOS_MAX_CUSTOM_APP_RUNTIME_DETAIL_BYTES || 8 * 1024);
const VERSION_COMPARE_PREVIEW_LIMIT = 8;
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
export type CustomAppCapabilityRequestStatus = "pending" | "approved" | "denied";
export type CustomAppRuntimeEventType =
  | "opened"
  | "ready"
  | "console"
  | "error"
  | "state_read"
  | "state_saved"
  | "action_requested"
  | "capability_requested"
  | "debug_requested"
  | "debug_applied"
  | "auto_repair_planned"
  | "auto_repair_blocked"
  | "auto_repair_applied"
  | "auto_repair_needs_review";
export type CustomAppRuntimeSeverity = "info" | "warning" | "error";

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

export type CustomAppVersionComparison = {
  appId: string;
  fromVersion: number;
  toVersion: number;
  fromCreatedAt: number;
  toCreatedAt: number;
  fromNote?: string | null;
  toNote?: string | null;
  fromBytes: number;
  toBytes: number;
  addedLines: number;
  removedLines: number;
  changedLines: number;
  unchangedLines: number;
  totalChangedLines: number;
  risk: CustomAppActionRisk;
  riskNotes: string[];
  reviewChecklist: string[];
  repairHints: string[];
  preview: {
    added: string[];
    removed: string[];
    changed: Array<{ before: string; after: string }>;
  };
};

export type CustomAppRepairProposal = {
  appId: string;
  appName: string;
  issue: string;
  risk: CustomAppActionRisk;
  suspectedArea: "runtime-error" | "state" | "capability" | "action-policy" | "unknown";
  summary: string;
  evidence: string[];
  repairSteps: string[];
  permissionReview: string[];
  versionSafety: string[];
  executionPlan: CustomAppRepairExecutionPlan;
  suggestedInstruction: string;
  generatedAt: number;
};

export type CustomAppRepairExecutionPlan = {
  mode: "auto-save" | "manual-review" | "blocked";
  canAutoApply: boolean;
  reasonKey: "low-risk-runtime" | "needs-permission-review" | "high-risk-action" | "unknown-area" | "retry-limit";
  checks: string[];
  nextSteps: string[];
};

export type CustomAppAutoRepairTask = {
  id: string;
  appId: string;
  status: "ready" | "blocked";
  mode: CustomAppRepairExecutionPlan["mode"];
  canAutoApply: boolean;
  reasonKey: CustomAppRepairExecutionPlan["reasonKey"];
  suggestedInstruction: string;
  requiredChecks: string[];
  nextSteps: string[];
  repairAttempt: number;
  retryLimit: number;
  rollbackVersion?: number | null;
  createdAt: number;
};

export type CustomAppAutoRepairResult = {
  id: string;
  appId: string;
  taskId?: string;
  status: "applied" | "needs-review" | "unchanged" | "blocked";
  fromVersion?: number | null;
  toVersion?: number | null;
  comparisonRisk?: CustomAppActionRisk | null;
  rollbackVersion?: number | null;
  rollbackAvailable: boolean;
  verification: {
    status: "pending-smoke" | "needs-review" | "not-changed";
    requiredChecks: string[];
    failures: string[];
  };
  nextSteps: string[];
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

export type StoredCustomAppCapabilityRequest = {
  id: string;
  appId: string;
  requestedCapabilities: CustomAppCapabilityId[];
  missingCapabilities: CustomAppCapabilityId[];
  label: string;
  reason?: string | null;
  risk: CustomAppCapabilityRisk;
  status: CustomAppCapabilityRequestStatus;
  createdByType?: string | null;
  createdById?: string | null;
  createdAt: number;
  decidedByType?: string | null;
  decidedById?: string | null;
  decidedAt?: number | null;
  decisionNote?: string | null;
};

export type StoredCustomAppRuntimeEvent = {
  id: string;
  appId: string;
  eventType: CustomAppRuntimeEventType;
  severity: CustomAppRuntimeSeverity;
  label: string;
  message: string;
  detail: unknown;
  createdByType?: string | null;
  createdById?: string | null;
  createdAt: number;
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

function sanitizeCodePreviewLine(value: string) {
  return redactAuditString(value)
    .replace(/\+?\d[\d ().-]{6,}\d/g, "[redacted]")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 180);
}

function normalizeVersionNumber(value: unknown, label: string) {
  const version = Number.parseInt(String(value ?? ""), 10);
  if (!Number.isFinite(version) || version <= 0) throw statusError(`Invalid ${label} custom app version`);
  return version;
}

function splitComparableCode(code: string) {
  return String(code || "").replace(/\r\n/g, "\n").replace(/\r/g, "\n").split("\n");
}

function pushPreviewLine(target: string[], line: string) {
  if (target.length >= VERSION_COMPARE_PREVIEW_LIMIT) return;
  const preview = sanitizeCodePreviewLine(line);
  if (preview) target.push(preview);
}

function pushPreviewChange(target: Array<{ before: string; after: string }>, before: string, after: string) {
  if (target.length >= VERSION_COMPARE_PREVIEW_LIMIT) return;
  target.push({
    before: sanitizeCodePreviewLine(before) || "(empty)",
    after: sanitizeCodePreviewLine(after) || "(empty)",
  });
}

function analyzeCustomAppVersionRisk(toCode: string, totalChangedLines: number): { risk: CustomAppActionRisk; riskNotes: string[] } {
  const notes: string[] = [];
  let risk: CustomAppActionRisk = "low";
  const mark = (level: CustomAppActionRisk, note: string) => {
    if (!notes.includes(note)) notes.push(note);
    if (level === "high" || (level === "medium" && risk === "low")) risk = level;
  };

  const checks: Array<{ pattern: RegExp; level: CustomAppActionRisk; note: string }> = [
    { pattern: /\beval\s*\(|\bFunction\s*\(/i, level: "high", note: "Dynamic code execution changed; review for script injection risk." },
    { pattern: /<script\b|\.innerHTML\s*=|insertAdjacentHTML\s*\(/i, level: "high", note: "HTML/script injection surface changed; review generated markup carefully." },
    { pattern: /javascript:|data:|file:|blob:/i, level: "high", note: "Blocked or sensitive URL scheme appears in the target version." },
    { pattern: /\b(?:tel|sms|shortcuts):/i, level: "high", note: "Potential phone, SMS, or Shortcuts action changed; require user confirmation." },
    { pattern: /\bfetch\s*\(|XMLHttpRequest|WebSocket|EventSource/i, level: "medium", note: "Network access changed; verify destination, data sent, and user consent." },
    { pattern: /localStorage|sessionStorage|indexedDB|navigator\.clipboard/i, level: "medium", note: "Browser storage or clipboard access changed; verify private data handling." },
    { pattern: /location\.href|window\.open\s*\(|openExternal|requestAction/i, level: "medium", note: "External navigation/action bridge changed; review permission policy." },
  ];

  checks.forEach((check) => {
    if (check.pattern.test(toCode)) mark(check.level, check.note);
  });
  if (totalChangedLines >= 120) mark("medium", "Large version delta; run a full smoke test before replacing the active tool.");
  if (!notes.length) notes.push("No high-risk code pattern detected in the target version.");
  return { risk, riskNotes: notes.slice(0, 8) };
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

function normalizeRuntimeEventType(value: unknown): CustomAppRuntimeEventType {
  const type = String(value || "").trim();
  if (
    type === "opened"
    || type === "ready"
    || type === "console"
    || type === "error"
    || type === "state_read"
    || type === "state_saved"
    || type === "action_requested"
    || type === "capability_requested"
    || type === "debug_requested"
    || type === "debug_applied"
    || type === "auto_repair_planned"
    || type === "auto_repair_blocked"
    || type === "auto_repair_applied"
    || type === "auto_repair_needs_review"
  ) {
    return type;
  }
  return "console";
}

function normalizeRuntimeSeverity(value: unknown, eventType: CustomAppRuntimeEventType): CustomAppRuntimeSeverity {
  if (value === "error" || eventType === "error") return "error";
  if (value === "warning") return "warning";
  return "info";
}

function sanitizeRuntimeDetailValue(value: unknown, depth = 0): unknown {
  if (depth > 5) return "[truncated]";
  if (typeof value === "string") return sanitizeActionText(value, 1000);
  if (Array.isArray(value)) return value.slice(0, 20).map((item) => sanitizeRuntimeDetailValue(item, depth + 1));
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>)
      .slice(0, 40)
      .map(([key, item]) => [
        sensitiveStateKey.test(key) ? "[redacted]" : sanitizeActionText(key, 80, "field"),
        sanitizeRuntimeDetailValue(item, depth + 1),
      ]),
  );
}

function serializeRuntimeDetail(value: unknown) {
  const sanitized = sanitizeRuntimeDetailValue(value ?? {});
  let json = JSON.stringify(sanitized);
  if (Buffer.byteLength(json, "utf8") <= MAX_APP_RUNTIME_DETAIL_BYTES) return json;
  json = JSON.stringify({ truncated: true, preview: sanitizeActionText(json, Math.max(120, MAX_APP_RUNTIME_DETAIL_BYTES - 64)) });
  return json;
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

function rowToCustomAppCapabilityRequest(row: any): StoredCustomAppCapabilityRequest {
  let requestedCapabilities: CustomAppCapabilityId[] = [];
  let missingCapabilities: CustomAppCapabilityId[] = [];
  try {
    requestedCapabilities = normalizeCustomAppCapabilities(JSON.parse(row.requestedCapabilitiesJson || "[]"), []);
  } catch {
    requestedCapabilities = [];
  }
  try {
    missingCapabilities = normalizeCustomAppCapabilities(JSON.parse(row.missingCapabilitiesJson || "[]"), []);
  } catch {
    missingCapabilities = [];
  }
  return {
    id: row.id,
    appId: row.appId,
    requestedCapabilities,
    missingCapabilities,
    label: row.label,
    reason: row.reason,
    risk: row.risk === "high" || row.risk === "low" ? row.risk : "medium",
    status: row.status === "approved" || row.status === "denied" ? row.status : "pending",
    createdByType: row.createdByType,
    createdById: row.createdById,
    createdAt: row.createdAt,
    decidedByType: row.decidedByType,
    decidedById: row.decidedById,
    decidedAt: row.decidedAt,
    decisionNote: row.decisionNote,
  };
}

function rowToCustomAppRuntimeEvent(row: any): StoredCustomAppRuntimeEvent {
  let detail: unknown = {};
  try {
    detail = JSON.parse(row.detailJson || "{}");
  } catch {
    detail = {};
  }
  const eventType = normalizeRuntimeEventType(row.eventType);
  return {
    id: row.id,
    appId: row.appId,
    eventType,
    severity: normalizeRuntimeSeverity(row.severity, eventType),
    label: row.label,
    message: row.message,
    detail,
    createdByType: row.createdByType,
    createdById: row.createdById,
    createdAt: row.createdAt,
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

export function compareCustomAppVersions(appId: string, fromVersionInput?: unknown, toVersionInput?: unknown): CustomAppVersionComparison | null {
  const app = getCustomApp(appId);
  if (!app) return null;
  const versionRows = db.prepare(`
    SELECT version
    FROM custom_app_versions
    WHERE app_id = ?
    ORDER BY version ASC
  `).all(appId) as Array<{ version: number }>;
  if (versionRows.length < 2) throw statusError("At least two custom app versions are required", 404);

  const hasFrom = fromVersionInput !== undefined && fromVersionInput !== null && String(fromVersionInput).trim() !== "";
  const hasTo = toVersionInput !== undefined && toVersionInput !== null && String(toVersionInput).trim() !== "";
  let toVersion = hasTo ? normalizeVersionNumber(toVersionInput, "target") : versionRows[versionRows.length - 1].version;
  let fromVersion = hasFrom ? normalizeVersionNumber(fromVersionInput, "source") : 0;
  if (!hasFrom) {
    const toIndex = versionRows.findIndex((row) => row.version === toVersion);
    if (toIndex <= 0) throw statusError("A previous custom app version is required", 404);
    fromVersion = versionRows[toIndex - 1].version;
  }
  if (fromVersion === toVersion) throw statusError("Choose two different custom app versions");

  const from = getCustomAppVersion(appId, fromVersion);
  const to = getCustomAppVersion(appId, toVersion);
  if (!from || !to) throw statusError("Custom app version not found", 404);

  const fromLines = splitComparableCode(from.code);
  const toLines = splitComparableCode(to.code);
  const preview: CustomAppVersionComparison["preview"] = { added: [], removed: [], changed: [] };
  let addedLines = 0;
  let removedLines = 0;
  let changedLines = 0;
  let unchangedLines = 0;
  const maxLines = Math.max(fromLines.length, toLines.length);
  for (let index = 0; index < maxLines; index += 1) {
    const before = fromLines[index];
    const after = toLines[index];
    if (before === after) {
      unchangedLines += 1;
      continue;
    }
    if (before === undefined) {
      addedLines += 1;
      pushPreviewLine(preview.added, after || "");
      continue;
    }
    if (after === undefined) {
      removedLines += 1;
      pushPreviewLine(preview.removed, before || "");
      continue;
    }
    changedLines += 1;
    pushPreviewChange(preview.changed, before, after);
  }

  const totalChangedLines = addedLines + removedLines + changedLines;
  const risk = analyzeCustomAppVersionRisk(to.code, totalChangedLines);
  return {
    appId,
    fromVersion,
    toVersion,
    fromCreatedAt: from.createdAt,
    toCreatedAt: to.createdAt,
    fromNote: from.note,
    toNote: to.note,
    fromBytes: Buffer.byteLength(from.code || "", "utf8"),
    toBytes: Buffer.byteLength(to.code || "", "utf8"),
    addedLines,
    removedLines,
    changedLines,
    unchangedLines,
    totalChangedLines,
    risk: risk.risk,
    riskNotes: risk.riskNotes,
    reviewChecklist: [
      "Review the added and changed preview lines before replacing the active generated tool.",
      risk.risk === "high"
        ? "Confirm every phone, SMS, shortcut, script, network, or external app action in the permission center."
        : "Run the generated tool once in Studio and verify the main workflow still works.",
      "Keep rollback available until existing saved state, imports, and local actions have been smoke-tested.",
    ],
    repairHints: [
      `If the new version behaves unexpectedly, roll back to v${fromVersion} and compare again after repair.`,
      "Ask Studio to repair only the changed workflow or permission surface, then create a new version.",
      "For stateful tools, test with existing saved state before deleting older versions.",
    ],
    preview,
  };
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

export function listCustomAppRuntimeEvents(appId: string, limitInput?: unknown) {
  const app = getCustomApp(appId);
  if (!app) return null;
  const limit = normalizeLimit(limitInput);
  return db.prepare(`
    SELECT id, app_id as appId, event_type as eventType, severity, label, message,
           detail_json as detailJson, created_by_type as createdByType, created_by_id as createdById,
           created_at as createdAt
    FROM custom_app_runtime_events
    WHERE app_id = ?
    ORDER BY created_at DESC
    LIMIT ?
  `).all(appId, limit).map(rowToCustomAppRuntimeEvent);
}

export function createCustomAppRuntimeEvent(appId: string, input: Record<string, unknown>, actor?: { type: string; id: string }) {
  const app = getCustomApp(appId);
  if (!app) return null;
  const eventType = normalizeRuntimeEventType(input.eventType ?? input.type);
  const severity = normalizeRuntimeSeverity(input.severity, eventType);
  const label = sanitizeActionText(input.label, 120, eventType.replace(/_/g, " ")) || eventType;
  const message = sanitizeActionText(input.message, 1000, label) || label;
  const detailJson = serializeRuntimeDetail(input.detail ?? input.details ?? {});
  const now = Date.now();
  const id = `app-event-${crypto.randomUUID()}`;
  db.prepare(`
    INSERT INTO custom_app_runtime_events (
      id, app_id, event_type, severity, label, message, detail_json, created_by_type, created_by_id, created_at
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    id,
    appId,
    eventType,
    severity,
    label,
    message,
    detailJson,
    actor?.type || null,
    actor?.id || null,
    now,
  );
  const row = db.prepare(`
    SELECT id, app_id as appId, event_type as eventType, severity, label, message,
           detail_json as detailJson, created_by_type as createdByType, created_by_id as createdById,
           created_at as createdAt
    FROM custom_app_runtime_events
    WHERE id = ?
  `).get(id) as any;
  return row ? rowToCustomAppRuntimeEvent(row) : null;
}

function buildDebugInstruction(app: StoredCustomApp, issue: string, recentEvents: StoredCustomAppRuntimeEvent[]) {
  const recentErrors = recentEvents
    .filter((event) => event.severity === "error")
    .slice(0, 3)
    .map((event) => `${event.label}: ${event.message}`)
    .join("；");
  const context = recentErrors ? `最近运行错误：${recentErrors}。` : "最近没有捕获到明确错误，请检查交互、状态保存和边界输入。";
  return sanitizeActionText(
    `请修复这个 LifeOS 生成程序“${app.name}”的问题：${issue}。${context} 保留现有核心功能和本地状态；如果需要新能力，请通过 lifeosApp.requestCapability 申请，不要绕过权限；输出完整可运行 HTML/CSS/JS。`,
    1200,
  );
}

function buildRepairProposal(
  app: StoredCustomApp,
  issue: string,
  recentEvents: StoredCustomAppRuntimeEvent[],
  suggestedInstruction: string,
): CustomAppRepairProposal {
  const errorEvents = recentEvents.filter((event) => event.severity === "error");
  const actionEvents = recentEvents.filter((event) => event.eventType === "action_requested");
  const capabilityEvents = recentEvents.filter((event) => event.eventType === "capability_requested");
  const stateEvents = recentEvents.filter((event) => event.eventType === "state_saved" || event.eventType === "state_read");
  const issueText = `${issue} ${recentEvents.map((event) => `${event.label} ${event.message}`).join(" ")}`.toLowerCase();
  const suspectedArea: CustomAppRepairProposal["suspectedArea"] = capabilityEvents.length
    ? "capability"
    : actionEvents.length
      ? "action-policy"
      : stateEvents.some((event) => event.severity === "error") || /state|storage|保存|状态/.test(issueText)
        ? "state"
        : errorEvents.length
          ? "runtime-error"
          : "unknown";
  const risk: CustomAppActionRisk = suspectedArea === "capability" || suspectedArea === "action-policy" || /phone|sms|shortcut|network|clipboard|file|电话|短信|快捷指令|联网|剪贴板|文件/.test(issueText)
    ? "high"
    : errorEvents.length > 0
      ? "medium"
      : "low";
  const evidence = [
    `${errorEvents.length} recent error event(s)`,
    `${actionEvents.length} action request event(s)`,
    `${capabilityEvents.length} capability request event(s)`,
    ...recentEvents.slice(0, 3).map((event) => `${event.eventType}/${event.severity}: ${event.label} - ${event.message}`),
  ].map((item) => sanitizeActionText(item, 240)).filter(Boolean);
  const repairSteps = [
    "Reproduce the issue with the latest saved app version before editing.",
    suspectedArea === "state" ? "Patch only state read/write shape, migrations, and empty/corrupt state handling." : "Patch the smallest failing workflow and keep existing user data shape.",
    suspectedArea === "capability" ? "If a new capability is required, request it with window.lifeosApp.requestCapability and explain why in the UI." : "Do not add new capabilities unless the failing workflow explicitly needs them.",
    "Run the main user flow once, then save as a new version instead of overwriting history.",
  ];
  const permissionReview = [
    "Do not bypass the LifeOS capability manifest, action policy, URL Scheme whitelist, or confirmation dialogs.",
    "Keep phone, SMS, Shortcuts, file import, clipboard, and external network actions behind explicit user confirmation.",
    risk === "high" ? "Review the mobile action permission center before applying this repair." : "Confirm no new high-risk action surface was introduced.",
  ];
  const versionSafety = [
    "Compare the repaired version against the previous saved version before promoting it.",
    "If the repair fails, roll back to the last working version and generate a narrower proposal.",
    "Preserve local state keys unless a migration is shown in the UI.",
  ];
  const executionPlan = buildRepairExecutionPlan(risk, suspectedArea);
  return {
    appId: app.id,
    appName: app.name,
    issue,
    risk,
    suspectedArea,
    summary: sanitizeActionText(`Repair ${app.name}: ${suspectedArea} / ${risk}`, 240),
    evidence,
    repairSteps,
    permissionReview,
    versionSafety,
    executionPlan,
    suggestedInstruction,
    generatedAt: Date.now(),
  };
}

function buildRepairExecutionPlan(
  risk: CustomAppActionRisk,
  suspectedArea: CustomAppRepairProposal["suspectedArea"],
): CustomAppRepairExecutionPlan {
  const checks = [
    "Keep the previous saved version available for rollback.",
    "Compare changed code before promoting the repaired version.",
    "Run the main generated-tool workflow once after repair.",
  ];
  if (risk === "high" || suspectedArea === "capability" || suspectedArea === "action-policy") {
    return {
      mode: "manual-review",
      canAutoApply: false,
      reasonKey: risk === "high" ? "high-risk-action" : "needs-permission-review",
      checks: [
        ...checks,
        "Review capability requests, URL schemes, and user-confirmation copy before saving.",
        "Use manual refine after confirming the permission boundary.",
      ],
      nextSteps: [
        "Copy the repair instruction into the refine box.",
        "Review requested capabilities, permission boundaries, and action-policy changes.",
        "Run version compare before saving or publishing the repaired tool.",
      ],
    };
  }
  if (suspectedArea === "unknown") {
    return {
      mode: "manual-review",
      canAutoApply: false,
      reasonKey: "unknown-area",
      checks: [
        ...checks,
        "Add a clearer issue description or reproduce the failure before auto-saving.",
      ],
      nextSteps: [
        "Request a narrower repair proposal with a concrete failure.",
        "Apply manually only after the changed area is clear.",
      ],
    };
  }
  return {
    mode: "auto-save",
    canAutoApply: true,
    reasonKey: "low-risk-runtime",
    checks,
    nextSteps: [
      "Auto-apply the generated repair instruction.",
      "Save the repaired code as a new version.",
      "Compare with the previous version and roll back if the sample task fails.",
    ],
  };
}

export function createCustomAppDebugRequest(appId: string, input: Record<string, unknown>, actor?: { type: string; id: string }) {
  const app = getCustomApp(appId);
  if (!app) return null;
  const recentEvents = listCustomAppRuntimeEvents(appId, 8) || [];
  const issue = sanitizeActionText(input.issue ?? input.message, 500, "请根据最近运行日志修复程序问题");
  const suggestedInstruction = buildDebugInstruction(app, issue, recentEvents);
  const repairProposal = buildRepairProposal(app, issue, recentEvents, suggestedInstruction);
  const event = createCustomAppRuntimeEvent(appId, {
    eventType: "debug_requested",
    severity: "warning",
    label: "Debug repair requested",
    message: issue,
    detail: {
      repairProposal,
      suggestedInstruction,
      recentEventIds: recentEvents.map((item) => item.id),
    },
  }, actor);
  return { event, repairProposal, suggestedInstruction, recentEvents };
}

export function createCustomAppAutoRepairPlan(appId: string, input: Record<string, unknown>, actor?: { type: string; id: string }) {
  const app = getCustomApp(appId);
  if (!app) return null;
  const debug = createCustomAppDebugRequest(appId, input, actor);
  if (!debug) return null;
  const retryLimit = 2;
  const latestVersion = latestCustomAppVersion(appId);
  const recentAfterDebug = listCustomAppRuntimeEvents(appId, 25) || [];
  const completedRepairCount = recentAfterDebug.filter((event) => event.eventType === "debug_applied").length;
  const repairAttempt = completedRepairCount + 1;
  const exceededRetryLimit = completedRepairCount >= retryLimit;
  const basePlan = debug.repairProposal.executionPlan;
  const canAutoApply = basePlan.canAutoApply && !exceededRetryLimit;
  const status: CustomAppAutoRepairTask["status"] = canAutoApply ? "ready" : "blocked";
  const reasonKey: CustomAppRepairExecutionPlan["reasonKey"] = exceededRetryLimit ? "retry-limit" : basePlan.reasonKey;
  const nextSteps = exceededRetryLimit
    ? [
        "Stop auto-applying repairs for this app until a human reviews the recent failed attempts.",
        "Open version compare, roll back to the last working version if needed, then write a narrower repair instruction.",
        ...basePlan.nextSteps.slice(0, 2),
      ]
    : basePlan.nextSteps;
  const task: CustomAppAutoRepairTask = {
    id: `auto-repair-${crypto.randomUUID()}`,
    appId,
    status,
    mode: canAutoApply ? basePlan.mode : "blocked",
    canAutoApply,
    reasonKey,
    suggestedInstruction: debug.suggestedInstruction,
    requiredChecks: [
      ...basePlan.checks,
      "Record the repair result in runtime events before attempting another auto repair.",
      "Use version rollback if the repaired tool fails its main workflow.",
    ],
    nextSteps,
    repairAttempt,
    retryLimit,
    rollbackVersion: latestVersion?.version || null,
    createdAt: Date.now(),
  };
  const autoRepairEvent = createCustomAppRuntimeEvent(appId, {
    eventType: status === "ready" ? "auto_repair_planned" : "auto_repair_blocked",
    severity: status === "ready" ? "info" : "warning",
    label: status === "ready" ? "Auto repair task ready" : "Auto repair blocked",
    message: sanitizeActionText(`${reasonKey}: ${debug.repairProposal.summary}`, 500),
    detail: {
      autoRepairTask: task,
      repairProposal: debug.repairProposal,
      debugEventId: debug.event?.id || null,
      recentEventIds: recentAfterDebug.map((item) => item.id),
    },
  }, actor);
  return {
    debugEvent: debug.event,
    autoRepairEvent,
    autoRepairTask: task,
    repairProposal: debug.repairProposal,
    suggestedInstruction: debug.suggestedInstruction,
    recentEvents: recentAfterDebug,
  };
}

export function completeCustomAppAutoRepair(appId: string, input: Record<string, unknown>, actor?: { type: string; id: string }) {
  const app = getCustomApp(appId);
  if (!app) return null;
  const latestVersion = latestCustomAppVersion(appId);
  const fromVersionInput = input.fromVersion ?? input.rollbackVersion;
  const fromVersion = fromVersionInput === undefined || fromVersionInput === null || String(fromVersionInput).trim() === ""
    ? null
    : normalizeVersionNumber(fromVersionInput, "source");
  const taskId = sanitizeOptionalText(input.taskId, 160);
  const instruction = sanitizeOptionalText(input.suggestedInstruction ?? input.instruction, 800);
  const requiredChecks = [
    "Open version compare and verify changed lines are limited to the failing workflow.",
    "Run the generated tool's main workflow once with sample input.",
    "Keep rollback available until the repaired version survives real use.",
  ];

  let status: CustomAppAutoRepairResult["status"] = "blocked";
  let comparison: CustomAppVersionComparison | null = null;
  let failures: string[] = [];
  if (!latestVersion) {
    failures = ["No saved custom app version exists after auto repair."];
  } else if (!fromVersion || latestVersion.version <= fromVersion) {
    status = "unchanged";
    failures = ["Auto repair did not create a newer saved version."];
  } else {
    comparison = compareCustomAppVersions(appId, fromVersion, latestVersion.version);
    status = comparison?.risk === "high" ? "needs-review" : "applied";
    if (comparison?.risk === "high") failures = ["Version comparison found high-risk changes that require manual review before continued auto repair."];
  }

  const verification: CustomAppAutoRepairResult["verification"] = {
    status: status === "unchanged" ? "not-changed" : status === "applied" ? "pending-smoke" : "needs-review",
    requiredChecks: comparison
      ? [...comparison.reviewChecklist.slice(0, 3), ...requiredChecks.slice(1)]
      : requiredChecks,
    failures,
  };
  const nextSteps = status === "applied"
    ? [
        "Run the repaired generated tool with the original failing scenario.",
        "If the smoke check fails, roll back and request a narrower repair.",
        "Do not attempt another auto repair until this result is recorded as reviewed.",
      ]
    : status === "needs-review"
      ? [
          "Review the version comparison before using the repaired app.",
          "Roll back if the repair added high-risk actions, network access, or permission changes.",
          "Switch to manual refine for the next repair attempt.",
        ]
      : [
          "Keep the current app version; no new repaired version was saved.",
          "Retry only after the AI returns complete code and Studio saves it successfully.",
        ];
  const now = Date.now();
  const result: CustomAppAutoRepairResult = {
    id: `auto-repair-result-${crypto.randomUUID()}`,
    appId,
    taskId,
    status,
    fromVersion,
    toVersion: latestVersion?.version || null,
    comparisonRisk: comparison?.risk || null,
    rollbackVersion: fromVersion,
    rollbackAvailable: Boolean(fromVersion && getCustomAppVersion(appId, fromVersion)),
    verification,
    nextSteps,
    createdAt: now,
  };
  const event = createCustomAppRuntimeEvent(appId, {
    eventType: status === "applied" ? "auto_repair_applied" : "auto_repair_needs_review",
    severity: status === "applied" ? "info" : "warning",
    label: status === "applied" ? "Auto repair applied" : "Auto repair needs review",
    message: sanitizeActionText(`${status}: ${instruction || "auto repair completion recorded"}`, 500),
    detail: {
      autoRepairResult: result,
      comparison: comparison ? {
        fromVersion: comparison.fromVersion,
        toVersion: comparison.toVersion,
        risk: comparison.risk,
        totalChangedLines: comparison.totalChangedLines,
        riskNotes: comparison.riskNotes,
      } : null,
    },
  }, actor);
  return { event, result, comparison };
}

function selectCustomAppCapabilityRequest(appId: string, requestId: string) {
  return db.prepare(`
    SELECT id, app_id as appId, requested_capabilities_json as requestedCapabilitiesJson,
           missing_capabilities_json as missingCapabilitiesJson, label, reason, risk, status,
           created_by_type as createdByType, created_by_id as createdById, created_at as createdAt,
           decided_by_type as decidedByType, decided_by_id as decidedById, decided_at as decidedAt,
           decision_note as decisionNote
    FROM custom_app_capability_requests
    WHERE app_id = ? AND id = ?
  `).get(appId, requestId) as any;
}

export function getCustomAppCapabilityRequest(appId: string, requestId: string) {
  const row = selectCustomAppCapabilityRequest(appId, requestId);
  return row ? rowToCustomAppCapabilityRequest(row) : null;
}

export function listCustomAppCapabilityRequests(appId: string, limitInput?: unknown) {
  const app = getCustomApp(appId);
  if (!app) return null;
  const limit = normalizeLimit(limitInput);
  return db.prepare(`
    SELECT id, app_id as appId, requested_capabilities_json as requestedCapabilitiesJson,
           missing_capabilities_json as missingCapabilitiesJson, label, reason, risk, status,
           created_by_type as createdByType, created_by_id as createdById, created_at as createdAt,
           decided_by_type as decidedByType, decided_by_id as decidedById, decided_at as decidedAt,
           decision_note as decisionNote
    FROM custom_app_capability_requests
    WHERE app_id = ?
    ORDER BY created_at DESC
    LIMIT ?
  `).all(appId, limit).map(rowToCustomAppCapabilityRequest);
}

export function createCustomAppCapabilityRequest(appId: string, input: Record<string, unknown>, actor?: { type: string; id: string }) {
  const app = getCustomApp(appId);
  if (!app) return null;
  const requestedCapabilities = normalizeCustomAppCapabilities(input.requestedCapabilities ?? input.capabilities, []);
  if (!requestedCapabilities.length) throw statusError("At least one capability is required");
  const capabilityCheck = customAppHasCapabilities(appId, requestedCapabilities);
  if (!capabilityCheck) return null;
  const missingCapabilities = capabilityCheck.missingCapabilities;
  const status: CustomAppCapabilityRequestStatus = missingCapabilities.length ? "pending" : "approved";
  const risk = riskForCustomAppCapabilities(requestedCapabilities);
  const now = Date.now();
  const id = `app-capability-${crypto.randomUUID()}`;
  const label = sanitizeActionText(input.label, 120, "Request capability") || "Request capability";
  const reason = sanitizeActionText(input.reason, 400) || null;

  db.prepare(`
    INSERT INTO custom_app_capability_requests (
      id, app_id, requested_capabilities_json, missing_capabilities_json, label, reason, risk, status,
      created_by_type, created_by_id, created_at, decided_by_type, decided_by_id, decided_at, decision_note
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    id,
    appId,
    JSON.stringify(requestedCapabilities),
    JSON.stringify(missingCapabilities),
    label,
    reason,
    risk,
    status,
    actor?.type || null,
    actor?.id || null,
    now,
    status === "approved" ? actor?.type || null : null,
    status === "approved" ? actor?.id || null : null,
    status === "approved" ? now : null,
    status === "approved" ? "Capability already allowed" : null,
  );
  return getCustomAppCapabilityRequest(appId, id)!;
}

export function decideCustomAppCapabilityRequest(
  appId: string,
  requestId: string,
  decision: "approved" | "denied",
  actor?: { type: string; id: string },
  note?: unknown,
) {
  const request = getCustomAppCapabilityRequest(appId, requestId);
  if (!request) return null;
  if (request.status !== "pending") throw statusError(`Custom app capability request is already ${request.status}`, 409);
  if (decision === "approved") {
    const manifest = getCustomAppCapabilityManifest(appId) || defaultCustomAppCapabilityManifest(appId);
    updateCustomAppCapabilityManifest(appId, {
      allowedCapabilities: Array.from(new Set([...manifest.allowedCapabilities, ...request.requestedCapabilities])),
      declaredCapabilities: Array.from(new Set([...manifest.declaredCapabilities, ...request.requestedCapabilities])),
    }, actor);
  }
  const decidedAt = Date.now();
  const decisionNote = sanitizeActionText(note, 240) || null;
  db.prepare(`
    UPDATE custom_app_capability_requests
    SET status = ?, missing_capabilities_json = ?, decided_by_type = ?, decided_by_id = ?, decided_at = ?, decision_note = ?
    WHERE app_id = ? AND id = ? AND status = 'pending'
  `).run(
    decision,
    decision === "approved" ? "[]" : JSON.stringify(request.missingCapabilities),
    actor?.type || null,
    actor?.id || null,
    decidedAt,
    decisionNote,
    appId,
    requestId,
  );
  return getCustomAppCapabilityRequest(appId, requestId)!;
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
