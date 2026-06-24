import type express from "express";
import { insertAuditLog } from "../audit";
import { requireActor } from "../auth";
import {
  createCustomApp,
  deleteCustomApp,
  getCustomApp,
  getCustomAppState,
  listCustomApps,
  listCustomAppVersions,
  rollbackCustomAppVersion,
  updateCustomApp,
  updateCustomAppState,
} from "../customApps";
import { broadcastRealtime } from "../realtime";

function actor(req: express.Request) {
  return (req as any).actor as { type: string; id: string } | undefined;
}

function handleCustomAppError(res: express.Response, error: any) {
  if (error?.statusCode) return res.status(error.statusCode).json({ error: error.message || "Invalid custom app" });
  console.error("Custom app error:", error);
  return res.status(500).json({ error: "Failed to process custom app" });
}

export function registerCustomAppRoutes(app: express.Express) {
  app.get("/api/v1/custom-apps", requireActor, (req, res) => {
    res.json({ apps: listCustomApps(req.query.limit) });
  });

  app.get("/api/v1/custom-apps/:appId/versions", requireActor, (req, res) => {
    const versions = listCustomAppVersions(req.params.appId, req.query.limit);
    if (!versions) return res.status(404).json({ error: "Custom app not found" });
    res.json({ versions });
  });

  app.post("/api/v1/custom-apps/:appId/versions/:version/rollback", requireActor, (req, res) => {
    try {
      const version = Number.parseInt(req.params.version, 10);
      if (!Number.isFinite(version) || version <= 0) return res.status(400).json({ error: "Invalid custom app version" });
      const result = rollbackCustomAppVersion(req.params.appId, version, actor(req));
      if (!result) return res.status(404).json({ error: "Custom app not found" });
      insertAuditLog("custom_app_version_rolled_back", "custom_app", result.app.id, {
        name: result.app.name,
        rolledBackTo: version,
        newVersion: result.version.version,
        codeBytes: Buffer.byteLength(result.app.code || "", "utf8"),
      }, actor(req)?.type, actor(req)?.id);
      broadcastRealtime({ type: "custom_app.version_rolled_back", app: result.app, version: result.version, timestamp: result.app.updatedAt });
      res.json(result);
    } catch (error) {
      handleCustomAppError(res, error);
    }
  });

  app.get("/api/v1/custom-apps/:appId/state", requireActor, (req, res) => {
    const state = getCustomAppState(req.params.appId);
    if (!state) return res.status(404).json({ error: "Custom app not found" });
    res.json({ state });
  });

  app.put("/api/v1/custom-apps/:appId/state", requireActor, (req, res) => {
    try {
      const state = updateCustomAppState(req.params.appId, req.body?.state ?? {}, actor(req));
      if (!state) return res.status(404).json({ error: "Custom app not found" });
      insertAuditLog("custom_app_state_saved", "custom_app", req.params.appId, {
        stateBytes: Buffer.byteLength(JSON.stringify(state.state), "utf8"),
      }, actor(req)?.type, actor(req)?.id);
      broadcastRealtime({ type: "custom_app.state_saved", appId: req.params.appId, timestamp: state.updatedAt });
      res.json({ state });
    } catch (error) {
      handleCustomAppError(res, error);
    }
  });

  app.get("/api/v1/custom-apps/:appId", requireActor, (req, res) => {
    const customApp = getCustomApp(req.params.appId);
    if (!customApp) return res.status(404).json({ error: "Custom app not found" });
    res.json({ app: customApp });
  });

  app.post("/api/v1/custom-apps", requireActor, (req, res) => {
    try {
      const customApp = createCustomApp(req.body || {}, actor(req));
      insertAuditLog("custom_app_saved", "custom_app", customApp.id, {
        name: customApp.name,
        status: customApp.status,
        source: customApp.source,
        codeBytes: Buffer.byteLength(customApp.code || "", "utf8"),
      }, actor(req)?.type, actor(req)?.id);
      broadcastRealtime({ type: "custom_app.saved", app: customApp, timestamp: customApp.updatedAt });
      res.json({ app: customApp });
    } catch (error) {
      handleCustomAppError(res, error);
    }
  });

  app.patch("/api/v1/custom-apps/:appId", requireActor, (req, res) => {
    try {
      const customApp = updateCustomApp(req.params.appId, req.body || {}, actor(req));
      if (!customApp) return res.status(404).json({ error: "Custom app not found" });
      insertAuditLog("custom_app_updated", "custom_app", customApp.id, {
        name: customApp.name,
        status: customApp.status,
        codeBytes: Buffer.byteLength(customApp.code || "", "utf8"),
      }, actor(req)?.type, actor(req)?.id);
      broadcastRealtime({ type: "custom_app.updated", app: customApp, timestamp: customApp.updatedAt });
      res.json({ app: customApp });
    } catch (error) {
      handleCustomAppError(res, error);
    }
  });

  app.delete("/api/v1/custom-apps/:appId", requireActor, (req, res) => {
    const customApp = deleteCustomApp(req.params.appId);
    if (!customApp) return res.status(404).json({ error: "Custom app not found" });
    insertAuditLog("custom_app_deleted", "custom_app", customApp.id, {
      name: customApp.name,
      status: customApp.status,
    }, actor(req)?.type, actor(req)?.id);
    broadcastRealtime({ type: "custom_app.deleted", appId: customApp.id, timestamp: customApp.deletedAt || Date.now() });
    res.json({ ok: true });
  });
}
