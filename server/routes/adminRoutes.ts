import type express from "express";
import { db } from "../db";
import { insertAuditLog, listAuditLogs } from "../audit";
import { aiProviders, deleteAiApiKey, getActiveAiProviderId, getAiApiKey, getAiConfigStatus, getAiProviderBaseUrl, getAiProviderDefinition, getAiProviderStatus, listAiProviderStatuses, saveActiveAiProvider, saveAiApiKey, saveDiscoveredAiModelCatalog, saveSelectedAiModel, supportsAiProviderModelDiscovery, type AiProviderId } from "../appSecrets";
import { buildCalendarSyncPreview, buildCalendarSyncPreviewAsync, executeCalendarSyncOperationAsync } from "../calendarSyncPreview";
import { listCalendarSyncOperations, rollbackCalendarSyncOperation, saveCalendarSyncOperation } from "../calendarSyncHistory";
import { createCalendarSyncRun, listCalendarSyncRuns } from "../calendarSyncRuns";
import { createAdminCredential, createAdminSession, getAdminSessionByToken, getBearerToken, isAdminConfigured, requireAdmin, verifyAdminPassword } from "../auth";
import { createDiagnosticBundle, getReleaseDiagnostics } from "../diagnosticBundle";
import { clearHttpOnlyCookie, getClientIp, rateLimit, setClientCookie, setHttpOnlyCookie } from "../httpSecurity";
import { analyzeIcloudHandoffRepairPacket, exportIcloudHandoff, getNetworkDiagnostics, installTailscaleClient, maybeRefreshIcloudHandoff, startTailscaleHttpsServe, stopTailscaleHttpsServe, testConnectionUrl } from "../networkDiagnostics";
import { generateCloudflareNamedTunnelConfig, getCloudflareNamedTunnelStatus, getManagedCloudflareTunnelStatus, refreshCloudflareNamedTunnelConfigForPort, startConfiguredCloudflareNamedTunnel, startManagedCloudflareTunnel, stopManagedCloudflareTunnel } from "../cloudflareTunnel";
import { saveDesktopRuntimeConfig } from "../desktopRuntimeConfig";
import { getConfiguredPublicBaseUrl } from "../publicBaseUrl";
import { getRemoteValidationReport, saveRemoteValidationReport, summarizeRemoteHealth } from "../remoteValidationReport";
import { getRemoteHealthEvidence, getRemoteHealthMonitorStatus, getRemoteRecoveryReport, runRemoteHealthCheck } from "../remoteHealthMonitor";
import { buildRemoteAcceptanceChecklist, buildRemoteAcceptanceEvidencePack, getRemoteAcceptanceRecords, getRemoteAcceptanceRunbookRecords, saveRemoteAcceptanceRecord, saveRemoteAcceptanceRunbookFromConnectionTest, saveRemoteAcceptanceRunbookReport, summarizeRemoteAcceptanceChecklist } from "../remoteAcceptance";
import { createSecret, tokenHash } from "../security";
import { setClientState } from "../clientState";
import { evaluatePasswordPolicy, getSecurityDiagnostics } from "../securityDiagnostics";
import { getOnboardingStatus, markOnboardingComplete } from "../onboarding";
import { getBackupSchedule } from "../backupSchedule";
import { getLatestBindingSession, getLatestIcloudHandoffEvent } from "../devices";
import { checkReleaseUpdate } from "../releaseUpdateCheck";
import { buildNativeAutomationPlan, executeNativeAutomation } from "../nativeAutomationBridge";

const loginFailures = new Map<string, { count: number; lockedUntil: number }>();

function loginKey(req: express.Request) {
  return getClientIp(req);
}

function isLoopbackSocket(req: express.Request) {
  const remoteAddress = req.socket.remoteAddress || "";
  return remoteAddress === "127.0.0.1" || remoteAddress === "::1" || remoteAddress === "::ffff:127.0.0.1";
}

function getProviderId(value: string): AiProviderId | null {
  return aiProviders.some((provider) => provider.id === value) ? value as AiProviderId : null;
}

function getLegacyGeminiProvider() {
  return aiProviders.find((provider) => provider.id === "gemini")!;
}

function aiStatusAuditMetadata(status: ReturnType<typeof getAiProviderStatus>) {
  return {
    providerId: status.id,
    provider: status.provider,
    configured: status.configured,
    enabled: status.enabled,
    active: status.active,
    source: status.source,
    envVar: status.envVar,
    envManaged: status.source === "environment",
    defaultModel: status.defaultModel,
    selectedModel: status.selectedModel,
    modelCatalogCount: status.models?.length || 0,
    restartRequired: status.restartRequired,
    secureStorage: {
      current: status.secureStorage?.current || null,
      preferred: status.secureStorage?.preferred,
      label: status.secureStorage?.label,
      systemAvailable: Boolean(status.secureStorage?.systemAvailable),
      fallbackActive: Boolean(status.secureStorage?.fallbackActive),
      migrationRecommended: Boolean(status.secureStorage?.migrationRecommended),
    },
  };
}

function aiProviderChangeAuditMetadata(previousStatus: ReturnType<typeof getAiProviderStatus>, status: ReturnType<typeof getAiProviderStatus>) {
  return {
    previousConfigured: previousStatus.configured,
    previousSource: previousStatus.source,
    previousSelectedModel: previousStatus.selectedModel,
    previousSecureStorageCurrent: previousStatus.secureStorage?.current || null,
    storageChanged: (previousStatus.secureStorage?.current || null) !== (status.secureStorage?.current || null),
    configuredChanged: previousStatus.configured !== status.configured,
    sourceChanged: previousStatus.source !== status.source,
  };
}

function credentialLengthBucket(value: string) {
  if (value.length >= 80) return "80+";
  if (value.length >= 40) return "40-79";
  if (value.length >= 16) return "16-39";
  return "8-15";
}

function hostKind(hostname: string) {
  const normalized = hostname.toLowerCase();
  if (normalized === "localhost" || normalized === "127.0.0.1" || normalized === "::1") return "localhost";
  if (/^(10\.|192\.168\.|172\.(1[6-9]|2\d|3[0-1])\.)/.test(normalized)) return "private";
  return "public";
}

function aiCredentialAuditMetadata(providerId: AiProviderId, credential: string) {
  if (providerId !== "local") {
    return {
      credentialKind: "api_key",
      credentialLengthBucket: credentialLengthBucket(credential),
    };
  }
  try {
    const parsed = new URL(credential);
    return {
      credentialKind: "endpoint",
      credentialLengthBucket: credentialLengthBucket(credential),
      endpointProtocol: parsed.protocol.replace(":", ""),
      endpointHostKind: hostKind(parsed.hostname),
    };
  } catch {
    return {
      credentialKind: "endpoint",
      credentialLengthBucket: credentialLengthBucket(credential),
      endpointProtocol: "invalid",
      endpointHostKind: "unknown",
    };
  }
}

function adminPasswordPolicyError(policy: ReturnType<typeof evaluatePasswordPolicy>) {
  if (policy.meetsPolicy) return "";
  if (policy.lengthBucket === "8-11") return "Admin password must be at least 12 characters.";
  if (!policy.hasVariety) return "Admin password must include at least two kinds of characters, such as letters plus numbers, symbols, or spaces.";
  if (!policy.notCommon) return "Admin password is too common.";
  if (!policy.noLongRepeats) return "Admin password cannot contain long repeated characters.";
  if (!policy.noSequentialPattern) return "Admin password cannot contain keyboard or number sequences.";
  return "Admin password is too weak.";
}

type AiProviderTestSummary = {
  ok: boolean;
  result: "ready" | "not_configured" | "disabled" | "live_ready" | "live_failed";
  reason: string;
  credentialKind: "api_key" | "endpoint";
  models?: string[];
  modelCount?: number;
  selectedModelAvailable?: boolean;
};

async function testLocalModelEndpoint(status: ReturnType<typeof getAiProviderStatus>): Promise<AiProviderTestSummary> {
  const credentialKind = "endpoint" as const;
  const endpoint = getAiApiKey("local");
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 3000);
  try {
    const response = await fetch(`${endpoint.replace(/\/$/, "")}/models`, { signal: controller.signal });
    const data = await response.json().catch(() => ({}));
    const models = Array.isArray(data?.data) ? data.data : [];
    const modelIds = models.map((model: any) => String(model?.id || model?.name || "")).filter(Boolean);
    return {
      ok: response.ok,
      result: response.ok ? "live_ready" : "live_failed",
      reason: response.ok ? "models_endpoint_ok" : "models_endpoint_http_error",
      credentialKind,
      models: modelIds,
      modelCount: modelIds.length,
      selectedModelAvailable: modelIds.length ? modelIds.includes(status.selectedModel) : undefined,
    };
  } catch (error: any) {
    return {
      ok: false,
      result: "live_failed",
      reason: error?.name === "AbortError" ? "models_endpoint_timeout" : "models_endpoint_unreachable",
      credentialKind,
    };
  } finally {
    clearTimeout(timer);
  }
}

async function testRemoteModelCatalog(status: ReturnType<typeof getAiProviderStatus>): Promise<AiProviderTestSummary> {
  const credentialKind = "api_key" as const;
  const credential = getAiApiKey(status.id);
  const provider = getAiProviderDefinition(status.id);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 4500);
  try {
    if (provider.apiStyle === "gemini") {
      return {
        ok: true,
        result: "ready",
        reason: "sdk_provider_model_catalog_static",
        credentialKind,
        modelCount: status.models?.length || 0,
        selectedModelAvailable: status.models?.includes(status.selectedModel),
      };
    }
    const headers: Record<string, string> = provider.apiStyle === "anthropic"
      ? { "x-api-key": credential, "anthropic-version": "2023-06-01" }
      : { Authorization: `Bearer ${credential}` };
    const response = await fetch(`${getAiProviderBaseUrl(status.id, credential)}/models`, { signal: controller.signal, headers });
    const data = await response.json().catch(() => ({}));
    const models = Array.isArray(data?.data) ? data.data : Array.isArray(data?.models) ? data.models : [];
    const modelIds = models.map((model: any) => String(model?.id || model?.name || model || "")).filter(Boolean);
    return {
      ok: response.ok,
      result: response.ok ? "live_ready" : "live_failed",
      reason: response.ok ? "models_endpoint_ok" : "models_endpoint_http_error",
      credentialKind,
      models: modelIds,
      modelCount: modelIds.length,
      selectedModelAvailable: modelIds.length ? modelIds.includes(status.selectedModel) : undefined,
    };
  } catch (error: any) {
    return {
      ok: false,
      result: "live_failed",
      reason: error?.name === "AbortError" ? "models_endpoint_timeout" : "models_endpoint_unreachable",
      credentialKind,
    };
  } finally {
    clearTimeout(timer);
  }
}

async function getAiProviderTestSummary(status: ReturnType<typeof getAiProviderStatus>, mode: "configuration" | "live" = "configuration"): Promise<AiProviderTestSummary> {
  const credentialKind = status.id === "local" ? "endpoint" : "api_key";
  if (!status.enabled) {
    return {
      ok: false,
      result: "disabled",
      reason: "provider_disabled",
      credentialKind,
    };
  }
  if (!status.configured) {
    return {
      ok: false,
      result: "not_configured",
      reason: status.id === "local" ? "missing_local_endpoint" : "missing_provider_key",
      credentialKind,
    };
  }
  if (mode === "live") {
    if (status.id === "local") return testLocalModelEndpoint(status);
    if (supportsAiProviderModelDiscovery(status.id)) return testRemoteModelCatalog(status);
  }
  return {
    ok: true,
    result: "ready",
    reason: "ready",
    credentialKind,
  };
}

function getDataDirDiagnosticLabel() {
  return process.env.LIFEOS_DATA_DIR ? "Custom data directory configured" : "Default data directory";
}

function getAdminNetworkDiagnostics() {
  const diagnostics = getNetworkDiagnostics();
  const remoteValidationReport = getRemoteValidationReport();
  const latestBindingSession = getLatestBindingSession();
  const latestIcloudHandoffEvent = getLatestIcloudHandoffEvent();
  const remoteHealthSummary = summarizeRemoteHealth({
    baseUrl: diagnostics.desktopRuntimeConfig?.publicBaseUrl || diagnostics.remoteReadiness.baseUrl,
    readiness: diagnostics.remoteReadiness,
    report: remoteValidationReport,
    pairingSession: latestBindingSession,
  });
  const enrichedDiagnostics = {
    ...diagnostics,
    icloud: {
      ...diagnostics.icloud,
      latestIgnoredEntryEvent: latestIcloudHandoffEvent?.eventType === "ignored-superseded-entry" ? latestIcloudHandoffEvent : null,
    },
    cloudflareNamedTunnel: getCloudflareNamedTunnelStatus(),
  };
  const remoteAcceptanceRunbookRecords = getRemoteAcceptanceRunbookRecords();
  const remoteAcceptanceChecklist = buildRemoteAcceptanceChecklist({
    diagnostics: enrichedDiagnostics,
    health: remoteHealthSummary,
    report: remoteValidationReport,
    records: getRemoteAcceptanceRecords(),
  });
  const remoteAcceptanceSummary = summarizeRemoteAcceptanceChecklist(remoteAcceptanceChecklist);
  return {
    ...enrichedDiagnostics,
    remoteValidationReport,
    latestBindingSession: latestBindingSession
      ? {
        id: latestBindingSession.id,
        baseUrl: latestBindingSession.baseUrl || null,
        expiresAt: latestBindingSession.expiresAt,
        confirmedAt: latestBindingSession.confirmedAt || null,
        expired: latestBindingSession.expiresAt <= Date.now() && !latestBindingSession.confirmedAt,
      }
      : null,
    remoteHealthSummary,
    remoteHealthMonitor: getRemoteHealthMonitorStatus(),
    remoteHealthEvidence: getRemoteHealthEvidence(),
    remoteRecoveryReport: getRemoteRecoveryReport(),
    remoteAcceptanceChecklist,
    remoteAcceptanceSummary,
    remoteAcceptanceEvidencePack: buildRemoteAcceptanceEvidencePack({
      checklist: remoteAcceptanceChecklist,
      summary: remoteAcceptanceSummary,
      baseUrl: enrichedDiagnostics.desktopRuntimeConfig?.publicBaseUrl || remoteHealthSummary.baseUrl || enrichedDiagnostics.recommendedBaseUrl,
      runbooks: remoteAcceptanceRunbookRecords,
    }),
    remoteAcceptanceRunbooks: {
      total: remoteAcceptanceRunbookRecords.length,
      latest: remoteAcceptanceRunbookRecords.slice(-3).reverse(),
    },
  };
}

function safeAutoRefreshIcloudHandoff(reason: string) {
  try {
    return maybeRefreshIcloudHandoff(reason);
  } catch (error: any) {
    return {
      refreshed: false,
      reason: "error",
      requestedReason: reason,
      status: "unknown",
      error: String(error?.message || error || "iCloud Handoff refresh failed").slice(0, 240),
    };
  }
}

export function registerAdminRoutes(app: express.Express) {
  app.get("/api/v1/admin/status", (req, res) => {
    const configured = isAdminConfigured();
    const authenticated = Boolean(getAdminSessionByToken(getBearerToken(req)));
    const onboarding = configured && authenticated ? getOnboardingStatus() : null;
    res.json({
      configured,
      authenticated,
      envManaged: Boolean(process.env.LIFEOS_ADMIN_PASSWORD),
      onboardingRequired: onboarding?.required ?? null,
      nextPath: onboarding?.nextPath ?? null,
    });
  });

  app.get("/api/v1/admin/onboarding", requireAdmin, (_req, res) => {
    res.json({ onboarding: getOnboardingStatus() });
  });

  app.put("/api/v1/admin/onboarding/complete", requireAdmin, (req, res) => {
    try {
      const onboarding = markOnboardingComplete({ type: "admin", id: "owner" });
      insertAuditLog("admin_onboarding_completed", "admin", "owner", {
        completedAt: onboarding.completedAt,
        steps: onboarding.steps.map((step) => ({ id: step.id, done: step.done })),
        securityOverall: onboarding.securityOverall,
      }, (req as any).actor?.type, (req as any).actor?.id);
      res.json({ onboarding });
    } catch (error: any) {
      res.status(error.statusCode || 400).json({ error: error.message || "Onboarding is not complete", steps: error.details || undefined });
    }
  });

  app.get("/api/v1/admin/config-diagnostics", requireAdmin, (_req, res) => {
    const publicBaseUrl = getConfiguredPublicBaseUrl();
    const host = process.env.LIFEOS_HOST || "127.0.0.1";
    const aiStatus = getAiConfigStatus();
    const publicAccessWarning = Boolean(publicBaseUrl) || host === "0.0.0.0";
    const backupSchedule = getBackupSchedule();

    res.json({
      ai: {
        ...aiStatus,
        recommendations: aiStatus.configured
          ? [
            aiStatus.source === "environment"
              ? "AI service is configured by environment variables. Restart LifeOS AI after changing them."
              : `AI Key has been saved to ${aiStatus.secureStorage.label}.`,
          ]
          : [
            aiStatus.secureStorage.systemAvailable ? "The desktop app will prefer system secure storage for AI Keys." : "This environment will store AI Keys with local AES-GCM encryption.",
            "You can also set GEMINI_API_KEY, OPENAI_API_KEY, OPENROUTER_API_KEY, or LOCAL_MODEL_BASE_URL in .env.local and restart LifeOS AI.",
          ],
      },
      network: {
        host,
        publicBaseUrl,
        publicAccessAllowed: process.env.LIFEOS_ALLOW_PUBLIC === "1",
        publicAccessWarning,
        recommendations: publicAccessWarning
          ? ["Expose the service only through a trusted HTTPS tunnel or controlled reverse proxy.", "Public/LAN mode must explicitly set LIFEOS_ALLOW_PUBLIC=1.", "Set LIFEOS_TRUST_PROXY=1 only behind a trusted proxy."]
          : ["Currently listening on localhost only, suitable for desktop-only use."],
      },
      storage: {
        dataDir: getDataDirDiagnosticLabel(),
        dataDirConfigured: Boolean(process.env.LIFEOS_DATA_DIR),
        backupRetentionCount: process.env.LIFEOS_BACKUP_RETENTION_COUNT || "20",
        backupSchedule: {
          enabled: backupSchedule.enabled,
          intervalHours: backupSchedule.intervalHours,
          nextRunAt: backupSchedule.nextRunAt,
        },
        recommendations: backupSchedule.enabled
          ? ["Before upgrade, restore, or public access, confirm the latest SQLite backup is usable."]
          : ["Create a SQLite backup before upgrade, restore, or public access.", "Enable scheduled backups for long-term use."],
      },
      release: {
        ...getReleaseDiagnostics(),
        recommendations: ["When publishing for regular users, provide installers, USER-INSTALL.md, SHA256SUMS, and release-manifest.json."],
      },
      calendarSync: buildCalendarSyncPreview(),
      securityCheck: getSecurityDiagnostics(),
    });
  });

  app.get("/api/v1/admin/release/update-check", requireAdmin, async (req, res) => {
    const result = await checkReleaseUpdate();
    insertAuditLog("release_update_checked", "release", result.latest?.tag || result.current.tag, {
      status: result.status,
      currentTag: result.current.tag,
      latestTag: result.latest?.tag || null,
      updateAvailable: result.updateAvailable,
      manualUpdateRequired: result.manualUpdateRequired,
      autoUpdateEnabled: result.autoUpdateEnabled,
      reason: result.reason,
    }, (req as any).actor?.type, (req as any).actor?.id);
    res.json(result);
  });

  app.get("/api/v1/admin/calendar-sync/preview", requireAdmin, async (_req, res) => {
    res.json(await buildCalendarSyncPreviewAsync());
  });

  app.post("/api/v1/admin/calendar-sync/preview", requireAdmin, async (req, res) => {
    const preview = await buildCalendarSyncPreviewAsync({ proposedItems: req.body?.proposedItems });
    insertAuditLog("calendar_sync_preview_created", "calendar_sync", "preview", {
      mode: preview.mode,
      readOnlyItems: preview.summary.readOnlyItems,
      blockedWrites: preview.summary.blockedWrites,
      providerCount: preview.providers.length,
      operationCount: preview.operations.length,
      externalWritesEnabled: preview.externalWritesEnabled,
    }, (req as any).actor?.type, (req as any).actor?.id);
    res.json(preview);
  });

  app.get("/api/v1/admin/calendar-sync/runs", requireAdmin, (_req, res) => {
    res.json({ records: listCalendarSyncRuns() });
  });

  app.post("/api/v1/admin/calendar-sync/runs", requireAdmin, async (req, res) => {
    const preview = await buildCalendarSyncPreviewAsync({ proposedItems: req.body?.proposedItems });
    const run = createCalendarSyncRun({
      preview,
      recentHistory: listCalendarSyncOperations(),
      mode: "preview",
      createdByType: (req as any).actor?.type,
      createdById: (req as any).actor?.id,
    });
    insertAuditLog("calendar_sync_run_recorded", "calendar_sync", run.id, {
      provider: run.provider,
      mode: run.mode,
      status: run.status,
      operationCount: run.summary.operationCount,
      conflictCount: run.conflicts.length,
      blockedWrites: run.summary.blockedWrites,
      syncConflicts: run.summary.syncConflicts,
      nextStepCount: run.nextSteps.length,
    }, (req as any).actor?.type, (req as any).actor?.id);
    res.json({ record: run });
  });

  app.post("/api/v1/admin/calendar-sync/execute", requireAdmin, async (req, res) => {
    try {
      const result = await executeCalendarSyncOperationAsync(req.body || {});
      const historyRecord = saveCalendarSyncOperation(req.body || {}, result);
      insertAuditLog("calendar_sync_operation_executed", "calendar_sync", result.providerId, {
        historyRecordId: historyRecord.id,
        providerId: result.providerId,
        action: result.action,
        kind: result.kind,
        title: result.title,
        externalId: result.externalId,
        writesExternalSystem: result.auditSummary.writesExternalSystem,
        connector: result.auditSummary.connector,
        rollbackAvailable: result.rollbackPlan.available,
        rollbackRequiresManualReview: result.rollbackPlan.requiresManualReview,
        canAutoRollback: historyRecord.rollback.canAutoRollback,
      }, (req as any).actor?.type, (req as any).actor?.id);
      res.json({ ...result, historyRecord });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Calendar sync operation failed";
      insertAuditLog("calendar_sync_operation_blocked", "calendar_sync", "execute", {
        reason: message,
        providerId: req.body?.providerId,
        action: req.body?.action,
        kind: req.body?.kind,
      }, (req as any).actor?.type, (req as any).actor?.id);
      res.status(400).json({ error: message });
    }
  });

  app.get("/api/v1/admin/calendar-sync/history", requireAdmin, (_req, res) => {
    res.json({ records: listCalendarSyncOperations() });
  });

  app.post("/api/v1/admin/calendar-sync/operations/:operationId/rollback", requireAdmin, async (req, res) => {
    try {
      const rollback = await rollbackCalendarSyncOperation(req.params.operationId, req.body || {});
      insertAuditLog("calendar_sync_operation_rolled_back", "calendar_sync", req.params.operationId, {
        providerId: rollback.record.providerId,
        action: rollback.record.action,
        kind: rollback.record.kind,
        rollbackAction: rollback.result.action,
        rollbackExternalId: rollback.result.externalId,
        connector: rollback.result.auditSummary.connector,
      }, (req as any).actor?.type, (req as any).actor?.id);
      res.json(rollback);
    } catch (error: any) {
      const message = error instanceof Error ? error.message : "Calendar sync rollback failed";
      insertAuditLog("calendar_sync_rollback_blocked", "calendar_sync", req.params.operationId, {
        reason: message,
      }, (req as any).actor?.type, (req as any).actor?.id);
      res.status(error?.statusCode || 400).json({ error: message });
    }
  });

  app.post("/api/v1/admin/native-automation/plan", requireAdmin, (req, res) => {
    const plan = buildNativeAutomationPlan(req.body || {});
    insertAuditLog("native_automation_plan_created", "native_automation", plan.actionId, {
      kind: plan.kind,
      status: plan.status,
      canExecute: plan.canExecute,
      blockedReasons: plan.blockedReasons,
      bridgeEnabled: plan.safety.bridgeEnabled,
      allowlisted: plan.safety.allowlisted,
      platformSupported: plan.safety.platformSupported,
      explicitConsent: plan.safety.explicitConsent,
      confirmationAccepted: plan.safety.confirmationAccepted,
    }, (req as any).actor?.type, (req as any).actor?.id);
    res.json(plan);
  });

  app.post("/api/v1/admin/native-automation/execute", requireAdmin, async (req, res) => {
    const result = await executeNativeAutomation(req.body || {});
    insertAuditLog(result.ok ? "native_automation_executed" : "native_automation_blocked", "native_automation", result.plan.actionId, {
      kind: result.plan.kind,
      status: result.plan.status,
      canExecute: result.plan.canExecute,
      blockedReasons: result.plan.blockedReasons,
      bridgeEnabled: result.plan.safety.bridgeEnabled,
      allowlisted: result.plan.safety.allowlisted,
      platformSupported: result.plan.safety.platformSupported,
      explicitConsent: result.plan.safety.explicitConsent,
      confirmationAccepted: result.plan.safety.confirmationAccepted,
      commandExitCode: result.commandResult?.exitCode ?? null,
      commandTimedOut: result.commandResult?.timedOut ?? false,
      writesExternalSystem: result.auditSummary.writesExternalSystem,
    }, (req as any).actor?.type, (req as any).actor?.id);
    res.status(result.ok ? 200 : 400).json(result);
  });

  app.get("/api/v1/admin/network-diagnostics", requireAdmin, (_req, res) => {
    res.json(getAdminNetworkDiagnostics());
  });

  app.post("/api/v1/admin/network-diagnostics/test-url", requireAdmin, async (req, res) => {
    const baseUrl = String(req.body?.baseUrl || "").trim();
    const persist = Boolean(req.body?.persist);
    const label = String(req.body?.label || "").trim();
    if (!baseUrl) return res.status(400).json({ error: "baseUrl is required" });
    try {
      const result = await testConnectionUrl(baseUrl);
      const remoteValidationReport = persist
        ? saveRemoteValidationReport({ label, baseUrl, result }, { type: "admin", id: "owner" })
        : getRemoteValidationReport();
      insertAuditLog("network_connection_tested", "network", baseUrl, {
        ok: result.ok,
        status: result.status,
        latencyMs: result.latencyMs,
        persisted: persist,
        baseUrl: remoteValidationReport?.baseUrl,
      });
      res.json({ result, remoteValidationReport });
    } catch (error: any) {
      res.status(400).json({ error: error.message || "Connection test failed" });
    }
  });

  app.post("/api/v1/admin/network-diagnostics/remote-health", requireAdmin, async (_req, res) => {
    try {
      const result = await runRemoteHealthCheck("manual");
      res.json({ ...result, diagnostics: getAdminNetworkDiagnostics() });
    } catch (error: any) {
      res.status(400).json({ error: error.message || "Remote health check failed", diagnostics: getAdminNetworkDiagnostics() });
    }
  });

  app.post("/api/v1/admin/icloud-handoff/export", requireAdmin, (req, res) => {
    try {
      const handoff = exportIcloudHandoff();
      insertAuditLog("icloud_handoff_exported", "network", handoff.recommendedBaseUrl || "icloud-handoff", {
        handoffFilePath: handoff.handoffFilePath,
        packetFilePath: handoff.packetFilePath,
        recommendedBaseUrl: handoff.recommendedBaseUrl,
        recommendedMode: handoff.recommendedMode,
        realtimeTransport: handoff.realtimeTransport,
      }, (req as any).actor?.type, (req as any).actor?.id);
      res.json({
        handoff,
        diagnostics: getAdminNetworkDiagnostics(),
        message: "LifeOS mobile entry was exported to iCloud Drive.",
      });
    } catch (error: any) {
      insertAuditLog("icloud_handoff_export_failed", "network", "icloud-handoff", {
        error: error?.message || "iCloud Handoff export failed",
      }, (req as any).actor?.type, (req as any).actor?.id);
      res.status(400).json({ error: error.message || "iCloud Handoff export failed", diagnostics: getAdminNetworkDiagnostics() });
    }
  });

  app.post("/api/v1/admin/icloud-handoff/repair-packet", requireAdmin, (req, res) => {
    try {
      const analysis = analyzeIcloudHandoffRepairPacket(req.body?.packet || req.body?.text || "");
      insertAuditLog("icloud_handoff_repair_analyzed", "network", analysis.parsed.entryBaseUrl || "icloud-repair", {
        reason: analysis.reason,
        severity: analysis.severity,
        phoneEntryBaseUrl: analysis.parsed.entryBaseUrl || null,
        desktopRecommendedBaseUrl: analysis.desktop.recommendedBaseUrl || null,
        recommendations: analysis.recommendations.map((item) => item.id),
      }, (req as any).actor?.type, (req as any).actor?.id);
      res.json({ analysis, diagnostics: getAdminNetworkDiagnostics() });
    } catch (error: any) {
      insertAuditLog("icloud_handoff_repair_analyze_failed", "network", "icloud-repair", {
        error: error?.message || "iCloud repair info could not be analyzed",
      }, (req as any).actor?.type, (req as any).actor?.id);
      res.status(400).json({ error: error.message || "iCloud repair info could not be analyzed", diagnostics: getAdminNetworkDiagnostics() });
    }
  });

  app.post("/api/v1/admin/network-diagnostics/acceptance", requireAdmin, (req, res) => {
    try {
      const diagnostics = getAdminNetworkDiagnostics();
      const baseUrl = diagnostics.desktopRuntimeConfig?.publicBaseUrl || diagnostics.remoteHealthSummary.baseUrl;
      const record = saveRemoteAcceptanceRecord({
        id: req.body?.id,
        baseUrl,
        note: req.body?.note,
        evidence: req.body?.evidence,
      }, (req as any).actor || { type: "admin", id: "owner" });
      insertAuditLog("remote_acceptance_recorded", "network", record.id, {
        id: record.id,
        baseUrl: record.baseUrl,
        noteLength: record.note.length,
        entryKind: record.evidence?.entryKind,
        requirements: record.evidence?.requirements.length || 0,
        createdAt: record.createdAt,
      }, (req as any).actor?.type, (req as any).actor?.id);
      res.json({ record, diagnostics: getAdminNetworkDiagnostics() });
    } catch (error: any) {
      res.status(400).json({ error: error.message || "Remote acceptance could not be recorded", diagnostics: getAdminNetworkDiagnostics() });
    }
  });

  app.post("/api/v1/admin/network-diagnostics/acceptance-report", requireAdmin, (req, res) => {
    try {
      const record = saveRemoteAcceptanceRunbookReport(req.body?.report, (req as any).actor || { type: "admin", id: "owner" });
      insertAuditLog("remote_acceptance_report_imported", "network", record.id, {
        baseUrl: record.baseUrl,
        entryKind: record.entryKind,
        longTermReady: record.longTermReady,
        completionStatus: record.completionStatus,
        realWorldAcceptanceRequired: record.realWorldAcceptanceRequired,
        automatedPassed: record.automatedChecks.passed,
        automatedTotal: record.automatedChecks.total,
        manualSteps: record.manualAcceptance.length,
      }, (req as any).actor?.type, (req as any).actor?.id);
      res.json({ record, diagnostics: getAdminNetworkDiagnostics() });
    } catch (error: any) {
      res.status(400).json({ error: error.message || "Remote acceptance report could not be imported", diagnostics: getAdminNetworkDiagnostics() });
    }
  });

  app.post("/api/v1/admin/network-diagnostics/acceptance-run", requireAdmin, async (_req, res) => {
    try {
      const diagnostics = getAdminNetworkDiagnostics();
      const baseUrl = diagnostics.desktopRuntimeConfig?.publicBaseUrl || diagnostics.remoteHealthSummary.baseUrl;
      if (!baseUrl) return res.status(400).json({ error: "Save a Tailscale HTTPS Serve, Cloudflare Named Tunnel, or trusted HTTPS remote entry first.", diagnostics });
      const result = await testConnectionUrl(baseUrl);
      const record = saveRemoteAcceptanceRunbookFromConnectionTest({
        baseUrl,
        result,
      }, (_req as any).actor || { type: "admin", id: "owner" });
      insertAuditLog("remote_acceptance_run_completed", "network", record.id, {
        baseUrl: record.baseUrl,
        entryKind: record.entryKind,
        longTermReady: record.longTermReady,
        completionStatus: record.completionStatus,
        realWorldAcceptanceRequired: record.realWorldAcceptanceRequired,
        automatedPassed: record.automatedChecks.passed,
        automatedTotal: record.automatedChecks.total,
      }, (_req as any).actor?.type, (_req as any).actor?.id);
      res.json({ record, result, diagnostics: getAdminNetworkDiagnostics() });
    } catch (error: any) {
      res.status(400).json({ error: error.message || "Remote acceptance run failed", diagnostics: getAdminNetworkDiagnostics() });
    }
  });

  app.get("/api/v1/admin/cloudflare-tunnel", requireAdmin, (_req, res) => {
    res.json({ tunnel: getManagedCloudflareTunnelStatus(), diagnostics: getAdminNetworkDiagnostics() });
  });

  app.post("/api/v1/admin/cloudflare-named-tunnel/config", requireAdmin, (req, res) => {
    try {
      const status = generateCloudflareNamedTunnelConfig({
        name: req.body?.name,
        hostname: req.body?.hostname,
        credentialsFile: req.body?.credentialsFile,
      });
      insertAuditLog("cloudflare_named_tunnel_config_generated", "network", status.baseUrl || "cloudflare-named", {
        hostname: status.hostname,
        configPath: status.configPath,
        publicBaseUrlConfigured: Boolean(status.desktopConfig.publicBaseUrl),
      }, (req as any).actor?.type, (req as any).actor?.id);
      res.json({ namedTunnel: getCloudflareNamedTunnelStatus(), diagnostics: getAdminNetworkDiagnostics(), message: "Cloudflare Named Tunnel config generated and saved for startup." });
    } catch (error: any) {
      res.status(400).json({ error: error.message || "Cloudflare Named Tunnel config is invalid" });
    }
  });

  app.post("/api/v1/admin/cloudflare-named-tunnel/start", requireAdmin, async (req, res) => {
    const port = String(process.env.LIFEOS_PORT || process.env.PORT || "3000");
    try {
      const refresh = refreshCloudflareNamedTunnelConfigForPort(port);
      const tunnel = await startConfiguredCloudflareNamedTunnel(15000);
      const namedTunnel = getCloudflareNamedTunnelStatus();
      if (namedTunnel.baseUrl) {
        process.env.PUBLIC_BASE_URL = namedTunnel.baseUrl;
        process.env.LIFEOS_ALLOW_PUBLIC = "1";
        process.env.LIFEOS_TRUST_PROXY = "1";
      }
      const icloudRefresh = safeAutoRefreshIcloudHandoff("cloudflare-named-tunnel-started");
      insertAuditLog("cloudflare_named_tunnel_started", "network", namedTunnel.baseUrl || "cloudflare-named", {
        pid: tunnel.pid,
        hostname: namedTunnel.hostname,
        configPath: namedTunnel.configPath,
        configRefreshReason: refresh.reason,
        configRefreshed: refresh.refreshed,
        icloudRefresh,
      }, (req as any).actor?.type, (req as any).actor?.id);
      res.json({ tunnel, namedTunnel, refresh, icloudRefresh, diagnostics: getAdminNetworkDiagnostics(), message: "Cloudflare Named Tunnel started. The stable HTTPS domain is now the mobile pairing address." });
    } catch (error: any) {
      insertAuditLog("cloudflare_named_tunnel_start_failed", "network", "cloudflare-named", {
        error: error?.message || "Cloudflare Named Tunnel start failed",
      }, (req as any).actor?.type, (req as any).actor?.id);
      res.status(400).json({ error: error.message || "Cloudflare Named Tunnel start failed", namedTunnel: getCloudflareNamedTunnelStatus() });
    }
  });

  app.post("/api/v1/admin/cloudflare-tunnel/start", requireAdmin, async (req, res) => {
    const port = String(process.env.LIFEOS_PORT || process.env.PORT || "3000");
    try {
      const tunnel = await startManagedCloudflareTunnel(port);
      if (!tunnel.url) throw new Error("Cloudflare Tunnel did not return a public URL");
      const config = saveDesktopRuntimeConfig({
        mode: "cloudflare",
        label: "Cloudflare Tunnel",
        baseUrl: tunnel.url,
      });
      process.env.PUBLIC_BASE_URL = tunnel.url;
      process.env.LIFEOS_ALLOW_PUBLIC = "1";
      process.env.LIFEOS_TRUST_PROXY = "1";
      const icloudRefresh = safeAutoRefreshIcloudHandoff("cloudflare-tunnel-started");
      insertAuditLog("cloudflare_tunnel_started", "network", tunnel.url, {
        pid: tunnel.pid,
        url: tunnel.url,
        configMode: config.mode,
        publicBaseUrlConfigured: Boolean(config.publicBaseUrl),
        icloudRefresh,
      }, (req as any).actor?.type, (req as any).actor?.id);
      res.json({
        tunnel,
        config,
        icloudRefresh,
        diagnostics: getAdminNetworkDiagnostics(),
        message: "Cloudflare Tunnel started. The public HTTPS address has been saved for mobile pairing.",
      });
    } catch (error: any) {
      insertAuditLog("cloudflare_tunnel_start_failed", "network", "cloudflare", {
        error: error?.message || "Cloudflare Tunnel start failed",
      }, (req as any).actor?.type, (req as any).actor?.id);
      res.status(400).json({ error: error.message || "Cloudflare Tunnel start failed", tunnel: getManagedCloudflareTunnelStatus() });
    }
  });

  app.post("/api/v1/admin/cloudflare-tunnel/stop", requireAdmin, (req, res) => {
    const tunnel = stopManagedCloudflareTunnel();
    insertAuditLog("cloudflare_tunnel_stopped", "network", "cloudflare", {
      stoppedAt: Date.now(),
    }, (req as any).actor?.type, (req as any).actor?.id);
    res.json({ tunnel, diagnostics: getAdminNetworkDiagnostics(), message: "Cloudflare Tunnel stopped." });
  });

  app.post("/api/v1/admin/tailscale-serve/start", requireAdmin, (req, res) => {
    const port = String(process.env.LIFEOS_PORT || process.env.PORT || "3000");
    try {
      const serve = startTailscaleHttpsServe(port);
      const config = saveDesktopRuntimeConfig({
        mode: "tailscale",
        label: "Tailscale HTTPS Serve",
        baseUrl: serve.url,
      });
      process.env.PUBLIC_BASE_URL = serve.url;
      process.env.LIFEOS_ALLOW_PUBLIC = "1";
      process.env.LIFEOS_TRUST_PROXY = "1";
      const icloudRefresh = safeAutoRefreshIcloudHandoff("tailscale-serve-started");
      insertAuditLog("tailscale_https_serve_started", "network", serve.url, {
        command: serve.command,
        url: serve.url,
        configMode: config.mode,
        publicBaseUrlConfigured: Boolean(config.publicBaseUrl),
        icloudRefresh,
      }, (req as any).actor?.type, (req as any).actor?.id);
      res.json({
        serve,
        config,
        icloudRefresh,
        diagnostics: getAdminNetworkDiagnostics(),
        message: "Tailscale HTTPS Serve started. The stable Tailnet HTTPS address has been saved for mobile pairing.",
      });
    } catch (error: any) {
      insertAuditLog("tailscale_https_serve_start_failed", "network", "tailscale", {
        error: error?.message || "Tailscale HTTPS Serve start failed",
      }, (req as any).actor?.type, (req as any).actor?.id);
      res.status(400).json({ error: error.message || "Tailscale HTTPS Serve start failed", diagnostics: getAdminNetworkDiagnostics() });
    }
  });

  app.post("/api/v1/admin/tailscale/install", requireAdmin, (req, res) => {
    try {
      const install = installTailscaleClient(req.body?.confirm);
      insertAuditLog("tailscale_install_requested", "network", "tailscale", {
        ok: install.ok,
        alreadyInstalled: install.alreadyInstalled,
        command: install.command,
        installed: install.status.installed,
        online: install.status.online,
      }, (req as any).actor?.type, (req as any).actor?.id);
      res.json({
        install,
        diagnostics: getAdminNetworkDiagnostics(),
        message: install.message,
      });
    } catch (error: any) {
      insertAuditLog("tailscale_install_failed", "network", "tailscale", {
        error: error?.message || "Tailscale install failed",
      }, (req as any).actor?.type, (req as any).actor?.id);
      res.status(400).json({ error: error.message || "Tailscale install failed", diagnostics: getAdminNetworkDiagnostics() });
    }
  });

  app.post("/api/v1/admin/tailscale-serve/stop", requireAdmin, (req, res) => {
    try {
      const serve = stopTailscaleHttpsServe();
      insertAuditLog("tailscale_https_serve_stopped", "network", serve.url || "tailscale", {
        command: serve.command,
        url: serve.url,
      }, (req as any).actor?.type, (req as any).actor?.id);
      res.json({ serve, diagnostics: getAdminNetworkDiagnostics(), message: "Tailscale HTTPS Serve stopped." });
    } catch (error: any) {
      insertAuditLog("tailscale_https_serve_stop_failed", "network", "tailscale", {
        error: error?.message || "Tailscale HTTPS Serve stop failed",
      }, (req as any).actor?.type, (req as any).actor?.id);
      res.status(400).json({ error: error.message || "Tailscale HTTPS Serve stop failed", diagnostics: getAdminNetworkDiagnostics() });
    }
  });

  app.put("/api/v1/admin/desktop-connection-config", requireAdmin, (req, res) => {
    try {
      const config = saveDesktopRuntimeConfig({
        mode: req.body?.mode,
        label: req.body?.label,
        baseUrl: req.body?.baseUrl,
      });
      const icloudRefresh = safeAutoRefreshIcloudHandoff("desktop-connection-config-saved");
      insertAuditLog("desktop_connection_config_saved", "network", config.mode, {
        mode: config.mode,
        label: config.label,
        host: config.host,
        port: config.port,
        publicBaseUrlConfigured: Boolean(config.publicBaseUrl),
        allowPublic: config.allowPublic,
        restartRequired: true,
        icloudRefresh,
      }, (req as any).actor?.type, (req as any).actor?.id);
      res.json({
        config,
        icloudRefresh,
        restartRequired: true,
        message: "Desktop connection configuration saved. Quit and reopen LifeOS AI for it to take effect.",
      });
    } catch (error: any) {
      res.status(400).json({ error: error.message || "Desktop connection configuration is invalid" });
    }
  });

  app.get("/api/v1/admin/ai-providers", requireAdmin, (_req, res) => {
    res.json({ providers: listAiProviderStatuses() });
  });

  app.post("/api/v1/admin/ai-providers/:providerId/test", requireAdmin, async (req, res) => {
    const providerId = getProviderId(req.params.providerId);
    if (!providerId) return res.status(404).json({ error: "Unknown AI provider" });
    let status = getAiProviderStatus(providerId);
    const checkedAt = Date.now();
    const mode = req.body?.mode === "live" ? "live" : "configuration";
    const liveSupported = supportsAiProviderModelDiscovery(status.id);
    const summary = await getAiProviderTestSummary(status, mode);
    const discoveredModelCount = summary.models?.length || 0;
    let modelCatalogUpdated = false;
    if (summary.ok && mode === "live" && discoveredModelCount > 0) {
      status = saveDiscoveredAiModelCatalog(providerId, summary.models || [], { type: "admin", id: "owner" });
      modelCatalogUpdated = true;
    }
    insertAuditLog("ai_provider_tested", "config", providerId, {
      ...aiStatusAuditMetadata(status),
      result: summary.result,
      reason: summary.reason,
      credentialKind: summary.credentialKind,
      mode,
      liveSupported,
      selectedModel: status.selectedModel,
      modelCount: summary.modelCount,
      discoveredModelCount,
      modelCatalogUpdated,
      selectedModelAvailable: summary.selectedModelAvailable,
      checkedAt,
    });
    res.json({
      ok: summary.ok,
      provider: status,
      mode,
      liveSupported,
      selectedModel: status.selectedModel,
      checkedAt,
      result: summary.result,
      reason: summary.reason,
      credentialKind: summary.credentialKind,
      modelCount: summary.modelCount,
      discoveredModelCount,
      modelCatalogUpdated,
      selectedModelAvailable: summary.selectedModelAvailable,
      message: status.enabled
        ? status.configured
          ? mode === "live" && liveSupported
            ? summary.ok
              ? `${status.provider} model catalog check succeeded for ${status.selectedModel}. ${summary.modelCount ?? 0} model(s) reported by the endpoint. Model list refreshed.`
              : `${status.provider} model catalog check failed. Check the key, endpoint, and whether /models is supported.`
            : `${status.provider} configuration is ready for ${status.selectedModel}. Live API call was not run.`
          : status.id === "local"
            ? `${status.provider} has no endpoint configured.`
            : `${status.provider} has no key configured.`
        : `${status.provider} configuration is disabled.`,
    });
  });

  app.put("/api/v1/admin/ai-providers/:providerId/model", requireAdmin, (req, res) => {
    const providerId = getProviderId(req.params.providerId);
    if (!providerId) return res.status(404).json({ error: "Unknown AI provider" });
    const model = String(req.body?.model || "").trim();
    try {
      const previousStatus = getAiProviderStatus(providerId);
      const status = saveSelectedAiModel(providerId, model, { type: "admin", id: "owner" });
      insertAuditLog("ai_provider_model_updated", "config", providerId, {
        ...aiStatusAuditMetadata(status),
        model: status.selectedModel,
        previousModel: previousStatus.selectedModel,
        changed: previousStatus.selectedModel !== status.selectedModel,
      });
      res.json({ provider: status });
    } catch (error: any) {
      res.status(400).json({ error: error.message || "Unsupported AI model" });
    }
  });

  app.put("/api/v1/admin/ai-providers/:providerId/active", requireAdmin, (req, res) => {
    const providerId = getProviderId(req.params.providerId);
    if (!providerId) return res.status(404).json({ error: "Unknown AI provider" });
    try {
      const previousActiveProvider = getActiveAiProviderId();
      saveActiveAiProvider(providerId, { type: "admin", id: "owner" });
      const status = getAiProviderStatus(providerId);
      insertAuditLog("ai_provider_default_updated", "config", providerId, {
        ...aiStatusAuditMetadata(status),
        active: status.active,
        previousActiveProvider,
        changed: previousActiveProvider !== providerId,
      });
      res.json({ provider: status, providers: listAiProviderStatuses() });
    } catch (error: any) {
      res.status(400).json({ error: error.message || "Could not update default AI provider" });
    }
  });

  app.get("/api/v1/admin/diagnostic-bundle", requireAdmin, (req, res) => {
    const stamp = new Date().toISOString().replace(/[:.]/g, "-");
    const bundle = createDiagnosticBundle() as any;
    const databaseTables = bundle.database?.tables && typeof bundle.database.tables === "object" ? Object.values(bundle.database.tables) : [];
    const securityItems = Array.isArray(bundle.security?.items) ? bundle.security.items : [];
    insertAuditLog("diagnostic_bundle_exported", "diagnostics", "lifeos-diagnostics", {
      stamp,
      aiConfigured: Boolean(bundle.ai?.configured),
      aiProviders: Array.isArray(bundle.ai?.providers) ? bundle.ai.providers.length : 0,
      configuredAiProviders: Array.isArray(bundle.ai?.providers) ? bundle.ai.providers.filter((provider: any) => provider.configured).length : 0,
      deviceTotal: bundle.devices?.total || 0,
      deviceActive: bundle.devices?.active || 0,
      deviceOnline: bundle.devices?.online || 0,
      backupCount: bundle.database?.backups?.length || 0,
      databaseTableCount: databaseTables.length,
      databaseRowTotal: databaseTables.reduce((total: number, value: any) => total + (Number.isFinite(Number(value)) ? Number(value) : 0), 0),
      pendingRestore: Boolean(bundle.database?.pendingRestore),
      recentAuditCount: Array.isArray(bundle.recentAudit) ? bundle.recentAudit.length : 0,
      releaseManifestAvailable: Boolean(bundle.release?.manifestAvailable),
      releaseChecksumAvailable: Boolean(bundle.release?.checksumAvailable),
      releaseArtifactCount: bundle.release?.artifactCount || 0,
      publicBaseUrlConfigured: Boolean(bundle.network?.publicBaseUrl),
      remoteEntryMode: bundle.network?.desktopRuntimeConfig?.mode || "none",
      remoteStatus: bundle.remote?.healthSummary?.status || "unknown",
      remoteAcceptanceReady: Boolean(bundle.remote?.acceptanceSummary?.ready),
      remoteAcceptanceHasLongTermEntry: Boolean(bundle.remote?.acceptanceSummary?.hasLongTermEntry),
      remoteAcceptanceHasRealWorldEvidence: Boolean(bundle.remote?.acceptanceSummary?.hasRealWorldEvidence),
      remoteAcceptancePassed: Array.isArray(bundle.remote?.acceptanceChecklist) ? bundle.remote.acceptanceChecklist.filter((item: any) => item.status === "passed").length : 0,
      remoteAcceptanceManualRequired: Array.isArray(bundle.remote?.acceptanceChecklist) ? bundle.remote.acceptanceChecklist.filter((item: any) => item.status === "manual-required").length : 0,
      systemActionLogCount: bundle.systemActions?.totalLogs || 0,
      systemActionBlockedCount: bundle.systemActions?.blocked || 0,
      systemActionHighRiskCount: bundle.systemActions?.highRisk || 0,
      systemActionSourceCount: bundle.systemActions?.totalSources || 0,
      securityOverall: bundle.security?.overall || "unknown",
      securityCriticalCount: securityItems.filter((item: any) => item.status === "critical").length,
      securityWarningCount: securityItems.filter((item: any) => item.status === "warning").length,
      publicMode: Boolean(bundle.security?.publicMode),
    }, (req as any).actor?.type, (req as any).actor?.id);
    res.setHeader("Content-Type", "application/json; charset=utf-8");
    res.setHeader("Content-Disposition", `attachment; filename="lifeos-diagnostics-${stamp}.json"`);
    res.json(bundle);
  });

  app.put("/api/v1/admin/ai-key", requireAdmin, (req, res) => {
    const provider = getLegacyGeminiProvider();
    const apiKey = String(req.body?.apiKey || "").trim();
    if (process.env[provider.envVar]) {
      return res.status(409).json({ error: `AI key is managed by ${provider.envVar} environment variable` });
    }
    if (apiKey.length < 16) {
      return res.status(400).json({ error: "API key is too short" });
    }

    const previousStatus = getAiProviderStatus(provider.id);
    saveAiApiKey(apiKey, provider.id);
    const status = getAiProviderStatus(provider.id);
    insertAuditLog("ai_key_saved", "config", "google_gemini", {
      ...aiStatusAuditMetadata(status),
      ...aiProviderChangeAuditMetadata(previousStatus, status),
      ...aiCredentialAuditMetadata(provider.id, apiKey),
      compatibilityEndpoint: true,
    });
    res.json({ ai: status });
  });

  app.put("/api/v1/admin/ai-providers/:providerId/key", requireAdmin, (req, res) => {
    const providerId = getProviderId(req.params.providerId);
    if (!providerId) return res.status(404).json({ error: "Unknown AI provider" });
    const provider = aiProviders.find((item) => item.id === providerId)!;
    const apiKey = String(req.body?.apiKey || "").trim();
    if (process.env[provider.envVar]) {
      return res.status(409).json({ error: `AI key is managed by ${provider.envVar} environment variable` });
    }
    if (apiKey.length < 8) {
      return res.status(400).json({ error: "API key is too short" });
    }

    try {
      const previousStatus = getAiProviderStatus(providerId);
      saveAiApiKey(apiKey, providerId);
      const status = getAiProviderStatus(providerId);
      insertAuditLog("ai_key_saved", "config", providerId, {
        ...aiStatusAuditMetadata(status),
        ...aiProviderChangeAuditMetadata(previousStatus, status),
        ...aiCredentialAuditMetadata(providerId, apiKey),
      });
      res.json({ provider: status });
    } catch (error: any) {
      res.status(400).json({ error: error.message || "AI provider configuration is invalid" });
    }
  });

  app.delete("/api/v1/admin/ai-key", requireAdmin, (_req, res) => {
    const provider = getLegacyGeminiProvider();
    if (process.env[provider.envVar]) {
      return res.status(409).json({ error: `AI key is managed by ${provider.envVar} environment variable` });
    }
    const previousStatus = getAiProviderStatus(provider.id);
    deleteAiApiKey(provider.id);
    const status = getAiProviderStatus(provider.id);
    insertAuditLog("ai_key_deleted", "config", "google_gemini", {
      ...aiStatusAuditMetadata(status),
      ...aiProviderChangeAuditMetadata(previousStatus, status),
      compatibilityEndpoint: true,
    });
    res.json({ ai: status });
  });

  app.delete("/api/v1/admin/ai-providers/:providerId/key", requireAdmin, (req, res) => {
    const providerId = getProviderId(req.params.providerId);
    if (!providerId) return res.status(404).json({ error: "Unknown AI provider" });
    const provider = aiProviders.find((item) => item.id === providerId)!;
    if (process.env[provider.envVar]) {
      return res.status(409).json({ error: `AI key is managed by ${provider.envVar} environment variable` });
    }
    const previousStatus = getAiProviderStatus(providerId);
    deleteAiApiKey(providerId);
    const status = getAiProviderStatus(providerId);
    insertAuditLog("ai_key_deleted", "config", providerId, {
      ...aiStatusAuditMetadata(status),
      ...aiProviderChangeAuditMetadata(previousStatus, status),
    });
    res.json({ provider: status });
  });

  app.post("/api/v1/admin/setup", (req, res) => {
    if (isAdminConfigured()) {
      return res.status(409).json({ error: "Admin is already configured" });
    }

    const password = String(req.body?.password || "");
    const policy = evaluatePasswordPolicy(password);
    const policyError = adminPasswordPolicyError(policy);
    if (policyError) {
      return res.status(400).json({ error: policyError, code: "weak_password", passwordPolicy: policy });
    }

    createAdminCredential(password);
    setClientState("lifeos_admin_password_policy", policy, { type: "admin", id: "owner" });
    const session = createAdminSession();
    setHttpOnlyCookie(res, "lifeos_admin_session", session.token, session.expiresAt);
    setClientCookie(res, "lifeos_csrf", createSecret("csrf"), session.expiresAt);
    res.json({ expiresAt: session.expiresAt, onboardingRequired: true, nextPath: "/admin/onboarding" });
  });

  app.put("/api/v1/admin/password", requireAdmin, (req, res) => {
    if (process.env.LIFEOS_ADMIN_PASSWORD) {
      return res.status(409).json({ error: "Admin password is managed by LIFEOS_ADMIN_PASSWORD environment variable" });
    }

    const currentPassword = String(req.body?.currentPassword || "");
    const newPassword = String(req.body?.newPassword || "");
    if (!verifyAdminPassword(currentPassword)) {
      insertAuditLog("admin_password_change_failed", "admin", "owner", { reason: "invalid_current_password" }, "admin", "owner");
      return res.status(401).json({ error: "Current password is invalid", code: "invalid_current_password" });
    }
    const policy = evaluatePasswordPolicy(newPassword);
    const policyError = adminPasswordPolicyError(policy);
    if (policyError) {
      return res.status(400).json({ error: policyError, code: "weak_password", passwordPolicy: policy });
    }

    createAdminCredential(newPassword, { auditAction: false });
    setClientState("lifeos_admin_password_policy", policy, { type: "admin", id: "owner" });
    insertAuditLog("admin_password_changed", "admin", "owner", {
      meetsPolicy: policy.meetsPolicy,
      lengthBucket: policy.lengthBucket,
      hasVariety: policy.hasVariety,
      notCommon: policy.notCommon,
    }, "admin", "owner");
    res.json({ ok: true, passwordPolicy: policy, securityCheck: getSecurityDiagnostics() });
  });

  app.post("/api/v1/admin/local-password-reset", rateLimit({ keyPrefix: "admin-local-password-reset", windowMs: 15 * 60 * 1000, max: 5 }), (req, res) => {
    if (!isLoopbackSocket(req)) {
      insertAuditLog("admin_password_local_reset_blocked", "admin", "owner", { reason: "non_loopback_socket" }, "admin", "owner");
      return res.status(403).json({ error: "Local password reset is only available on this computer.", code: "local_reset_only" });
    }
    if (!isAdminConfigured()) {
      return res.status(409).json({ error: "Admin setup is required", code: "admin_setup_required" });
    }
    if (process.env.LIFEOS_ADMIN_PASSWORD) {
      return res.status(409).json({ error: "Admin password is managed by LIFEOS_ADMIN_PASSWORD environment variable", code: "env_managed_password" });
    }

    const newPassword = String(req.body?.newPassword || "");
    const policy = evaluatePasswordPolicy(newPassword);
    const policyError = adminPasswordPolicyError(policy);
    if (policyError) {
      return res.status(400).json({ error: policyError, code: "weak_password", passwordPolicy: policy });
    }

    const now = Date.now();
    db.prepare("UPDATE admin_sessions SET revoked_at = ? WHERE revoked_at IS NULL").run(now);
    createAdminCredential(newPassword, { auditAction: false });
    setClientState("lifeos_admin_password_policy", policy, { type: "admin", id: "owner" });
    insertAuditLog("admin_password_local_reset", "admin", "owner", {
      meetsPolicy: policy.meetsPolicy,
      lengthBucket: policy.lengthBucket,
      hasVariety: policy.hasVariety,
      notCommon: policy.notCommon,
    }, "admin", "owner");
    const session = createAdminSession();
    setHttpOnlyCookie(res, "lifeos_admin_session", session.token, session.expiresAt);
    setClientCookie(res, "lifeos_csrf", createSecret("csrf"), session.expiresAt);
    const onboarding = getOnboardingStatus();
    res.json({ expiresAt: session.expiresAt, onboardingRequired: onboarding.required, nextPath: onboarding.nextPath });
  });

  app.post("/api/v1/admin/login", rateLimit({ keyPrefix: "admin-login", windowMs: 15 * 60 * 1000, max: 12 }), (req, res) => {
    if (!isAdminConfigured()) {
      return res.status(409).json({ error: "Admin setup is required", code: "admin_setup_required" });
    }

    const key = loginKey(req);
    const failure = loginFailures.get(key);
    if (failure && failure.lockedUntil > Date.now()) {
      res.setHeader("Retry-After", String(Math.ceil((failure.lockedUntil - Date.now()) / 1000)));
      return res.status(423).json({ error: "Admin login is temporarily locked", code: "admin_login_locked" });
    }

    const password = String(req.body?.password || "");
    if (!verifyAdminPassword(password)) {
      const next = { count: (failure?.count || 0) + 1, lockedUntil: 0 };
      if (next.count >= 5) next.lockedUntil = Date.now() + 10 * 60 * 1000;
      loginFailures.set(key, next);
      insertAuditLog("admin_login_failed", "admin", "owner");
      return res.status(401).json({ error: "Invalid password", code: "invalid_password" });
    }

    loginFailures.delete(key);
    const session = createAdminSession();
    setHttpOnlyCookie(res, "lifeos_admin_session", session.token, session.expiresAt);
    setClientCookie(res, "lifeos_csrf", createSecret("csrf"), session.expiresAt);
    const onboarding = getOnboardingStatus();
    res.json({ expiresAt: session.expiresAt, onboardingRequired: onboarding.required, nextPath: onboarding.nextPath });
  });

  app.post("/api/v1/admin/logout", requireAdmin, (req, res) => {
    const token = getBearerToken(req);
    if (token) {
      db.prepare("UPDATE admin_sessions SET revoked_at = ? WHERE token_hash = ?").run(Date.now(), tokenHash(token));
    }
    clearHttpOnlyCookie(res, "lifeos_admin_session");
    clearHttpOnlyCookie(res, "lifeos_csrf");
    insertAuditLog("admin_logout", "admin", "owner");
    res.json({ ok: true });
  });

  app.get("/api/v1/audit-logs", requireAdmin, (_req, res) => {
    res.json({ logs: listAuditLogs() });
  });
}
