import type express from "express";
import { insertAuditLog } from "../audit";
import { requireActor } from "../auth";
import { createCustomApp, deleteCustomApp, getCustomApp, listCustomApps, updateCustomApp } from "../customApps";
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
      const customApp = updateCustomApp(req.params.appId, req.body || {});
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
