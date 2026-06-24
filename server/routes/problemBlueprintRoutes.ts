import type express from "express";
import { insertAuditLog } from "../audit";
import { requireActor } from "../auth";
import { attachGeneratedAppToProblemBlueprint, createProblemBlueprint, getProblemBlueprint, listProblemBlueprints } from "../problemBlueprints";
import { broadcastRealtime } from "../realtime";

function actor(req: express.Request) {
  return (req as any).actor as { type: string; id: string } | undefined;
}

function handleBlueprintError(res: express.Response, error: any) {
  if (error?.statusCode) return res.status(error.statusCode).json({ error: error.message || "Invalid problem blueprint" });
  console.error("Problem blueprint error:", error);
  return res.status(500).json({ error: "Failed to process problem blueprint" });
}

export function registerProblemBlueprintRoutes(app: express.Express) {
  app.get("/api/v1/problem-blueprints", requireActor, (req, res) => {
    res.json({ blueprints: listProblemBlueprints(req.query.limit) });
  });

  app.get("/api/v1/problem-blueprints/:blueprintId", requireActor, (req, res) => {
    const blueprint = getProblemBlueprint(req.params.blueprintId);
    if (!blueprint) return res.status(404).json({ error: "Problem blueprint not found" });
    res.json({ blueprint });
  });

  app.post("/api/v1/problem-blueprints", requireActor, (req, res) => {
    try {
      const blueprint = createProblemBlueprint({
        problem: req.body?.problem,
        source: req.body?.source,
      }, actor(req));
      insertAuditLog("problem_blueprint_created", "problem_blueprint", blueprint.id, {
        category: blueprint.category,
        source: blueprint.source,
        problemLength: blueprint.problem.length,
      }, actor(req)?.type, actor(req)?.id);
      broadcastRealtime({ type: "problem_blueprint.created", blueprint, timestamp: blueprint.createdAt });
      res.json({ blueprint });
    } catch (error) {
      handleBlueprintError(res, error);
    }
  });

  app.put("/api/v1/problem-blueprints/:blueprintId/generated-app", requireActor, (req, res) => {
    try {
      const blueprint = attachGeneratedAppToProblemBlueprint(req.params.blueprintId, {
        appId: req.body?.appId,
        appName: req.body?.appName,
      });
      if (!blueprint) return res.status(404).json({ error: "Problem blueprint not found" });
      insertAuditLog("problem_blueprint_generated_app_attached", "problem_blueprint", blueprint.id, {
        generatedAppId: blueprint.generatedAppId,
        generatedAppName: blueprint.generatedAppName,
        category: blueprint.category,
      }, actor(req)?.type, actor(req)?.id);
      broadcastRealtime({ type: "problem_blueprint.updated", blueprint, timestamp: blueprint.updatedAt });
      res.json({ blueprint });
    } catch (error) {
      handleBlueprintError(res, error);
    }
  });
}
