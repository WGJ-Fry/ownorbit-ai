import type express from "express";
import { insertAuditLog } from "../audit";
import { requireActor } from "../auth";
import {
  createCustomApp,
  compareCustomAppVersions,
  completeCustomAppAutoRepair,
  createCustomAppActionRequest,
  createCustomAppAutoRepairPlan,
  createCustomAppCapabilityRequest,
  createCustomAppDebugRequest,
  createCustomAppRuntimeEvent,
  decideCustomAppActionRequest,
  decideCustomAppCapabilityRequest,
  deleteCustomApp,
  customAppHasCapabilities,
  getCustomApp,
  getCustomAppActionPolicy,
  getCustomAppCapabilityManifest,
  getCustomAppState,
  listCustomAppActionRequests,
  listCustomAppAutoRepairQueue,
  listCustomAppCapabilityRequests,
  listCustomAppRuntimeEvents,
  listCustomApps,
  listCustomAppVersions,
  recordCustomAppAutoRepairSmokeReview,
  rollbackCustomAppVersion,
  updateCustomApp,
  updateCustomAppActionPolicy,
  updateCustomAppCapabilityManifest,
  updateCustomAppState,
} from "../customApps";
import { noteCloudKitLocalChange } from "../cloudKitAutoSyncSchedule";
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

  app.get("/api/v1/custom-apps/:appId/version-compare", requireActor, (req, res) => {
    try {
      const comparison = compareCustomAppVersions(req.params.appId, req.query.from, req.query.to);
      if (!comparison) return res.status(404).json({ error: "Custom app not found" });
      res.json({ comparison });
    } catch (error) {
      handleCustomAppError(res, error);
    }
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
    const capabilityCheck = customAppHasCapabilities(req.params.appId, ["storage"]);
    if (!capabilityCheck) return res.status(404).json({ error: "Custom app not found" });
    if (!capabilityCheck.ok) return res.status(403).json({ error: "Custom app storage capability is disabled" });
    const state = getCustomAppState(req.params.appId);
    if (!state) return res.status(404).json({ error: "Custom app not found" });
    res.json({ state });
  });

  app.put("/api/v1/custom-apps/:appId/state", requireActor, (req, res) => {
    try {
      const capabilityCheck = customAppHasCapabilities(req.params.appId, ["storage"]);
      if (!capabilityCheck) return res.status(404).json({ error: "Custom app not found" });
      if (!capabilityCheck.ok) return res.status(403).json({ error: "Custom app storage capability is disabled" });
      const state = updateCustomAppState(req.params.appId, req.body?.state ?? {}, actor(req));
      if (!state) return res.status(404).json({ error: "Custom app not found" });
      insertAuditLog("custom_app_state_saved", "custom_app", req.params.appId, {
        stateBytes: Buffer.byteLength(JSON.stringify(state.state), "utf8"),
      }, actor(req)?.type, actor(req)?.id);
      noteCloudKitLocalChange("generated-app-state", actor(req));
      broadcastRealtime({ type: "custom_app.state_saved", appId: req.params.appId, timestamp: state.updatedAt });
      res.json({ state });
    } catch (error) {
      handleCustomAppError(res, error);
    }
  });

  app.get("/api/v1/custom-apps/:appId/capabilities", requireActor, (req, res) => {
    const manifest = getCustomAppCapabilityManifest(req.params.appId);
    if (!manifest) return res.status(404).json({ error: "Custom app not found" });
    res.json({ manifest });
  });

  app.get("/api/v1/custom-apps/:appId/runtime-events", requireActor, (req, res) => {
    const events = listCustomAppRuntimeEvents(req.params.appId, req.query.limit);
    if (!events) return res.status(404).json({ error: "Custom app not found" });
    res.json({ events });
  });

  app.get("/api/v1/custom-apps/:appId/auto-repairs/queue", requireActor, (req, res) => {
    const queue = listCustomAppAutoRepairQueue(req.params.appId, req.query.limit);
    if (!queue) return res.status(404).json({ error: "Custom app not found" });
    res.json({ queue });
  });

  app.post("/api/v1/custom-apps/:appId/runtime-events", requireActor, (req, res) => {
    try {
      const event = createCustomAppRuntimeEvent(req.params.appId, req.body || {}, actor(req));
      if (!event) return res.status(404).json({ error: "Custom app not found" });
      insertAuditLog("custom_app_runtime_event_recorded", "custom_app", req.params.appId, {
        eventId: event.id,
        eventType: event.eventType,
        severity: event.severity,
        label: event.label,
        message: event.message,
      }, actor(req)?.type, actor(req)?.id);
      broadcastRealtime({ type: "custom_app.runtime_event", appId: req.params.appId, event, timestamp: event.createdAt });
      res.json({ event });
    } catch (error) {
      handleCustomAppError(res, error);
    }
  });

  app.post("/api/v1/custom-apps/:appId/debug-requests", requireActor, (req, res) => {
    try {
      const result = createCustomAppDebugRequest(req.params.appId, req.body || {}, actor(req));
      if (!result) return res.status(404).json({ error: "Custom app not found" });
      insertAuditLog("custom_app_debug_requested", "custom_app", req.params.appId, {
        eventId: result.event?.id,
        suggestedInstructionBytes: Buffer.byteLength(result.suggestedInstruction || "", "utf8"),
        recentEventCount: result.recentEvents.length,
        repairRisk: result.repairProposal.risk,
        suspectedArea: result.repairProposal.suspectedArea,
        repairStepCount: result.repairProposal.repairSteps.length,
      }, actor(req)?.type, actor(req)?.id);
      broadcastRealtime({ type: "custom_app.debug_requested", appId: req.params.appId, event: result.event, timestamp: result.event?.createdAt || Date.now() });
      res.json(result);
    } catch (error) {
      handleCustomAppError(res, error);
    }
  });

  app.post("/api/v1/custom-apps/:appId/auto-repairs", requireActor, (req, res) => {
    try {
      const result = createCustomAppAutoRepairPlan(req.params.appId, req.body || {}, actor(req));
      if (!result) return res.status(404).json({ error: "Custom app not found" });
      insertAuditLog("custom_app_auto_repair_planned", "custom_app", req.params.appId, {
        debugEventId: result.debugEvent?.id,
        autoRepairEventId: result.autoRepairEvent?.id,
        status: result.autoRepairTask.status,
        mode: result.autoRepairTask.mode,
        canAutoApply: result.autoRepairTask.canAutoApply,
        reasonKey: result.autoRepairTask.reasonKey,
        repairAttempt: result.autoRepairTask.repairAttempt,
        retryLimit: result.autoRepairTask.retryLimit,
        rollbackVersion: result.autoRepairTask.rollbackVersion,
        executionSessionStatus: result.executionSession.status,
        canRunUnattended: result.executionSession.canRunUnattended,
        executionStepCount: result.executionSession.requiredSteps.length,
        smokeCheckCount: result.executionSession.smokeChecks.length,
        repairRisk: result.repairProposal.risk,
        suspectedArea: result.repairProposal.suspectedArea,
      }, actor(req)?.type, actor(req)?.id);
      broadcastRealtime({
        type: "custom_app.auto_repair_planned",
        appId: req.params.appId,
        event: result.autoRepairEvent,
        task: result.autoRepairTask,
        timestamp: result.autoRepairEvent?.createdAt || Date.now(),
      });
      res.json(result);
    } catch (error) {
      handleCustomAppError(res, error);
    }
  });

  app.post("/api/v1/custom-apps/:appId/auto-repairs/complete", requireActor, (req, res) => {
    try {
      const result = completeCustomAppAutoRepair(req.params.appId, req.body || {}, actor(req));
      if (!result) return res.status(404).json({ error: "Custom app not found" });
      insertAuditLog("custom_app_auto_repair_completed", "custom_app", req.params.appId, {
        eventId: result.event?.id,
        taskId: result.result.taskId,
        status: result.result.status,
        fromVersion: result.result.fromVersion,
        toVersion: result.result.toVersion,
        comparisonRisk: result.result.comparisonRisk,
        rollbackAvailable: result.result.rollbackAvailable,
        verificationStatus: result.result.verification.status,
        changedLines: result.comparison?.totalChangedLines ?? null,
        staticSmokeStatus: result.staticSmoke?.review.status ?? null,
        staticSmokeMethod: result.staticSmoke?.review.method ?? null,
        staticSmokeFailures: result.staticSmoke?.review.failures.length ?? null,
        autoRollbackStatus: result.autoRollback?.status ?? null,
        autoRollbackAttempted: result.autoRollback?.attempted ?? null,
        autoRollbackVersion: result.autoRollback?.rollbackVersion ?? null,
      }, actor(req)?.type, actor(req)?.id);
      broadcastRealtime({
        type: "custom_app.auto_repair_completed",
        appId: req.params.appId,
        event: result.event,
        result: result.result,
        timestamp: result.event?.createdAt || Date.now(),
      });
      if (result.staticSmoke) {
        insertAuditLog("custom_app_auto_repair_smoke_reviewed", "custom_app", req.params.appId, {
          eventId: result.staticSmoke.event?.id,
          resultId: result.staticSmoke.review.resultId,
          status: result.staticSmoke.review.status,
          method: result.staticSmoke.review.method,
          rollbackRecommended: result.staticSmoke.review.rollbackRecommended,
          failureCount: result.staticSmoke.review.failures.length,
        }, actor(req)?.type, actor(req)?.id);
        broadcastRealtime({
          type: "custom_app.auto_repair_smoke_reviewed",
          appId: req.params.appId,
          event: result.staticSmoke.event,
          review: result.staticSmoke.review,
          timestamp: result.staticSmoke.event?.createdAt || Date.now(),
        });
      }
      if (result.autoRollback) {
        insertAuditLog("custom_app_auto_repair_auto_rollback", "custom_app", req.params.appId, {
          taskId: result.result.taskId,
          resultId: result.result.id,
          status: result.autoRollback.status,
          attempted: result.autoRollback.attempted,
          fromVersion: result.autoRollback.fromVersion ?? null,
          rollbackVersion: result.autoRollback.rollbackVersion ?? null,
          toVersion: result.autoRollback.toVersion ?? null,
          reason: result.autoRollback.reason,
        }, actor(req)?.type, actor(req)?.id);
        broadcastRealtime({
          type: "custom_app.auto_repair_auto_rolled_back",
          appId: req.params.appId,
          autoRollback: result.autoRollback,
          timestamp: Date.now(),
        });
      }
      res.json(result);
    } catch (error) {
      handleCustomAppError(res, error);
    }
  });

  app.put("/api/v1/custom-apps/:appId/capabilities", requireActor, (req, res) => {
    try {
      const manifest = updateCustomAppCapabilityManifest(req.params.appId, req.body || {}, actor(req));
      if (!manifest) return res.status(404).json({ error: "Custom app not found" });
      insertAuditLog("custom_app_capabilities_updated", "custom_app", req.params.appId, {
        allowedCapabilities: manifest.allowedCapabilities,
        declaredCapabilities: manifest.declaredCapabilities,
        riskLevel: manifest.riskLevel,
      }, actor(req)?.type, actor(req)?.id);
      broadcastRealtime({ type: "custom_app.capabilities_updated", appId: req.params.appId, manifest, timestamp: manifest.updatedAt });
      res.json({ manifest });
    } catch (error) {
      handleCustomAppError(res, error);
    }
  });

  app.get("/api/v1/custom-apps/:appId/capability-requests", requireActor, (req, res) => {
    const requests = listCustomAppCapabilityRequests(req.params.appId, req.query.limit);
    if (!requests) return res.status(404).json({ error: "Custom app not found" });
    res.json({ requests });
  });

  app.post("/api/v1/custom-apps/:appId/capability-requests", requireActor, (req, res) => {
    try {
      const request = createCustomAppCapabilityRequest(req.params.appId, req.body || {}, actor(req));
      if (!request) return res.status(404).json({ error: "Custom app not found" });
      insertAuditLog("custom_app_capability_requested", "custom_app", req.params.appId, {
        requestId: request.id,
        requestedCapabilities: request.requestedCapabilities,
        missingCapabilities: request.missingCapabilities,
        label: request.label,
        risk: request.risk,
        status: request.status,
        reason: request.reason,
      }, actor(req)?.type, actor(req)?.id);
      broadcastRealtime({ type: "custom_app.capability_requested", appId: req.params.appId, request, timestamp: request.createdAt });
      res.json({ request });
    } catch (error) {
      handleCustomAppError(res, error);
    }
  });

  app.post("/api/v1/custom-apps/:appId/capability-requests/:requestId/decision", requireActor, (req, res) => {
    try {
      const decision = req.body?.decision === "approved" ? "approved" : req.body?.decision === "denied" ? "denied" : "";
      if (!decision) return res.status(400).json({ error: "Invalid custom app capability decision" });
      const request = decideCustomAppCapabilityRequest(req.params.appId, req.params.requestId, decision, actor(req), req.body?.note);
      if (!request) return res.status(404).json({ error: "Custom app capability request not found" });
      insertAuditLog(decision === "approved" ? "custom_app_capability_approved" : "custom_app_capability_denied", "custom_app", req.params.appId, {
        requestId: request.id,
        requestedCapabilities: request.requestedCapabilities,
        missingCapabilities: request.missingCapabilities,
        label: request.label,
        risk: request.risk,
        status: request.status,
        decisionNote: request.decisionNote,
      }, actor(req)?.type, actor(req)?.id);
      broadcastRealtime({ type: "custom_app.capability_decided", appId: req.params.appId, request, timestamp: request.decidedAt || Date.now() });
      res.json({ request });
    } catch (error) {
      handleCustomAppError(res, error);
    }
  });

  app.get("/api/v1/custom-apps/:appId/action-policy", requireActor, (req, res) => {
    const policy = getCustomAppActionPolicy(req.params.appId);
    if (!policy) return res.status(404).json({ error: "Custom app not found" });
    res.json({ policy });
  });

  app.put("/api/v1/custom-apps/:appId/action-policy", requireActor, (req, res) => {
    try {
      const policy = updateCustomAppActionPolicy(req.params.appId, req.body || {}, actor(req));
      if (!policy) return res.status(404).json({ error: "Custom app not found" });
      insertAuditLog("custom_app_action_policy_updated", "custom_app", req.params.appId, {
        template: policy.template,
        allowedSchemes: policy.allowedSchemes,
        requireConfirmation: policy.requireConfirmation,
      }, actor(req)?.type, actor(req)?.id);
      broadcastRealtime({ type: "custom_app.action_policy_updated", appId: req.params.appId, policy, timestamp: policy.updatedAt });
      res.json({ policy });
    } catch (error) {
      handleCustomAppError(res, error);
    }
  });

  app.get("/api/v1/custom-apps/:appId/action-requests", requireActor, (req, res) => {
    const requests = listCustomAppActionRequests(req.params.appId, req.query.limit);
    if (!requests) return res.status(404).json({ error: "Custom app not found" });
    res.json({ requests });
  });

  app.post("/api/v1/custom-apps/:appId/action-requests", requireActor, (req, res) => {
    try {
      const request = createCustomAppActionRequest(req.params.appId, req.body || {}, actor(req));
      if (!request) return res.status(404).json({ error: "Custom app not found" });
      insertAuditLog(request.status === "blocked" ? "custom_app_action_blocked" : "custom_app_action_requested", "custom_app", req.params.appId, {
        requestId: request.id,
        actionType: request.actionType,
        label: request.label,
        targetUrl: request.targetUrl,
        targetScheme: request.targetScheme,
        paramsSummary: request.paramsSummary,
        risk: request.risk,
        status: request.status,
        reason: request.reason,
      }, actor(req)?.type, actor(req)?.id);
      broadcastRealtime({ type: "custom_app.action_requested", appId: req.params.appId, request, timestamp: request.createdAt });
      res.json({ request });
    } catch (error) {
      handleCustomAppError(res, error);
    }
  });

  app.post("/api/v1/custom-apps/:appId/action-requests/:requestId/decision", requireActor, (req, res) => {
    try {
      const decision = req.body?.decision === "approved" ? "approved" : req.body?.decision === "cancelled" ? "cancelled" : "";
      if (!decision) return res.status(400).json({ error: "Invalid custom app action decision" });
      const request = decideCustomAppActionRequest(req.params.appId, req.params.requestId, decision, actor(req), req.body?.note);
      if (!request) return res.status(404).json({ error: "Custom app action request not found" });
      insertAuditLog(decision === "approved" ? "custom_app_action_approved" : "custom_app_action_cancelled", "custom_app", req.params.appId, {
        requestId: request.id,
        actionType: request.actionType,
        label: request.label,
        targetUrl: request.targetUrl,
        targetScheme: request.targetScheme,
        paramsSummary: request.paramsSummary,
        risk: request.risk,
        status: request.status,
        decisionNote: request.decisionNote,
      }, actor(req)?.type, actor(req)?.id);
      broadcastRealtime({ type: "custom_app.action_decided", appId: req.params.appId, request, timestamp: request.decidedAt || Date.now() });
      res.json({ request });
    } catch (error) {
      handleCustomAppError(res, error);
    }
  });

  app.post("/api/v1/custom-apps/:appId/auto-repairs/smoke-review", requireActor, (req, res) => {
    try {
      const result = recordCustomAppAutoRepairSmokeReview(req.params.appId, req.body || {}, actor(req));
      if (!result) return res.status(404).json({ error: "Custom app not found" });
      insertAuditLog("custom_app_auto_repair_smoke_reviewed", "custom_app", req.params.appId, {
        eventId: result.event?.id,
        resultId: result.review.resultId,
        taskId: result.review.taskId,
        status: result.review.status,
        method: result.review.method,
        rollbackRecommended: result.review.rollbackRecommended,
        failureCount: result.review.failures.length,
      }, actor(req)?.type, actor(req)?.id);
      broadcastRealtime({
        type: "custom_app.auto_repair_smoke_reviewed",
        appId: req.params.appId,
        event: result.event,
        review: result.review,
        timestamp: result.event?.createdAt || Date.now(),
      });
      res.json(result);
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
