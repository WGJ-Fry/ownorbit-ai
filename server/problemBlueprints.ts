import crypto from "crypto";
import { db } from "./db";
import { redactAuditString } from "./audit";
import { deriveProblemBlueprint, PROBLEM_BLUEPRINT_MAX_INPUT_CHARS, type ProblemBlueprint } from "../src/services/problemBlueprint";

const MAX_HISTORY_LIMIT = 50;
const MAX_APP_NAME_LENGTH = 120;

export type ProblemBlueprintSource = "studio" | "chat" | "mobile";
export type ProblemBlueprintStatus = "planned" | "generated";

export type StoredProblemBlueprint = ProblemBlueprint & {
  id: string;
  problem: string;
  status: ProblemBlueprintStatus;
  source: ProblemBlueprintSource;
  generatedAppId?: string | null;
  generatedAppName?: string | null;
  createdByType?: string | null;
  createdById?: string | null;
  createdAt: number;
  updatedAt: number;
};

function normalizeSource(value: unknown): ProblemBlueprintSource {
  return value === "chat" || value === "mobile" ? value : "studio";
}

function normalizeLimit(value: unknown) {
  const parsed = Number.parseInt(String(value || ""), 10);
  if (!Number.isFinite(parsed) || parsed <= 0) return 12;
  return Math.min(parsed, MAX_HISTORY_LIMIT);
}

function sanitizeProblem(value: unknown) {
  const raw = String(value || "").replace(/\s+/g, " ").trim();
  if (raw.length < 4) {
    const error = new Error("problem must be at least 4 characters");
    (error as any).statusCode = 400;
    throw error;
  }
  return redactAuditString(raw).slice(0, PROBLEM_BLUEPRINT_MAX_INPUT_CHARS);
}

function sanitizeAppField(value: unknown, label: string) {
  const raw = String(value || "").replace(/\s+/g, " ").trim();
  if (!raw) {
    const error = new Error(`${label} is required`);
    (error as any).statusCode = 400;
    throw error;
  }
  return redactAuditString(raw).slice(0, MAX_APP_NAME_LENGTH);
}

function parseJsonArray(value: string) {
  const parsed = JSON.parse(value);
  return Array.isArray(parsed) ? parsed : [];
}

function rowToProblemBlueprint(row: any): StoredProblemBlueprint {
  return {
    id: row.id,
    problem: row.problem,
    normalizedProblem: row.normalizedProblem,
    isReady: true,
    language: row.language,
    category: row.category,
    categoryLabel: row.categoryLabel,
    suggestedAppName: row.suggestedAppName,
    summary: row.summary,
    steps: parseJsonArray(row.stepsJson),
    suggestedModules: parseJsonArray(row.modulesJson),
    riskNotes: parseJsonArray(row.riskNotesJson),
    appPrompt: row.appPrompt,
    status: row.status,
    source: row.source,
    generatedAppId: row.generatedAppId,
    generatedAppName: row.generatedAppName,
    createdByType: row.createdByType,
    createdById: row.createdById,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

function selectProblemBlueprintById(id: string) {
  return db.prepare(`
    SELECT id, problem, normalized_problem as normalizedProblem, language, category, category_label as categoryLabel,
           suggested_app_name as suggestedAppName, summary, steps_json as stepsJson, modules_json as modulesJson,
           risk_notes_json as riskNotesJson, app_prompt as appPrompt, status, source,
           generated_app_id as generatedAppId, generated_app_name as generatedAppName,
           created_by_type as createdByType, created_by_id as createdById,
           created_at as createdAt, updated_at as updatedAt
    FROM problem_blueprints
    WHERE id = ?
  `).get(id) as any;
}

export function createProblemBlueprint(input: { problem: unknown; source?: unknown }, actor?: { type: string; id: string }) {
  const now = Date.now();
  const problem = sanitizeProblem(input.problem);
  const source = normalizeSource(input.source);
  const blueprint = deriveProblemBlueprint(problem);
  const id = crypto.randomUUID();

  db.prepare(`
    INSERT INTO problem_blueprints (
      id, problem, normalized_problem, language, category, category_label, suggested_app_name, summary,
      steps_json, modules_json, risk_notes_json, app_prompt, status, source,
      created_by_type, created_by_id, created_at, updated_at
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    id,
    problem,
    blueprint.normalizedProblem,
    blueprint.language,
    blueprint.category,
    blueprint.categoryLabel,
    blueprint.suggestedAppName,
    blueprint.summary,
    JSON.stringify(blueprint.steps),
    JSON.stringify(blueprint.suggestedModules),
    JSON.stringify(blueprint.riskNotes),
    blueprint.appPrompt,
    "planned",
    source,
    actor?.type || null,
    actor?.id || null,
    now,
    now,
  );

  return getProblemBlueprint(id)!;
}

export function getProblemBlueprint(id: string) {
  const row = selectProblemBlueprintById(id);
  return row ? rowToProblemBlueprint(row) : null;
}

export function listProblemBlueprints(limitInput?: unknown) {
  const limit = normalizeLimit(limitInput);
  return db.prepare(`
    SELECT id, problem, normalized_problem as normalizedProblem, language, category, category_label as categoryLabel,
           suggested_app_name as suggestedAppName, summary, steps_json as stepsJson, modules_json as modulesJson,
           risk_notes_json as riskNotesJson, app_prompt as appPrompt, status, source,
           generated_app_id as generatedAppId, generated_app_name as generatedAppName,
           created_by_type as createdByType, created_by_id as createdById,
           created_at as createdAt, updated_at as updatedAt
    FROM problem_blueprints
    ORDER BY created_at DESC
    LIMIT ?
  `).all(limit).map(rowToProblemBlueprint);
}

export function attachGeneratedAppToProblemBlueprint(
  id: string,
  input: { appId: unknown; appName: unknown },
) {
  const existing = getProblemBlueprint(id);
  if (!existing) return null;

  const generatedAppId = sanitizeAppField(input.appId, "appId");
  const generatedAppName = sanitizeAppField(input.appName, "appName");
  const updatedAt = Date.now();

  db.prepare(`
    UPDATE problem_blueprints
    SET status = 'generated',
        generated_app_id = ?,
        generated_app_name = ?,
        updated_at = ?
    WHERE id = ?
  `).run(generatedAppId, generatedAppName, updatedAt, id);

  return getProblemBlueprint(id);
}
