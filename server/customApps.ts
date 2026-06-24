import crypto from "crypto";
import { db } from "./db";
import { redactAuditString } from "./audit";

const MAX_APP_NAME_LENGTH = 120;
const MAX_APP_DESCRIPTION_LENGTH = 800;
const MAX_APP_CODE_BYTES = Number(process.env.LIFEOS_MAX_CUSTOM_APP_CODE_BYTES || 512 * 1024);

export type CustomAppVisibility = "private" | "public";
export type CustomAppStatus = "active" | "building";
export type CustomAppSource = "studio" | "chat" | "import" | "migration";

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

function sanitizeCode(value: unknown) {
  const code = redactAuditString(String(value ?? ""));
  if (Buffer.byteLength(code, "utf8") > MAX_APP_CODE_BYTES) {
    throw statusError(`custom app code exceeds ${MAX_APP_CODE_BYTES} bytes`, 413);
  }
  return code;
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

  return getCustomApp(id)!;
}

export function updateCustomApp(id: string, input: Record<string, unknown>) {
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

  return getCustomApp(id);
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
