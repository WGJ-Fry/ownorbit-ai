import type express from "express";
import crypto from "crypto";
import { createDatabaseBackup, db } from "../db";
import { insertAuditLog, listAuditLogs } from "../audit";
import { aiProviders, deleteAiApiKey, getActiveAiProviderId, getAiApiKey, getAiConfigStatus, getAiProviderBaseUrl, getAiProviderDefinition, getAiProviderStatus, listAiProviderStatuses, saveActiveAiProvider, saveAiApiKey, saveDiscoveredAiModelCatalog, saveSelectedAiModel, supportsAiProviderModelDiscovery, type AiProviderId } from "../appSecrets";
import { buildCalendarSyncPreview, buildCalendarSyncPreviewAsync, executeCalendarSyncOperationAsync } from "../calendarSyncPreview";
import { listCalendarSyncOperations, rollbackCalendarSyncOperation, saveCalendarSyncOperation } from "../calendarSyncHistory";
import { createCalendarSyncRun, listCalendarSyncRuns } from "../calendarSyncRuns";
import { createAdminCredential, createAdminSession, getAdminSessionByToken, getBearerToken, isAdminConfigured, requireAdmin, verifyAdminPassword } from "../auth";
import { createDiagnosticBundle, getReleaseDiagnostics } from "../diagnosticBundle";
import { clearHttpOnlyCookie, getClientIp, rateLimit, setClientCookie, setHttpOnlyCookie } from "../httpSecurity";
import { IcloudHandoffExportError, analyzeIcloudHandoffRepairPacket, cleanupIcloudHandoffEntries, exportIcloudHandoff, getNetworkDiagnostics, installTailscaleClient, maybeRefreshIcloudHandoff, startTailscaleHttpsServe, stopTailscaleHttpsServe, testConnectionUrl } from "../networkDiagnostics";
import { generateCloudflareNamedTunnelConfig, getCloudflareNamedTunnelStatus, getManagedCloudflareTunnelStatus, refreshCloudflareNamedTunnelConfigForPort, startConfiguredCloudflareNamedTunnel, startManagedCloudflareTunnel, stopManagedCloudflareTunnel } from "../cloudflareTunnel";
import { saveDesktopRuntimeConfig } from "../desktopRuntimeConfig";
import { getConfiguredPublicBaseUrl } from "../publicBaseUrl";
import { getRemoteValidationReport, saveRemoteValidationReport, summarizeRemoteHealth } from "../remoteValidationReport";
import { getRemoteHealthEvidence, getRemoteHealthMonitorStatus, getRemoteRecoveryReport, runRemoteHealthCheck } from "../remoteHealthMonitor";
import { getIcloudHandoffMonitorStatus, runIcloudHandoffStartupRefresh } from "../icloudHandoffMonitor";
import { buildIcloudAcceptanceSummary } from "../icloudAcceptance";
import { buildRemoteAcceptanceChecklist, buildRemoteAcceptanceEvidencePack, getRemoteAcceptanceRecords, getRemoteAcceptanceRunbookRecords, saveRemoteAcceptanceRecord, saveRemoteAcceptanceRunbookFromConnectionTest, saveRemoteAcceptanceRunbookReport, summarizeRemoteAcceptanceChecklist } from "../remoteAcceptance";
import { createSecret, tokenHash } from "../security";
import { setClientState } from "../clientState";
import { evaluatePasswordPolicy, getSecurityDiagnostics } from "../securityDiagnostics";
import { getOnboardingStatus, markOnboardingComplete } from "../onboarding";
import { getBackupSchedule } from "../backupSchedule";
import { getLatestBindingSession, getLatestIcloudHandoffEventByTypes } from "../devices";
import { buildIcloudPhoneConfirmationStatus } from "../icloudPhoneConfirmation";
import { buildIcloudPairingSessionStatus } from "../icloudPairingSession";
import { buildLatestIcloudEntryRepairSummary } from "../icloudEntryRepair";
import { saveIcloudRepairImportAnalysis } from "../icloudRepairImports";
import { checkReleaseUpdate } from "../releaseUpdateCheck";
import { buildNativeAutomationPlan, executeNativeAutomation } from "../nativeAutomationBridge";
import { getIcloudDataSyncReadiness } from "../icloudDataSyncReadiness";
import { runCloudKitNativeHelper, type CloudKitNativeHelperOperation } from "../cloudKitNativeHelper";
import { buildCloudKitSyncBatchPreview, buildCloudKitSyncExportPackage, CLOUDKIT_SYNC_EXPORT_CONFIRMATION, summarizeCloudKitSyncExportPackage } from "../cloudKitSyncBatch";
import { CLOUDKIT_SYNC_IMPORT_CONFIRMATION, getCloudKitSyncQuarantineSummary, getCloudKitSyncStateSnapshot, listCloudKitSyncCheckpoints, publicCloudKitHelperResult, saveCloudKitSyncChangesPreview, saveCloudKitSyncImportQuarantine } from "../cloudKitSyncState";
import { applyCloudKitSyncQuarantine, CLOUDKIT_SYNC_APPLY_CONFIRMATION, listCloudKitSyncQuarantineItems } from "../cloudKitSyncApply";
import { listCloudKitDeviceTrustMetadata } from "../cloudKitDeviceTrustMetadata";
import { CLOUDKIT_SYNC_NOW_CONFIRMATION, runCloudKitSyncNow } from "../cloudKitSyncNow";
import { CLOUDKIT_SYNC_UPLOAD_NOW_CONFIRMATION, runCloudKitSyncUploadNow } from "../cloudKitSyncUploadNow";
import { CLOUDKIT_SYNC_CYCLE_CONFIRMATION, runCloudKitSyncCycle } from "../cloudKitSyncCycle";
import { clearCloudKitLocalChanges, getCloudKitAutoSyncSchedule, runCloudKitAutoSyncNow, updateCloudKitAutoSyncSchedule } from "../cloudKitAutoSyncSchedule";

const loginFailures = new Map<string, { count: number; lockedUntil: number }>();

function loginKey(req: express.Request) {
  return getClientIp(req);
}

function isLoopbackSocket(req: express.Request) {
  const remoteAddress = req.socket.remoteAddress || "";
  return remoteAddress === "127.0.0.1" || remoteAddress === "::1" || remoteAddress === "::ffff:127.0.0.1";
}

function verifyDesktopInternalToken(req: express.Request) {
  const expected = String(process.env.LIFEOS_DESKTOP_INTERNAL_TOKEN || "");
  const provided = String(req.headers["x-lifeos-desktop-token"] || "");
  if (expected.length < 32 || provided.length < 32) return false;
  const expectedBuffer = Buffer.from(expected);
  const providedBuffer = Buffer.from(provided);
  return expectedBuffer.length === providedBuffer.length && crypto.timingSafeEqual(expectedBuffer, providedBuffer);
}

function normalizeInternalRefreshReason(value: unknown) {
  const raw = String(value || "desktop-internal").trim();
  if (!raw) return "desktop-internal";
  return raw.replace(/[^a-z0-9_.:-]/gi, "-").slice(0, 80);
}

function normalizeCloudKitHelperOperation(value: unknown): CloudKitNativeHelperOperation {
  if (value === "roundtrip") return "roundtrip";
  if (value === "subscription-probe") return "subscription-probe";
  return "probe";
}

function cloudKitHelperAuditEvent(operation: CloudKitNativeHelperOperation) {
  if (operation === "roundtrip") return "icloud_cloudkit_helper_roundtrip";
  if (operation === "subscription-probe") return "icloud_cloudkit_helper_subscription_probe";
  return "icloud_cloudkit_helper_probe";
}

function normalizeCloudKitBatchLimit(value: unknown) {
  const parsed = Number.parseInt(String(value || ""), 10);
  if (!Number.isFinite(parsed) || parsed <= 0) return undefined;
  return Math.min(500, Math.max(1, parsed));
}

function normalizeCloudKitExportConfirmation(value: unknown) {
  return String(value || "").trim();
}

function normalizeCloudKitImportConfirmation(value: unknown) {
  return String(value || "").trim();
}

function normalizeCloudKitApplyConfirmation(value: unknown) {
  return String(value || "").trim();
}

function normalizeCloudKitSyncNowConfirmation(value: unknown) {
  return String(value || "").trim();
}

function normalizeCloudKitSyncUploadNowConfirmation(value: unknown) {
  return String(value || "").trim();
}

function normalizeCloudKitSyncCycleConfirmation(value: unknown) {
  return String(value || "").trim();
}

const icloudAcceptanceRecordIds: Record<string, "cellular-mobile-chat" | "restart-restore" | "network-switch" | "network-interruption" | "stale-qr-repair"> = {
  "cellular-mobile-chat": "cellular-mobile-chat",
  "restart-restore": "restart-restore",
  "network-switch": "network-switch",
  "network-interruption": "network-interruption",
  "old-entry-repair": "stale-qr-repair",
};

const icloudAcceptanceRequirements: Record<keyof typeof icloudAcceptanceRecordIds, string[]> = {
  "cellular-mobile-chat": [
    "Phone Wi-Fi disabled and /mobile/chat verified over cellular data.",
    "The iCloud entry stayed on the current HTTPS/VPN address.",
  ],
  "restart-restore": [
    "Desktop app restarted or reopened.",
    "Remote health check passed after restart on the same HTTPS entry.",
  ],
  "network-switch": [
    "Phone switched between Wi-Fi and cellular.",
    "Realtime chat or offline queue recovered after switching networks.",
  ],
  "network-interruption": [
    "VPN or HTTPS tunnel disconnect/interruption was tested.",
    "Tunnel restored and the phone reconnected with clear recovery guidance.",
  ],
  "old-entry-repair": [
    "Old QR or old home-screen entry was confirmed stale.",
    "Fresh QR re-pair restored /mobile/chat.",
  ],
};

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
  const latestIcloudHandoffOpenEvent = getLatestIcloudHandoffEventByTypes(["opened-current-entry"]);
  const latestIgnoredIcloudHandoffEvent = getLatestIcloudHandoffEventByTypes(["ignored-superseded-entry"]);
  const latestIcloudHandoffIssueEvent = getLatestIcloudHandoffEventByTypes([
    "opened-stale-entry",
    "opened-expired-entry",
    "opened-legacy-entry",
    "opened-address-mismatch-entry",
  ]);
  const remoteAcceptanceRecords = getRemoteAcceptanceRecords();
  const remoteHealthSummary = summarizeRemoteHealth({
    baseUrl: diagnostics.desktopRuntimeConfig?.publicBaseUrl || diagnostics.remoteReadiness.baseUrl,
    readiness: diagnostics.remoteReadiness,
    report: remoteValidationReport,
    pairingSession: latestBindingSession,
  });
  const phoneConfirmation = buildIcloudPhoneConfirmationStatus({
    handoffHealth: diagnostics.icloud.handoffHealth,
    recommendedBaseUrl: diagnostics.icloud.recommendedBaseUrl,
    latestEntryOpenEvent: latestIcloudHandoffOpenEvent || null,
    latestIgnoredEntryEvent: latestIgnoredIcloudHandoffEvent || null,
    latestEntryIssueEvent: latestIcloudHandoffIssueEvent || null,
  });
  const pairingSession = buildIcloudPairingSessionStatus({
    session: latestBindingSession || null,
    recommendedBaseUrl: diagnostics.icloud.recommendedBaseUrl,
  });
  const enrichedIcloud = {
    ...diagnostics.icloud,
    phoneConfirmation,
    pairingSession,
    latestEntryRepair: buildLatestIcloudEntryRepairSummary({
      latestEntryOpenEvent: latestIcloudHandoffOpenEvent || null,
      latestIgnoredEntryEvent: latestIgnoredIcloudHandoffEvent || null,
      latestEntryIssueEvent: latestIcloudHandoffIssueEvent || null,
      recommendedBaseUrl: diagnostics.icloud.recommendedBaseUrl,
      lastExportedBaseUrl: diagnostics.icloud.handoffHealth.lastExportedBaseUrl,
      handoffNeedsRefresh: diagnostics.icloud.handoffHealth.needsRefresh,
      phoneConfirmationAction: phoneConfirmation.action,
      pairingSessionAction: pairingSession.action,
    }),
    latestEntryOpenEvent: latestIcloudHandoffOpenEvent || null,
    latestIgnoredEntryEvent: latestIgnoredIcloudHandoffEvent || null,
    latestEntryIssueEvent: latestIcloudHandoffIssueEvent || null,
  };
  const enrichedDiagnostics = {
    ...diagnostics,
    icloud: {
      ...enrichedIcloud,
      acceptance: buildIcloudAcceptanceSummary({
        icloud: enrichedIcloud,
        remoteAcceptanceRecords,
      }),
    },
    cloudflareNamedTunnel: getCloudflareNamedTunnelStatus(),
  };
  const remoteAcceptanceRunbookRecords = getRemoteAcceptanceRunbookRecords();
  const remoteAcceptanceChecklist = buildRemoteAcceptanceChecklist({
    diagnostics: enrichedDiagnostics,
    health: remoteHealthSummary,
    report: remoteValidationReport,
    records: remoteAcceptanceRecords,
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
    icloudMonitor: getIcloudHandoffMonitorStatus(),
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

function rankDesktopInternalSeverity(severity: string) {
  if (severity === "danger") return 3;
  if (severity === "warning") return 2;
  if (severity === "ok") return 1;
  return 0;
}

function publicDesktopCloudKitAutoSync(schedule: ReturnType<typeof getCloudKitAutoSyncSchedule>) {
  const lastResult = schedule.lastResult;
  return {
    enabled: schedule.enabled,
    intervalMinutes: schedule.intervalMinutes,
    lastRunAt: schedule.lastRunAt || null,
    nextRunAt: schedule.nextRunAt || null,
    pendingTotal: schedule.pendingLocalChanges?.total || 0,
    pendingByType: schedule.pendingLocalChanges?.byType || {},
    lastResult: lastResult ? {
      ok: lastResult.ok,
      status: lastResult.status,
      nextAction: lastResult.nextAction,
      finishedAt: lastResult.finishedAt,
    } : null,
    rawPayloadReturned: false,
    cloudKitChangeTokenReturned: false,
  };
}

function buildDesktopInternalNetworkSummary(reason = "desktop-summary") {
  const diagnostics = getAdminNetworkDiagnostics();
  const icloud = diagnostics.icloud;
  const remote = diagnostics.remoteHealthSummary;
  const issues: Array<{
    id: string;
    severity: "warning" | "danger";
    action: string;
    title: string;
    body: string;
    actionLabel: string;
    path: string;
    updatedAt: number;
  }> = [];
  const now = Date.now();
  const latestRepair = icloud.latestEntryRepair || null;
  const dataSync = icloud.dataSync;
  const cloudKitAutoSync = getCloudKitAutoSyncSchedule();

  if (latestRepair && latestRepair.status !== "none" && latestRepair.action !== "none") {
    issues.push({
      id: "icloud-entry-repair",
      severity: latestRepair.severity === "danger" ? "danger" : "warning",
      action: latestRepair.action,
      title: latestRepair.needsQr ? "Phone opened an old LifeOS entry" : "Refresh the iCloud phone entry",
      body: latestRepair.needsQr
        ? "Refresh the iCloud entry and generate a new QR code before pairing again."
        : "Refresh the iCloud entry so the phone opens the current desktop address.",
      actionLabel: latestRepair.needsQr ? "Refresh iCloud Entry And QR" : "Refresh iCloud Entry",
      path: "/admin/onboarding",
      updatedAt: Number(latestRepair.eventAt || now),
    });
  }

  if (icloud.pairingSession?.action === "create-qr" || icloud.pairingSession?.action === "regenerate-qr") {
    issues.push({
      id: "icloud-qr-refresh",
      severity: icloud.pairingSession.severity === "danger" ? "danger" : "warning",
      action: icloud.pairingSession.action,
      title: icloud.pairingSession.action === "regenerate-qr" ? "Phone QR needs to be regenerated" : "Phone QR is not ready yet",
      body: "Open the LifeOS first launch guide and generate a fresh phone binding QR code.",
      actionLabel: "Open Phone Pairing",
      path: "/admin/devices/pair",
      updatedAt: Number(icloud.pairingSession.expiresAt || icloud.pairingSession.createdAt || now),
    });
  }

  if (icloud.syncReadiness?.severity && icloud.syncReadiness.severity !== "ok") {
    issues.push({
      id: "icloud-sync-readiness",
      severity: icloud.syncReadiness.severity === "danger" ? "danger" : "warning",
      action: icloud.syncReadiness.action,
      title: "iCloud phone handoff needs attention",
      body: icloud.syncReadiness.pendingCount > 0
        ? "iCloud is still syncing the phone entry. Open the guide for the one next step."
        : "Open the guide to create or repair the iCloud phone entry.",
      actionLabel: "Open iCloud Guide",
      path: "/admin/onboarding",
      updatedAt: now,
    });
  }

  if (dataSync.enabled && !dataSync.ready) {
    issues.push({
      id: "cloudkit-data-sync-setup",
      severity: "danger",
      action: "configure-cloudkit",
      title: "Finish iCloud data sync setup",
      body: "Open the Apple connection guide and complete the one missing setup step before LifeOS syncs personal data.",
      actionLabel: "Open iCloud Data Setup",
      path: "/admin/onboarding",
      updatedAt: now,
    });
  } else if (
    dataSync.ready &&
    cloudKitAutoSync.enabled &&
    cloudKitAutoSync.lastResult &&
    !cloudKitAutoSync.lastResult.ok &&
    !["continue-pull", "wait"].includes(cloudKitAutoSync.lastResult.nextAction)
  ) {
    const reviewRequired = ["review-conflicts", "review-blocked-records"].includes(cloudKitAutoSync.lastResult.nextAction);
    issues.push({
      id: reviewRequired ? "cloudkit-data-sync-review" : "cloudkit-data-sync-retry",
      severity: reviewRequired ? "warning" : "danger",
      action: cloudKitAutoSync.lastResult.nextAction,
      title: reviewRequired ? "Review iCloud data changes" : "Retry iCloud data sync",
      body: reviewRequired
        ? "LifeOS stopped before overwriting local data. Review the pending changes on this Mac."
        : "LifeOS could not finish the latest data sync. Open the guide for the next safe step.",
      actionLabel: reviewRequired ? "Review iCloud Changes" : "Open iCloud Data Sync",
      path: "/admin/onboarding",
      updatedAt: cloudKitAutoSync.lastResult.finishedAt || now,
    });
  }

  if (remote?.severity && remote.severity !== "ok" && !["missing", "unchecked"].includes(remote.status)) {
    issues.push({
      id: "remote-health",
      severity: remote.severity === "danger" ? "danger" : "warning",
      action: remote.recommendations[0] || "run-remote-health",
      title: "Remote phone entry needs a check",
      body: "Run the remote health check before relying on this address outside your Wi-Fi.",
      actionLabel: "Open Connection Guide",
      path: "/admin/onboarding",
      updatedAt: Number(remote.lastCheckedAt || now),
    });
  }

  issues.sort((a, b) => rankDesktopInternalSeverity(b.severity) - rankDesktopInternalSeverity(a.severity) || b.updatedAt - a.updatedAt);

  return {
    ok: true,
    reason,
    generatedAt: now,
    alert: issues[0] || null,
    issues,
    remote: {
      status: remote?.status || "unchecked",
      severity: remote?.severity || "warning",
      entryKind: remote?.entryKind || "missing",
      lastCheckedAt: remote?.lastCheckedAt || null,
      recommendations: Array.isArray(remote?.recommendations) ? remote.recommendations.slice(0, 3) : [],
    },
    icloud: {
      available: Boolean(icloud.available),
      platformSupported: Boolean(icloud.platformSupported),
      status: icloud.syncReadiness?.status || icloud.handoffHealth?.status || "unsupported",
      severity: icloud.syncReadiness?.severity || "warning",
      recommendedMode: icloud.recommendedMode || "",
      recommendedStability: icloud.recommendedStability || "",
      syncReadiness: {
        status: icloud.syncReadiness?.status || "unsupported",
        severity: icloud.syncReadiness?.severity || "warning",
        action: icloud.syncReadiness?.action || "use-apple-device",
        pendingCount: Number(icloud.syncReadiness?.pendingCount || 0),
        pendingFiles: Array.isArray(icloud.syncReadiness?.pendingFiles) ? icloud.syncReadiness.pendingFiles : [],
        missingFiles: Array.isArray(icloud.syncReadiness?.missingFiles) ? icloud.syncReadiness.missingFiles : [],
      },
      handoffHealth: {
        status: icloud.handoffHealth?.status || "missing",
        needsRefresh: Boolean(icloud.handoffHealth?.needsRefresh),
        refreshAfterMs: Number(icloud.handoffHealth?.refreshAfterMs || 0),
        expiresAfterMs: Number(icloud.handoffHealth?.expiresAfterMs || 0),
      },
      phoneConfirmation: {
        status: icloud.phoneConfirmation?.status || "missing",
        severity: icloud.phoneConfirmation?.severity || "warning",
        action: icloud.phoneConfirmation?.action || "open-on-phone",
      },
      pairingSession: {
        status: icloud.pairingSession?.status || "missing",
        severity: icloud.pairingSession?.severity || "warning",
        action: icloud.pairingSession?.action || "create-qr",
        secondsRemaining: Number(icloud.pairingSession?.secondsRemaining || 0),
      },
      latestEntryRepair: latestRepair ? {
        status: latestRepair.status,
        severity: latestRepair.severity,
        action: latestRepair.action,
        needsRefresh: Boolean(latestRepair.needsRefresh),
        needsQr: Boolean(latestRepair.needsQr),
        eventAt: Number(latestRepair.eventAt || 0),
      } : null,
      dataSync: {
        enabled: Boolean(dataSync.enabled),
        ready: Boolean(dataSync.ready),
        status: dataSync.status,
        selectedDataTypes: Array.isArray(dataSync.selectedDataTypes) ? dataSync.selectedDataTypes.slice(0, 8) : [],
        autoSync: publicDesktopCloudKitAutoSync(cloudKitAutoSync),
      },
      monitor: {
        enabled: Boolean(diagnostics.icloudMonitor?.enabled),
        running: Boolean(diagnostics.icloudMonitor?.running),
        lastRunAt: diagnostics.icloudMonitor?.lastRunAt || null,
        nextRunAt: diagnostics.icloudMonitor?.nextRunAt || null,
      },
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

  app.post("/api/v1/internal/desktop/network-summary", rateLimit({ keyPrefix: "internal-desktop-network-summary", windowMs: 60_000, max: 60 }), (req, res) => {
    if (!isLoopbackSocket(req)) {
      insertAuditLog("desktop_internal_network_summary_blocked", "network", "desktop-network-summary", { reason: "non_loopback_socket" }, "system", "desktop");
      return res.status(403).json({ error: "Desktop network summary is only available on this computer.", code: "local_only" });
    }
    if (!verifyDesktopInternalToken(req)) {
      insertAuditLog("desktop_internal_network_summary_blocked", "network", "desktop-network-summary", { reason: "invalid_desktop_token" }, "system", "desktop");
      return res.status(401).json({ error: "Desktop internal authentication required", code: "desktop_internal_auth_required" });
    }
    const reason = normalizeInternalRefreshReason(req.body?.reason || "desktop-summary");
    res.json(buildDesktopInternalNetworkSummary(reason));
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

  app.post("/api/v1/admin/icloud-data-sync/helper", requireAdmin, rateLimit({ keyPrefix: "admin-cloudkit-helper", windowMs: 60_000, max: 10 }), async (req, res) => {
    const operation = normalizeCloudKitHelperOperation(req.body?.operation);
    try {
      const diagnostics = getAdminNetworkDiagnostics();
      const readiness = getIcloudDataSyncReadiness({ platformSupported: diagnostics.icloud.platformSupported });
      const result = await runCloudKitNativeHelper(readiness, { operation });
      insertAuditLog(
        cloudKitHelperAuditEvent(operation),
        "network",
        "cloudkit-helper",
        {
          operation,
          status: result.status,
          ok: result.ok,
          readinessStatus: result.readinessStatus,
          evidenceId: "evidenceId" in result ? result.evidenceId || null : null,
          accountStatus: "accountStatus" in result ? result.accountStatus || null : null,
          containerReachable: "containerReachable" in result ? Boolean(result.containerReachable) : false,
          capabilitiesVerified: "capabilitiesVerified" in result && Array.isArray(result.capabilitiesVerified) ? result.capabilitiesVerified : [],
          roundtrip: "roundtrip" in result ? result.roundtrip : null,
          warningCount: "warnings" in result && Array.isArray(result.warnings) ? result.warnings.length : 0,
          errorCount: "errors" in result && Array.isArray(result.errors) ? result.errors.length : 0,
          commandExitCode: "command" in result ? result.command?.exitCode ?? null : null,
          timedOut: "command" in result ? Boolean(result.command?.timedOut) : false,
        },
        (req as any).actor?.type,
        (req as any).actor?.id,
      );
      const responseStatus = result.status === "failed" ? 400 : 200;
      res.status(responseStatus).json({ result, diagnostics: getAdminNetworkDiagnostics() });
    } catch (error: any) {
      insertAuditLog(
        "icloud_cloudkit_helper_failed",
        "network",
        "cloudkit-helper",
        {
          operation,
          error: error?.message || "CloudKit helper failed",
        },
        (req as any).actor?.type,
        (req as any).actor?.id,
      );
      res.status(400).json({ error: error.message || "CloudKit helper failed", diagnostics: getAdminNetworkDiagnostics() });
    }
  });

  app.get("/api/v1/admin/icloud-data-sync/batch-preview", requireAdmin, rateLimit({ keyPrefix: "admin-cloudkit-batch-preview", windowMs: 60_000, max: 20 }), (req, res) => {
    try {
      const diagnostics = getAdminNetworkDiagnostics();
      const readiness = getIcloudDataSyncReadiness({ platformSupported: diagnostics.icloud.platformSupported });
      const preview = buildCloudKitSyncBatchPreview(readiness, { limit: normalizeCloudKitBatchLimit(req.query.limit) });
      insertAuditLog("icloud_cloudkit_batch_previewed", "network", "cloudkit-sync-batch", {
        status: preview.status,
        readinessStatus: preview.readinessStatus,
        selectedDataTypes: preview.selectedDataTypes,
        readyRecordCount: preview.readyRecordCount,
        blockedRecordCount: preview.blockedRecordCount,
        totalCandidateCount: preview.totalCandidateCount,
        rawPayloadIncluded: preview.safety.rawPayloadIncluded,
        nextHelperOperation: preview.helperPayloadPlan.nextHelperOperation,
      }, (req as any).actor?.type, (req as any).actor?.id);
      res.json({ preview, diagnostics });
    } catch (error: any) {
      insertAuditLog("icloud_cloudkit_batch_preview_failed", "network", "cloudkit-sync-batch", {
        error: error?.message || "CloudKit sync batch preview failed",
      }, (req as any).actor?.type, (req as any).actor?.id);
      res.status(400).json({ error: error.message || "CloudKit sync batch preview failed", diagnostics: getAdminNetworkDiagnostics() });
    }
  });

  app.post("/api/v1/admin/icloud-data-sync/export", requireAdmin, rateLimit({ keyPrefix: "admin-cloudkit-sync-export", windowMs: 60_000, max: 4 }), async (req, res) => {
    const confirmation = normalizeCloudKitExportConfirmation(req.body?.confirmation);
    try {
      const diagnostics = getAdminNetworkDiagnostics();
      const readiness = getIcloudDataSyncReadiness({ platformSupported: diagnostics.icloud.platformSupported });
      const exportPackage = buildCloudKitSyncExportPackage(readiness, {
        limit: normalizeCloudKitBatchLimit(req.body?.limit),
        confirmation,
      });
      const summary = summarizeCloudKitSyncExportPackage(exportPackage);
      if (!exportPackage.ok) {
        insertAuditLog("icloud_cloudkit_sync_export_blocked", "network", "cloudkit-sync-export", {
          status: summary.status,
          readinessStatus: summary.preview.readinessStatus,
          previewStatus: summary.preview.status,
          readyRecordCount: summary.preview.readyRecordCount,
          blockedRecordCount: summary.preview.blockedRecordCount,
          exportRecordCount: summary.exportRecordCount,
          confirmationProvided: confirmation === CLOUDKIT_SYNC_EXPORT_CONFIRMATION,
          rawPayloadReturnedToAdmin: summary.safety.rawPayloadReturnedToAdmin,
        }, (req as any).actor?.type, (req as any).actor?.id);
        return res.status(400).json({
          export: summary,
          diagnostics,
          error: "CloudKit sync export is blocked until readiness, safe records, and explicit confirmation pass.",
        });
      }

      const backup = createDatabaseBackup({ prune: false });
      const result = await runCloudKitNativeHelper(readiness, {
        operation: "sync-export",
        syncExportPackage: exportPackage,
        timeoutMs: 60_000,
      });
      const pendingClear = result.status === "passed"
        ? clearCloudKitLocalChanges("manual-export", { type: (req as any).actor?.type || "admin", id: (req as any).actor?.id || "admin" })
        : { schedule: getCloudKitAutoSyncSchedule(), cleared: false, clearedTotal: 0 };
      insertAuditLog("icloud_cloudkit_sync_export", "network", "cloudkit-sync-export", {
        status: result.status,
        ok: result.ok,
        readinessStatus: "readinessStatus" in result ? result.readinessStatus : readiness.status,
        evidenceId: "evidenceId" in result ? result.evidenceId || null : null,
        exportRecordCount: summary.exportRecordCount,
        recordPlanHash: summary.recordPlanHash,
        syncExport: "syncExport" in result ? result.syncExport : null,
        backupFile: backup.file,
        backupSize: backup.size,
        pendingLocalChangesCleared: pendingClear.cleared,
        pendingLocalChangesClearedTotal: pendingClear.clearedTotal,
        rawPayloadReturnedToAdmin: summary.safety.rawPayloadReturnedToAdmin,
      }, (req as any).actor?.type, (req as any).actor?.id);
      res.status(result.status === "passed" ? 200 : 400).json({
        result,
        export: summary,
        schedule: pendingClear.schedule,
        backup: { file: backup.file, size: backup.size, createdAt: backup.createdAt, redaction: backup.redaction },
        diagnostics: getAdminNetworkDiagnostics(),
      });
    } catch (error: any) {
      insertAuditLog("icloud_cloudkit_sync_export_failed", "network", "cloudkit-sync-export", {
        error: error?.message || "CloudKit sync export failed",
      }, (req as any).actor?.type, (req as any).actor?.id);
      res.status(400).json({ error: error.message || "CloudKit sync export failed", diagnostics: getAdminNetworkDiagnostics() });
    }
  });

  app.post("/api/v1/admin/icloud-data-sync/import-preview", requireAdmin, rateLimit({ keyPrefix: "admin-cloudkit-sync-import-preview", windowMs: 60_000, max: 8 }), async (req, res) => {
    try {
      const diagnostics = getAdminNetworkDiagnostics();
      const readiness = getIcloudDataSyncReadiness({ platformSupported: diagnostics.icloud.platformSupported });
      const result = await runCloudKitNativeHelper(readiness, {
        operation: "sync-import-preview",
        timeoutMs: 60_000,
      });
      insertAuditLog("icloud_cloudkit_sync_import_preview", "network", "cloudkit-sync-import-preview", {
        status: result.status,
        ok: result.ok,
        readinessStatus: "readinessStatus" in result ? result.readinessStatus : readiness.status,
        evidenceId: "evidenceId" in result ? result.evidenceId || null : null,
        syncImportPreview: "syncImportPreview" in result ? {
          fetched: result.syncImportPreview.fetched,
          failed: result.syncImportPreview.failed,
          truncated: result.syncImportPreview.truncated,
          scannedZones: result.syncImportPreview.scannedZones,
          scannedRecordTypes: result.syncImportPreview.scannedRecordTypes,
          recordCount: result.syncImportPreview.records.length,
        } : null,
      }, (req as any).actor?.type, (req as any).actor?.id);
      res.status(result.status === "failed" ? 400 : 200).json({ result, diagnostics: getAdminNetworkDiagnostics() });
    } catch (error: any) {
      insertAuditLog("icloud_cloudkit_sync_import_preview_failed", "network", "cloudkit-sync-import-preview", {
        error: error?.message || "CloudKit sync import preview failed",
      }, (req as any).actor?.type, (req as any).actor?.id);
      res.status(400).json({ error: error.message || "CloudKit sync import preview failed", diagnostics: getAdminNetworkDiagnostics() });
    }
  });

  app.post("/api/v1/admin/icloud-data-sync/changes-preview", requireAdmin, rateLimit({ keyPrefix: "admin-cloudkit-sync-changes-preview", windowMs: 60_000, max: 8 }), async (req, res) => {
    try {
      const diagnostics = getAdminNetworkDiagnostics();
      const readiness = getIcloudDataSyncReadiness({ platformSupported: diagnostics.icloud.platformSupported });
      const syncState = getCloudKitSyncStateSnapshot();
      const result = await runCloudKitNativeHelper(readiness, {
        operation: "sync-changes-preview",
        syncState,
        timeoutMs: 60_000,
      });
      const saved = saveCloudKitSyncChangesPreview(result);
      const publicResult = publicCloudKitHelperResult(result);
      insertAuditLog("icloud_cloudkit_sync_changes_preview", "network", "cloudkit-sync-changes-preview", {
        status: result.status,
        ok: result.ok,
        readinessStatus: "readinessStatus" in result ? result.readinessStatus : readiness.status,
        evidenceId: "evidenceId" in result ? result.evidenceId || null : null,
        syncChangesPreview: "syncChangesPreview" in result ? {
          scannedZones: result.syncChangesPreview.scannedZones,
          changed: result.syncChangesPreview.changed,
          deleted: result.syncChangesPreview.deleted,
          failed: result.syncChangesPreview.failed,
          moreComing: result.syncChangesPreview.moreComing,
          zoneCount: result.syncChangesPreview.zones.length,
          tokenSavedCount: saved.saved,
          rawPayloadIncluded: result.syncChangesPreview.rawPayloadIncluded,
        } : null,
      }, (req as any).actor?.type, (req as any).actor?.id);
      res.status(result.status === "failed" ? 400 : 200).json({
        result: publicResult,
        checkpoints: saved.checkpoints,
        diagnostics: getAdminNetworkDiagnostics(),
      });
    } catch (error: any) {
      insertAuditLog("icloud_cloudkit_sync_changes_preview_failed", "network", "cloudkit-sync-changes-preview", {
        error: error?.message || "CloudKit sync changes preview failed",
      }, (req as any).actor?.type, (req as any).actor?.id);
      res.status(400).json({
        error: error.message || "CloudKit sync changes preview failed",
        checkpoints: listCloudKitSyncCheckpoints(),
        diagnostics: getAdminNetworkDiagnostics(),
      });
    }
  });

  app.post("/api/v1/admin/icloud-data-sync/import-quarantine", requireAdmin, rateLimit({ keyPrefix: "admin-cloudkit-sync-import-quarantine", windowMs: 60_000, max: 4 }), async (req, res) => {
    const confirmation = normalizeCloudKitImportConfirmation(req.body?.confirmation);
    const diagnostics = getAdminNetworkDiagnostics();
    if (confirmation !== CLOUDKIT_SYNC_IMPORT_CONFIRMATION) {
      insertAuditLog("icloud_cloudkit_sync_import_quarantine_blocked", "network", "cloudkit-sync-import-quarantine", {
        confirmationProvided: false,
        importedChanged: 0,
        importedDeleted: 0,
        rawPayloadReturnedToAdmin: false,
      }, (req as any).actor?.type, (req as any).actor?.id);
      return res.status(400).json({
        error: "CloudKit import quarantine requires explicit confirmation.",
        expectedConfirmation: CLOUDKIT_SYNC_IMPORT_CONFIRMATION,
        quarantine: getCloudKitSyncQuarantineSummary(),
        checkpoints: listCloudKitSyncCheckpoints(),
        diagnostics,
      });
    }

    try {
      const readiness = getIcloudDataSyncReadiness({ platformSupported: diagnostics.icloud.platformSupported });
      const syncState = getCloudKitSyncStateSnapshot();
      const shouldBackup = Boolean(readiness.enabled && readiness.ready && readiness.nativeHelper.executable && readiness.nativeHelper.path);
      const backup = shouldBackup ? createDatabaseBackup({ prune: false }) : undefined;
      const result = await runCloudKitNativeHelper(readiness, {
        operation: "sync-import-quarantine",
        syncState,
        importConfirmation: confirmation,
        timeoutMs: 60_000,
      });
      const saved = result.status === "passed"
        ? saveCloudKitSyncImportQuarantine(result)
        : { tokenSaved: 0, summary: getCloudKitSyncQuarantineSummary(), checkpoints: listCloudKitSyncCheckpoints() };
      const publicResult = publicCloudKitHelperResult(result);
      insertAuditLog("icloud_cloudkit_sync_import_quarantine", "network", "cloudkit-sync-import-quarantine", {
        status: result.status,
        ok: result.ok,
        readinessStatus: "readinessStatus" in result ? result.readinessStatus : readiness.status,
        evidenceId: "evidenceId" in result ? result.evidenceId || null : null,
        syncImportQuarantine: "syncImportQuarantine" in result ? {
          scannedZones: result.syncImportQuarantine.scannedZones,
          changed: result.syncImportQuarantine.changed,
          deleted: result.syncImportQuarantine.deleted,
          failed: result.syncImportQuarantine.failed,
          moreComing: result.syncImportQuarantine.moreComing,
          tokenSavedCount: saved.tokenSaved,
          importedChanged: saved.summary.importedChanged,
          importedDeleted: saved.summary.importedDeleted,
          skipped: saved.summary.skipped,
          autoReady: saved.summary.autoReady,
          pendingReview: saved.summary.pendingReview,
          rawPayloadIncluded: result.syncImportQuarantine.rawPayloadIncluded,
          rawPayloadReturnedToAdmin: false,
        } : null,
        backupFile: backup?.file || null,
        backupSize: backup?.size || null,
      }, (req as any).actor?.type, (req as any).actor?.id);
      res.status(result.status === "failed" ? 400 : 200).json({
        result: publicResult,
        quarantine: saved.summary,
        checkpoints: saved.checkpoints,
        backup: backup ? { file: backup.file, size: backup.size, createdAt: backup.createdAt, redaction: backup.redaction } : undefined,
        diagnostics: getAdminNetworkDiagnostics(),
      });
    } catch (error: any) {
      insertAuditLog("icloud_cloudkit_sync_import_quarantine_failed", "network", "cloudkit-sync-import-quarantine", {
        error: error?.message || "CloudKit sync import quarantine failed",
        rawPayloadReturnedToAdmin: false,
      }, (req as any).actor?.type, (req as any).actor?.id);
      res.status(400).json({
        error: error.message || "CloudKit sync import quarantine failed",
        quarantine: getCloudKitSyncQuarantineSummary(),
        checkpoints: listCloudKitSyncCheckpoints(),
        diagnostics: getAdminNetworkDiagnostics(),
      });
    }
  });

  app.post("/api/v1/admin/icloud-data-sync/upload-now", requireAdmin, rateLimit({ keyPrefix: "admin-cloudkit-sync-upload-now", windowMs: 60_000, max: 3 }), async (req, res) => {
    const confirmation = normalizeCloudKitSyncUploadNowConfirmation(req.body?.confirmation);
    const diagnostics = getAdminNetworkDiagnostics();
    if (confirmation !== CLOUDKIT_SYNC_UPLOAD_NOW_CONFIRMATION) {
      insertAuditLog("icloud_cloudkit_sync_upload_now_blocked", "network", "cloudkit-sync-upload-now", {
        confirmationProvided: false,
        rawPayloadReturnedToAdmin: false,
        localBackupPathReturnedToAdmin: false,
      }, (req as any).actor?.type, (req as any).actor?.id);
      return res.status(400).json({
        error: "CloudKit safe upload now requires explicit confirmation.",
        expectedConfirmation: CLOUDKIT_SYNC_UPLOAD_NOW_CONFIRMATION,
        diagnostics,
      });
    }
    try {
      const readiness = getIcloudDataSyncReadiness({ platformSupported: diagnostics.icloud.platformSupported });
      const upload = await runCloudKitSyncUploadNow(readiness, { limit: normalizeCloudKitBatchLimit(req.body?.limit) || 100 });
      const pendingClear = upload.ok
        ? clearCloudKitLocalChanges("manual-upload", { type: (req as any).actor?.type || "admin", id: (req as any).actor?.id || "admin" })
        : { schedule: getCloudKitAutoSyncSchedule(), cleared: false, clearedTotal: 0 };
      insertAuditLog("icloud_cloudkit_sync_upload_now", "network", "cloudkit-sync-upload-now", {
        ok: upload.ok,
        status: upload.status,
        nextAction: upload.nextAction,
        readinessStatus: upload.export.preview.readinessStatus,
        previewStatus: upload.export.preview.status,
        readyRecordCount: upload.export.preview.readyRecordCount,
        blockedRecordCount: upload.export.preview.blockedRecordCount,
        exportRecordCount: upload.export.exportRecordCount,
        recordPlanHash: upload.export.recordPlanHash,
        syncExport: upload.result?.syncExport || null,
        backupCreated: Boolean(upload.backup),
        backupSize: upload.backup?.size || null,
        pendingLocalChangesCleared: pendingClear.cleared,
        pendingLocalChangesClearedTotal: pendingClear.clearedTotal,
        rawPayloadReturnedToAdmin: false,
        localBackupPathReturnedToAdmin: false,
      }, (req as any).actor?.type, (req as any).actor?.id);
      res.status(upload.status === "failed" || upload.status === "blocked" ? 400 : 200).json({
        upload,
        schedule: pendingClear.schedule,
        diagnostics: getAdminNetworkDiagnostics(),
      });
    } catch (error: any) {
      insertAuditLog("icloud_cloudkit_sync_upload_now_failed", "network", "cloudkit-sync-upload-now", {
        error: error?.message || "CloudKit safe upload failed",
        rawPayloadReturnedToAdmin: false,
        localBackupPathReturnedToAdmin: false,
      }, (req as any).actor?.type, (req as any).actor?.id);
      res.status(400).json({
        error: error.message || "CloudKit safe upload failed",
        diagnostics: getAdminNetworkDiagnostics(),
      });
    }
  });

  app.post("/api/v1/admin/icloud-data-sync/cycle", requireAdmin, rateLimit({ keyPrefix: "admin-cloudkit-sync-cycle", windowMs: 60_000, max: 2 }), async (req, res) => {
    const confirmation = normalizeCloudKitSyncCycleConfirmation(req.body?.confirmation);
    const diagnostics = getAdminNetworkDiagnostics();
    if (confirmation !== CLOUDKIT_SYNC_CYCLE_CONFIRMATION) {
      insertAuditLog("icloud_cloudkit_sync_cycle_blocked", "network", "cloudkit-sync-cycle", {
        confirmationProvided: false,
        rawPayloadReturnedToAdmin: false,
        serverChangeTokenReturnedToAdmin: false,
        localBackupPathReturnedToAdmin: false,
      }, (req as any).actor?.type, (req as any).actor?.id);
      return res.status(400).json({
        error: "CloudKit safe sync cycle requires explicit confirmation.",
        expectedConfirmation: CLOUDKIT_SYNC_CYCLE_CONFIRMATION,
        diagnostics,
      });
    }
    try {
      const readiness = getIcloudDataSyncReadiness({ platformSupported: diagnostics.icloud.platformSupported });
      const cycle = await runCloudKitSyncCycle(readiness, { limit: normalizeCloudKitBatchLimit(req.body?.limit) || 100 });
      const pendingClear = cycle.ok
        ? clearCloudKitLocalChanges("manual-cycle", { type: (req as any).actor?.type || "admin", id: (req as any).actor?.id || "admin" })
        : { schedule: getCloudKitAutoSyncSchedule(), cleared: false, clearedTotal: 0 };
      insertAuditLog("icloud_cloudkit_sync_cycle", "network", "cloudkit-sync-cycle", {
        ok: cycle.ok,
        status: cycle.status,
        nextAction: cycle.nextAction,
        pullStatus: cycle.pull.status,
        pullApplied: cycle.pull.apply.applied,
        pullConflicts: cycle.pull.apply.conflicts,
        uploadStatus: cycle.upload?.status || null,
        uploadExportRecordCount: cycle.upload?.export.exportRecordCount || 0,
        uploadSaved: cycle.upload?.result?.syncExport?.saved || 0,
        pendingLocalChangesCleared: pendingClear.cleared,
        pendingLocalChangesClearedTotal: pendingClear.clearedTotal,
        rawPayloadReturnedToAdmin: false,
        serverChangeTokenReturnedToAdmin: false,
        localBackupPathReturnedToAdmin: false,
      }, (req as any).actor?.type, (req as any).actor?.id);
      res.status(cycle.status === "remote-failed" || cycle.status === "remote-conflicts" || cycle.status === "upload-blocked" || cycle.status === "upload-failed" ? 400 : 200).json({
        cycle,
        schedule: pendingClear.schedule,
        diagnostics: getAdminNetworkDiagnostics(),
      });
    } catch (error: any) {
      insertAuditLog("icloud_cloudkit_sync_cycle_failed", "network", "cloudkit-sync-cycle", {
        error: error?.message || "CloudKit safe sync cycle failed",
        rawPayloadReturnedToAdmin: false,
        serverChangeTokenReturnedToAdmin: false,
        localBackupPathReturnedToAdmin: false,
      }, (req as any).actor?.type, (req as any).actor?.id);
      res.status(400).json({
        error: error.message || "CloudKit safe sync cycle failed",
        diagnostics: getAdminNetworkDiagnostics(),
      });
    }
  });

  app.get("/api/v1/admin/icloud-data-sync/auto-sync", requireAdmin, rateLimit({ keyPrefix: "admin-cloudkit-auto-sync", windowMs: 60_000, max: 20 }), (_req, res) => {
    res.json({
      schedule: getCloudKitAutoSyncSchedule(),
      diagnostics: getAdminNetworkDiagnostics(),
    });
  });

  app.put("/api/v1/admin/icloud-data-sync/auto-sync", requireAdmin, rateLimit({ keyPrefix: "admin-cloudkit-auto-sync-update", windowMs: 60_000, max: 8 }), (req, res) => {
    try {
      const schedule = updateCloudKitAutoSyncSchedule({
        enabled: Boolean(req.body?.enabled),
        intervalMinutes: Number.parseInt(String(req.body?.intervalMinutes || ""), 10),
      }, { type: (req as any).actor?.type || "admin", id: (req as any).actor?.id || "admin" });
      res.json({
        schedule,
        diagnostics: getAdminNetworkDiagnostics(),
      });
    } catch (error: any) {
      res.status(400).json({
        error: error.message || "CloudKit auto sync schedule could not be updated",
        schedule: getCloudKitAutoSyncSchedule(),
        diagnostics: getAdminNetworkDiagnostics(),
      });
    }
  });

  app.post("/api/v1/admin/icloud-data-sync/auto-sync/run-now", requireAdmin, rateLimit({ keyPrefix: "admin-cloudkit-auto-sync-run-now", windowMs: 60_000, max: 3 }), async (req, res) => {
    try {
      const result = await runCloudKitAutoSyncNow("manual", { type: (req as any).actor?.type || "admin", id: (req as any).actor?.id || "admin" });
      res.status(result.lastResult.status === "failed" ? 400 : 200).json({
        ...result,
        diagnostics: getAdminNetworkDiagnostics(),
      });
    } catch (error: any) {
      res.status(400).json({
        error: error.message || "CloudKit auto sync could not run",
        schedule: getCloudKitAutoSyncSchedule(),
        diagnostics: getAdminNetworkDiagnostics(),
      });
    }
  });

  app.post("/api/v1/admin/icloud-data-sync/sync-now", requireAdmin, rateLimit({ keyPrefix: "admin-cloudkit-sync-now", windowMs: 60_000, max: 3 }), async (req, res) => {
    const confirmation = normalizeCloudKitSyncNowConfirmation(req.body?.confirmation);
    const diagnostics = getAdminNetworkDiagnostics();
    if (confirmation !== CLOUDKIT_SYNC_NOW_CONFIRMATION) {
      insertAuditLog("icloud_cloudkit_sync_now_blocked", "network", "cloudkit-sync-now", {
        confirmationProvided: false,
        rawPayloadReturnedToAdmin: false,
        serverChangeTokenReturnedToAdmin: false,
      }, (req as any).actor?.type, (req as any).actor?.id);
      return res.status(400).json({
        error: "CloudKit safe sync now requires explicit confirmation.",
        expectedConfirmation: CLOUDKIT_SYNC_NOW_CONFIRMATION,
        quarantine: getCloudKitSyncQuarantineSummary(),
        checkpoints: listCloudKitSyncCheckpoints(),
        diagnostics,
      });
    }
    try {
      const readiness = getIcloudDataSyncReadiness({ platformSupported: diagnostics.icloud.platformSupported });
      const sync = await runCloudKitSyncNow(readiness, { limit: normalizeCloudKitBatchLimit(req.body?.limit) || 100 });
      insertAuditLog("icloud_cloudkit_sync_now", "network", "cloudkit-sync-now", {
        ok: sync.ok,
        status: sync.status,
        nextAction: sync.nextAction,
        readinessStatus: sync.changes.result.readinessStatus,
        changed: sync.changes.result.syncChangesPreview?.changed || 0,
        deleted: sync.changes.result.syncChangesPreview?.deleted || 0,
        importStatus: sync.import?.result.status || null,
        importedChanged: sync.import?.quarantine.importedChanged || 0,
        importedDeleted: sync.import?.quarantine.importedDeleted || 0,
        autoReady: sync.import?.quarantine.autoReady || 0,
        attempted: sync.apply.attempted,
        applied: sync.apply.applied,
        manualReviewRequired: sync.apply.manualReviewRequired,
        conflicts: sync.apply.conflicts,
        failed: sync.apply.failed,
        backupCount: sync.backups.length,
        rawPayloadReturnedToAdmin: false,
        serverChangeTokenReturnedToAdmin: false,
      }, (req as any).actor?.type, (req as any).actor?.id);
      res.status(sync.status === "failed" ? 400 : 200).json({
        sync,
        diagnostics: getAdminNetworkDiagnostics(),
      });
    } catch (error: any) {
      insertAuditLog("icloud_cloudkit_sync_now_failed", "network", "cloudkit-sync-now", {
        error: error?.message || "CloudKit safe sync failed",
        rawPayloadReturnedToAdmin: false,
        serverChangeTokenReturnedToAdmin: false,
      }, (req as any).actor?.type, (req as any).actor?.id);
      res.status(400).json({
        error: error.message || "CloudKit safe sync failed",
        quarantine: getCloudKitSyncQuarantineSummary(),
        checkpoints: listCloudKitSyncCheckpoints(),
        diagnostics: getAdminNetworkDiagnostics(),
      });
    }
  });

  app.get("/api/v1/admin/icloud-data-sync/quarantine", requireAdmin, rateLimit({ keyPrefix: "admin-cloudkit-sync-quarantine", windowMs: 60_000, max: 20 }), (req, res) => {
    try {
      const quarantine = listCloudKitSyncQuarantineItems({ limit: normalizeCloudKitBatchLimit(req.query.limit) || 100 });
      insertAuditLog("icloud_cloudkit_sync_quarantine_viewed", "network", "cloudkit-sync-quarantine", {
        itemCount: quarantine.items.length,
        autoReady: quarantine.summary.autoReady,
        pendingReview: quarantine.summary.pendingReview,
        conflicts: quarantine.summary.conflicts,
        rawPayloadReturnedToAdmin: false,
      }, (req as any).actor?.type, (req as any).actor?.id);
      res.json({ quarantine, diagnostics: getAdminNetworkDiagnostics() });
    } catch (error: any) {
      insertAuditLog("icloud_cloudkit_sync_quarantine_view_failed", "network", "cloudkit-sync-quarantine", {
        error: error?.message || "CloudKit sync quarantine view failed",
      }, (req as any).actor?.type, (req as any).actor?.id);
      res.status(400).json({
        error: error.message || "CloudKit sync quarantine view failed",
        quarantine: { items: [], summary: getCloudKitSyncQuarantineSummary(), checkpoints: listCloudKitSyncCheckpoints() },
        diagnostics: getAdminNetworkDiagnostics(),
      });
    }
  });

  app.get("/api/v1/admin/icloud-data-sync/device-trust", requireAdmin, rateLimit({ keyPrefix: "admin-cloudkit-device-trust", windowMs: 60_000, max: 20 }), (req, res) => {
    try {
      const deviceTrust = listCloudKitDeviceTrustMetadata({ limit: normalizeCloudKitBatchLimit(req.query.limit) || 50 });
      insertAuditLog("icloud_cloudkit_device_trust_viewed", "network", "cloudkit-device-trust", {
        itemCount: deviceTrust.items.length,
        needsRebind: deviceTrust.summary.needsRebind,
        revoked: deviceTrust.summary.revoked,
        accessGranted: deviceTrust.summary.accessGranted,
        rawCredentialReturnedToAdmin: false,
        deviceAccessGrantedFromCloudKit: false,
      }, (req as any).actor?.type, (req as any).actor?.id);
      res.json({ deviceTrust, diagnostics: getAdminNetworkDiagnostics() });
    } catch (error: any) {
      insertAuditLog("icloud_cloudkit_device_trust_view_failed", "network", "cloudkit-device-trust", {
        error: error?.message || "CloudKit device trust view failed",
      }, (req as any).actor?.type, (req as any).actor?.id);
      res.status(400).json({
        error: error.message || "CloudKit device trust view failed",
        deviceTrust: {
          items: [],
          summary: {
            total: 0,
            needsRebind: 0,
            revoked: 0,
            accessGranted: 0,
            newestAppliedAt: null,
            nextAction: "none",
            rawCredentialReturnedToAdmin: false,
            deviceAccessGrantedFromCloudKit: false,
          },
        },
        diagnostics: getAdminNetworkDiagnostics(),
      });
    }
  });

  app.post("/api/v1/admin/icloud-data-sync/apply-quarantine", requireAdmin, rateLimit({ keyPrefix: "admin-cloudkit-sync-apply-quarantine", windowMs: 60_000, max: 3 }), (req, res) => {
    const confirmation = normalizeCloudKitApplyConfirmation(req.body?.confirmation);
    const diagnostics = getAdminNetworkDiagnostics();
    if (confirmation !== CLOUDKIT_SYNC_APPLY_CONFIRMATION) {
      insertAuditLog("icloud_cloudkit_sync_apply_quarantine_blocked", "network", "cloudkit-sync-apply-quarantine", {
        confirmationProvided: false,
        rawPayloadReturnedToAdmin: false,
      }, (req as any).actor?.type, (req as any).actor?.id);
      return res.status(400).json({
        error: "CloudKit quarantine apply requires explicit confirmation.",
        expectedConfirmation: CLOUDKIT_SYNC_APPLY_CONFIRMATION,
        quarantine: listCloudKitSyncQuarantineItems({ limit: 100 }),
        diagnostics,
      });
    }
    try {
      const before = getCloudKitSyncQuarantineSummary();
      const backup = before.autoReady > 0 || before.pendingReview > 0 ? createDatabaseBackup({ prune: false }) : undefined;
      const apply = applyCloudKitSyncQuarantine({ limit: normalizeCloudKitBatchLimit(req.body?.limit) || 100, includeManualReview: true });
      insertAuditLog("icloud_cloudkit_sync_apply_quarantine", "network", "cloudkit-sync-apply-quarantine", {
        attempted: apply.attempted,
        applied: apply.applied,
        manualReviewRequired: apply.manualReviewRequired,
        conflicts: apply.conflicts,
        failed: apply.failed,
        skipped: apply.skipped,
        promotedZones: apply.promotedZones,
        blockedZones: apply.blockedZones,
        backupFile: backup?.file || null,
        backupSize: backup?.size || null,
        rawPayloadReturnedToAdmin: false,
      }, (req as any).actor?.type, (req as any).actor?.id);
      res.json({
        apply,
        backup: backup ? { file: backup.file, size: backup.size, createdAt: backup.createdAt, redaction: backup.redaction } : undefined,
        diagnostics: getAdminNetworkDiagnostics(),
      });
    } catch (error: any) {
      insertAuditLog("icloud_cloudkit_sync_apply_quarantine_failed", "network", "cloudkit-sync-apply-quarantine", {
        error: error?.message || "CloudKit sync quarantine apply failed",
        rawPayloadReturnedToAdmin: false,
      }, (req as any).actor?.type, (req as any).actor?.id);
      res.status(400).json({
        error: error.message || "CloudKit sync quarantine apply failed",
        quarantine: listCloudKitSyncQuarantineItems({ limit: 100 }),
        diagnostics: getAdminNetworkDiagnostics(),
      });
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
        cleanupRemovedEntryCount: handoff.cleanup?.removedEntryCount || 0,
        cleanupRemovedOrphanedFileCount: handoff.cleanup?.removedOrphanedFileCount || 0,
      }, (req as any).actor?.type, (req as any).actor?.id);
      res.json({
        handoff,
        diagnostics: getAdminNetworkDiagnostics(),
        message: "LifeOS mobile entry was exported to iCloud Drive.",
      });
    } catch (error: any) {
      const code = error instanceof IcloudHandoffExportError ? error.code : "icloud_handoff_export_failed";
      insertAuditLog("icloud_handoff_export_failed", "network", "icloud-handoff", {
        error: error?.message || "iCloud Handoff export failed",
        code,
      }, (req as any).actor?.type, (req as any).actor?.id);
      res.status(400).json({ error: error.message || "iCloud Handoff export failed", code, diagnostics: getAdminNetworkDiagnostics() });
    }
  });

  app.post("/api/v1/admin/icloud-handoff/cleanup", requireAdmin, (req, res) => {
    try {
      const handoff = cleanupIcloudHandoffEntries("admin-cleanup");
      insertAuditLog("icloud_handoff_cleaned", "network", "icloud-handoff", {
        removedEntryCount: handoff.cleanup.removedEntryCount,
        removedOrphanedFileCount: handoff.cleanup.removedOrphanedFileCount,
        removedFiles: handoff.cleanup.removedFiles,
        errorCount: handoff.cleanup.errorCount,
      }, (req as any).actor?.type, (req as any).actor?.id);
      res.json({
        handoff,
        diagnostics: getAdminNetworkDiagnostics(),
        message: "Old iCloud mobile entries were cleaned.",
      });
    } catch (error: any) {
      insertAuditLog("icloud_handoff_cleanup_failed", "network", "icloud-handoff", {
        error: error?.message || "iCloud Handoff cleanup failed",
      }, (req as any).actor?.type, (req as any).actor?.id);
      res.status(400).json({ error: error.message || "iCloud Handoff cleanup failed", diagnostics: getAdminNetworkDiagnostics() });
    }
  });

  app.post("/api/v1/admin/icloud-handoff/repair-packet", requireAdmin, (req, res) => {
    try {
      const analysis = analyzeIcloudHandoffRepairPacket(req.body?.packet || req.body?.text || "");
      const repairImport = saveIcloudRepairImportAnalysis(analysis, (req as any).actor || { type: "admin", id: "owner" });
      const shouldAutoRefresh = analysis.recommendations.some((item) => item.id === "refresh-icloud");
      const icloudRefresh = shouldAutoRefresh
        ? safeAutoRefreshIcloudHandoff("admin-repair-packet-import")
        : {
          refreshed: false,
          reason: "not-needed",
          requestedReason: "admin-repair-packet-import",
          status: analysis.desktop.handoffStatus,
        };
      insertAuditLog("icloud_handoff_repair_analyzed", "network", analysis.parsed.entryBaseUrl || "icloud-repair", {
        reason: analysis.reason,
        severity: analysis.severity,
        repairImportId: repairImport.id,
        phoneEntryBaseUrl: analysis.parsed.entryBaseUrl || null,
        desktopRecommendedBaseUrl: analysis.desktop.recommendedBaseUrl || null,
        recommendations: analysis.recommendations.map((item) => item.id),
        nextAction: analysis.nextAction.id,
        autoRefreshAttempted: shouldAutoRefresh,
        icloudRefresh: {
          refreshed: icloudRefresh.refreshed,
          reason: icloudRefresh.reason,
          requestedReason: icloudRefresh.requestedReason,
          status: icloudRefresh.status,
          error: "error" in icloudRefresh ? icloudRefresh.error : undefined,
        },
      }, (req as any).actor?.type, (req as any).actor?.id);
      res.json({ analysis, repairImport, icloudRefresh, diagnostics: getAdminNetworkDiagnostics() });
    } catch (error: any) {
      insertAuditLog("icloud_handoff_repair_analyze_failed", "network", "icloud-repair", {
        error: error?.message || "iCloud repair info could not be analyzed",
      }, (req as any).actor?.type, (req as any).actor?.id);
      res.status(400).json({ error: error.message || "iCloud repair info could not be analyzed", diagnostics: getAdminNetworkDiagnostics() });
    }
  });

  app.post("/api/v1/internal/icloud-handoff/refresh", rateLimit({ keyPrefix: "internal-icloud-refresh", windowMs: 60_000, max: 30 }), (req, res) => {
    if (!isLoopbackSocket(req)) {
      insertAuditLog("icloud_handoff_internal_refresh_blocked", "network", "icloud-handoff", { reason: "non_loopback_socket" }, "system", "desktop");
      return res.status(403).json({ error: "Desktop iCloud refresh is only available on this computer.", code: "local_only" });
    }
    if (!verifyDesktopInternalToken(req)) {
      insertAuditLog("icloud_handoff_internal_refresh_blocked", "network", "icloud-handoff", { reason: "invalid_desktop_token" }, "system", "desktop");
      return res.status(401).json({ error: "Desktop internal authentication required", code: "desktop_internal_auth_required" });
    }

    const reason = normalizeInternalRefreshReason(req.body?.reason || "desktop-wake");
    const result = runIcloudHandoffStartupRefresh(reason);
    const cloudKitSchedule = getCloudKitAutoSyncSchedule();
    const cloudKitReadiness = getIcloudDataSyncReadiness({ platformSupported: process.platform === "darwin" });
    const cloudKitQueued = cloudKitSchedule.enabled && cloudKitReadiness.ready;
    if (cloudKitQueued) {
      const wakeTimer = setTimeout(() => {
        runCloudKitAutoSyncNow("scheduled", { type: "system", id: `desktop-${reason}` }).catch((error) => {
          insertAuditLog("icloud_cloudkit_auto_sync_failed", "network", "cloudkit-auto-sync", {
            trigger: "desktop-wake",
            reason,
            error: error instanceof Error ? error.message : String(error),
          }, "system", `desktop-${reason}`);
        });
      }, 0);
      wakeTimer.unref?.();
    }
    insertAuditLog("icloud_handoff_internal_refreshed", "network", result.recommendedBaseUrl || "icloud-handoff", {
      reason,
      refreshed: result.refreshed,
      refreshReason: result.refreshReason,
      status: result.status,
      previousStatus: result.previousStatus || null,
      recommendedBaseUrl: result.recommendedBaseUrl || null,
      cloudKitDataSyncQueued: cloudKitQueued,
      cloudKitDataSyncReady: cloudKitReadiness.ready,
    }, "system", "desktop");
    res.json({
      ok: true,
      result,
      monitor: getIcloudHandoffMonitorStatus(),
      cloudKitDataSync: {
        queued: cloudKitQueued,
        enabled: cloudKitSchedule.enabled,
        ready: cloudKitReadiness.ready,
        status: cloudKitReadiness.status,
        nextRunAt: cloudKitSchedule.nextRunAt || null,
        rawPayloadReturned: false,
        cloudKitChangeTokenReturned: false,
      },
    });
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

  app.post("/api/v1/admin/icloud-handoff/acceptance", requireAdmin, (req, res) => {
    try {
      const diagnostics = getAdminNetworkDiagnostics();
      const icloudId = String(req.body?.id || "");
      const remoteId = icloudAcceptanceRecordIds[icloudId];
      if (!remoteId) throw new Error("Unknown iCloud acceptance item.");
      const baseUrl = diagnostics.icloud.recommendedBaseUrl
        || diagnostics.icloud.handoffHealth?.lastExportedBaseUrl
        || diagnostics.desktopRuntimeConfig?.publicBaseUrl
        || diagnostics.remoteHealthSummary.baseUrl;
      if (!baseUrl) throw new Error("Choose a Tailscale, Cloudflare, or trusted HTTPS entry before recording iCloud real-device evidence.");
      const suppliedRequirements = Array.isArray(req.body?.evidence?.requirements)
        ? req.body.evidence.requirements.map((item: unknown) => String(item || "")).filter(Boolean)
        : [];
      const record = saveRemoteAcceptanceRecord({
        id: remoteId,
        baseUrl,
        note: req.body?.note,
        proofSource: "note",
        evidence: {
          source: "admin-icloud-acceptance-checklist",
          requirements: [
            `iCloud acceptance item: ${icloudId}`,
            `Current iCloud entry: ${baseUrl}`,
            ...(icloudAcceptanceRequirements[icloudId] || []),
            ...suppliedRequirements,
          ],
        },
      }, (req as any).actor || { type: "admin", id: "owner" });
      insertAuditLog("icloud_acceptance_recorded", "network", icloudId, {
        id: icloudId,
        remoteAcceptanceId: remoteId,
        baseUrl: record.baseUrl,
        noteLength: record.note.length,
        requirements: record.evidence.requirements.length,
        createdAt: record.createdAt,
      }, (req as any).actor?.type, (req as any).actor?.id);
      res.json({ record, diagnostics: getAdminNetworkDiagnostics() });
    } catch (error: any) {
      res.status(400).json({ error: error.message || "iCloud acceptance evidence could not be recorded", diagnostics: getAdminNetworkDiagnostics() });
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
        diagnostics: getAdminNetworkDiagnostics(),
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

  app.get("/api/v1/audit-logs", requireAdmin, (req, res) => {
    const limit = Math.max(1, Math.min(1000, Number(req.query.limit) || 100));
    res.json({ logs: listAuditLogs(limit) });
  });
}
