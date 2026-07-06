import fs from "fs";
import path from "path";
import { getAiConfigStatus, listAiProviderStatuses } from "./appSecrets";
import { listAuditLogs, redactAuditMetadata, redactAuditString } from "./audit";
import { buildCalendarSyncPreview } from "./calendarSyncPreview";
import { db, getPendingRestore, listBackups } from "./db";
import { getDevices, getLatestIcloudHandoffEventByTypes, type DeviceIcloudHandoffEvent } from "./devices";
import { getIcloudHandoffMonitorStatus } from "./icloudHandoffMonitor";
import { getClientState } from "./clientState";
import { getNetworkDiagnostics } from "./networkDiagnostics";
import { getOnlineDeviceCount } from "./realtime";
import { buildRemoteAcceptanceChecklist, buildRemoteAcceptanceEvidencePack, getRemoteAcceptanceRecords, getRemoteAcceptanceRunbookRecords, summarizeRemoteAcceptanceChecklist } from "./remoteAcceptance";
import { getRemoteValidationReport, summarizeRemoteHealth } from "./remoteValidationReport";
import { getRemoteHealthEvidence, getRemoteRecoveryReport } from "./remoteHealthMonitor";
import { getSecurityDiagnostics } from "./securityDiagnostics";
import { getPackageVersion } from "./version";

function countTable(table: string) {
  return (db.prepare(`SELECT COUNT(*) as count FROM ${table}`).get() as any)?.count || 0;
}

function publicBackupRecord(backup: ReturnType<typeof listBackups>[number]) {
  return {
    file: backup.file,
    size: backup.size,
    createdAt: backup.createdAt,
  };
}

function redactedEnv() {
  const providerEnv = Object.fromEntries(
    listAiProviderStatuses().map((provider) => [`${provider.envVar}_CONFIGURED`, provider.source === "environment"]),
  );
  return {
    NODE_ENV: process.env.NODE_ENV || "",
    LIFEOS_HOST: process.env.LIFEOS_HOST || "127.0.0.1",
    LIFEOS_PORT: process.env.LIFEOS_PORT || process.env.PORT || "3000",
    PUBLIC_BASE_URL_CONFIGURED: Boolean(process.env.PUBLIC_BASE_URL || process.env.APP_URL),
    LIFEOS_ALLOW_PUBLIC: process.env.LIFEOS_ALLOW_PUBLIC === "1",
    LIFEOS_TRUST_PROXY: process.env.LIFEOS_TRUST_PROXY === "1",
    LIFEOS_COOKIE_SECURE: process.env.LIFEOS_COOKIE_SECURE === "true",
    ...providerEnv,
  };
}

function releaseDirCandidates() {
  return Array.from(new Set([
    process.env.LIFEOS_RELEASE_DIR ? path.resolve(process.env.LIFEOS_RELEASE_DIR) : "",
    path.join(process.cwd(), "release"),
    path.join(process.cwd(), "..", "release"),
  ].filter(Boolean)));
}

export function getDiagnosticBundleVersion() {
  return getPackageVersion();
}

function publicReleaseArtifactSummary(artifact: any) {
  return {
    platform: typeof artifact?.platform === "string" ? artifact.platform : "",
    fileName: artifact?.fileName ? path.basename(String(artifact.fileName)) : "",
    feedFile: artifact?.feedFile ? path.basename(String(artifact.feedFile)) : "",
    size: Number.isFinite(Number(artifact?.size)) ? Number(artifact.size) : 0,
    sha512Present: typeof artifact?.sha512 === "string" && artifact.sha512.length > 0,
    sha256: typeof artifact?.sha256 === "string" ? artifact.sha256 : "",
    releaseDate: typeof artifact?.releaseDate === "string" ? artifact.releaseDate : "",
  };
}

function summarizeAuditMetadata(metadata: unknown) {
  const redacted = redactAuditMetadata(metadata) as Record<string, unknown> | null;
  if (!redacted || typeof redacted !== "object" || Array.isArray(redacted)) return {};
  return Object.fromEntries(Object.entries(redacted).slice(0, 10).map(([key, value]) => {
    if (Array.isArray(value)) return [key, { type: "array", count: value.length }];
    if (value && typeof value === "object") return [key, { type: "object", keys: Object.keys(value as Record<string, unknown>).slice(0, 8) }];
    if (typeof value === "string") return [key, value.length > 180 ? `${value.slice(0, 177)}...` : value];
    return [key, value];
  }));
}

function diagnosticUrlScheme(value: string) {
  return value.trim().match(/^([a-zA-Z][a-zA-Z0-9+.-]*):/)?.[1]?.toLowerCase() || "";
}

function redactDiagnosticActionUrl(value: unknown) {
  const raw = typeof value === "string" ? value.trim() : "";
  const scheme = diagnosticUrlScheme(raw);
  if (!scheme) return "[invalid-url]";
  try {
    const parsed = new URL(raw);
    const query = Array.from(parsed.searchParams.keys()).slice(0, 6)
      .map((key) => `${encodeURIComponent(key)}=[redacted]`)
      .join("&");
    const redactedQuery = query ? `?${query}` : "";
    if (["tel", "sms", "mailto"].includes(scheme)) return `${scheme}:[redacted]${redactedQuery}`;
    if (scheme === "shortcuts") return `${parsed.protocol}//${parsed.host || "run-shortcut"}${redactedQuery}`;
    if (scheme === "http" || scheme === "https") return `${parsed.origin}${parsed.pathname}${redactedQuery}`;
    return `${scheme}://[redacted]${redactedQuery}`;
  } catch {
    return `${scheme}:[redacted]`;
  }
}

function redactDiagnosticActionText(value: unknown, fallback = "Unknown") {
  const raw = typeof value === "string" ? value.trim() : "";
  if (!raw) return fallback;
  const urlScheme = diagnosticUrlScheme(raw);
  const redacted = (urlScheme ? redactDiagnosticActionUrl(raw) : redactAuditString(raw))
    .replace(/\b(api[-_]?key|token|secret|password|passphrase|authorization|cookie)=\S+/gi, "$1=[redacted]")
    .slice(0, 120);
  return redacted || fallback;
}

function buildSystemActionDiagnostics() {
  const value = getClientState("lifeos_system_action_logs")?.value;
  const logs = Array.isArray(value) ? value.filter((item) => item && typeof item === "object") as Record<string, unknown>[] : [];
  const sourceCounts = new Map<string, number>();
  const summary = {
    totalLogs: logs.length,
    opened: 0,
    blocked: 0,
    cancelled: 0,
    highRisk: 0,
    totalSources: 0,
    topSource: "Unknown",
    topSourceCount: 0,
    recent: [] as Array<{
      label: string;
      scheme: string;
      status: string;
      risk: string;
      source: string;
      url: string;
    }>,
  };

  for (const log of logs) {
    const status = ["opened", "blocked", "cancelled"].includes(String(log.status)) ? String(log.status) : "unknown";
    const risk = ["low", "medium", "high"].includes(String(log.risk)) ? String(log.risk) : "unknown";
    const source = redactDiagnosticActionText(log.source);
    sourceCounts.set(source, (sourceCounts.get(source) || 0) + 1);
    if (status === "opened") summary.opened += 1;
    if (status === "blocked") summary.blocked += 1;
    if (status === "cancelled") summary.cancelled += 1;
    if (risk === "high") summary.highRisk += 1;
    if (summary.recent.length < 5) {
      summary.recent.push({
        label: redactDiagnosticActionText(log.label, "Action"),
        scheme: String(log.scheme || "").trim().toLowerCase().slice(0, 32),
        status,
        risk,
        source,
        url: redactDiagnosticActionUrl(log.url),
      });
    }
  }

  const [topSource, topSourceCount] = [...sourceCounts.entries()].sort((a, b) => b[1] - a[1])[0] || ["Unknown", 0];
  summary.totalSources = sourceCounts.size;
  summary.topSource = topSource;
  summary.topSourceCount = topSourceCount;
  return summary;
}

function publicReleaseManualReview() {
  return {
    required: true,
    items: [
      {
        id: "latest-release-label",
        labelKey: "diagnostics.releaseReview.latestLabel",
        detailKey: "diagnostics.releaseReview.latestLabelDetail",
      },
      {
        id: "old-releases-deprecated",
        labelKey: "diagnostics.releaseReview.oldReleases",
        detailKey: "diagnostics.releaseReview.oldReleasesDetail",
      },
      {
        id: "clean-download-sha256",
        labelKey: "diagnostics.releaseReview.cleanDownload",
        detailKey: "diagnostics.releaseReview.cleanDownloadDetail",
      },
      {
        id: "docker-ghcr-public",
        labelKey: "diagnostics.releaseReview.dockerPull",
        detailKey: "diagnostics.releaseReview.dockerPullDetail",
      },
      {
        id: "release-copy-current",
        labelKey: "diagnostics.releaseReview.releaseCopy",
        detailKey: "diagnostics.releaseReview.releaseCopyDetail",
      },
    ],
  };
}

function publicIcloudHandoffEvent(event: DeviceIcloudHandoffEvent | undefined) {
  if (!event) return null;
  return {
    id: event.id,
    deviceId: event.deviceId,
    deviceName: event.deviceName ? redactDiagnosticActionText(event.deviceName, "Device").slice(0, 80) : "",
    deviceType: event.deviceType || "",
    eventType: event.eventType,
    entryBaseUrl: redactDiagnosticActionUrl(event.entryBaseUrl),
    currentBaseUrl: redactDiagnosticActionUrl(event.currentBaseUrl),
    storedBaseUrl: redactDiagnosticActionUrl(event.storedBaseUrl),
    entryGeneratedAt: event.entryGeneratedAt || null,
    storedGeneratedAt: event.storedGeneratedAt || null,
    checksumPresent: Boolean(event.checksumSha256),
    checksumPrefix: event.checksumSha256 ? event.checksumSha256.slice(0, 12) : "",
    ignoredAt: event.ignoredAt,
    createdAt: event.createdAt,
  };
}

function publicIcloudFileState(file: any) {
  return {
    exists: Boolean(file?.exists),
    readable: Boolean(file?.readable),
    placeholder: Boolean(file?.placeholder),
    size: Number.isFinite(Number(file?.size)) ? Number(file.size) : 0,
    state: String(file?.state || "unknown"),
    metadata: {
      available: Boolean(file?.metadata?.available),
      downloaded: file?.metadata?.downloaded ?? null,
      downloading: file?.metadata?.downloading ?? null,
      uploaded: file?.metadata?.uploaded ?? null,
      uploading: file?.metadata?.uploading ?? null,
      syncState: String(file?.metadata?.syncState || "unknown"),
      error: file?.metadata?.error ? redactAuditString(String(file.metadata.error)).slice(0, 160) : "",
    },
  };
}

function buildIcloudDiagnosticSnapshot(network: ReturnType<typeof getNetworkDiagnostics>) {
  const latestOpenEvent = publicIcloudHandoffEvent(getLatestIcloudHandoffEventByTypes(["opened-current-entry"]));
  const latestIgnoredEvent = publicIcloudHandoffEvent(getLatestIcloudHandoffEventByTypes(["ignored-superseded-entry"]));
  const latestIssueEvent = publicIcloudHandoffEvent(getLatestIcloudHandoffEventByTypes([
    "opened-stale-entry",
    "opened-expired-entry",
    "opened-legacy-entry",
    "opened-address-mismatch-entry",
  ]));
  return {
    platformSupported: Boolean(network.icloud?.platformSupported),
    available: Boolean(network.icloud?.available),
    canExport: Boolean(network.icloud?.canExport),
    transport: network.icloud?.transport || "handoff-only",
    realtimeTransport: Boolean(network.icloud?.realtimeTransport),
    recommendedMode: network.icloud?.recommendedMode || "",
    recommendedStability: network.icloud?.recommendedStability || "",
    recommendedBaseUrl: redactDiagnosticActionUrl(network.icloud?.recommendedBaseUrl),
    handoffHealth: {
      status: network.icloud?.handoffHealth?.status || "missing",
      needsRefresh: Boolean(network.icloud?.handoffHealth?.needsRefresh),
      lastExportedAt: network.icloud?.handoffHealth?.lastExportedAt || 0,
      lastExportedBaseUrl: redactDiagnosticActionUrl(network.icloud?.handoffHealth?.lastExportedBaseUrl),
      refreshAfter: network.icloud?.handoffHealth?.refreshAfter || 0,
      expiresAt: network.icloud?.handoffHealth?.expiresAt || 0,
      checksumOk: network.icloud?.handoffHealth?.checksumOk ?? null,
      htmlConsistency: {
        status: network.icloud?.handoffHealth?.htmlConsistency?.status || "missing",
        ok: Boolean(network.icloud?.handoffHealth?.htmlConsistency?.ok),
        exists: Boolean(network.icloud?.handoffHealth?.htmlConsistency?.exists),
        generatedAt: network.icloud?.handoffHealth?.htmlConsistency?.generatedAt || 0,
      },
    },
    indexConsistency: {
      status: network.icloud?.indexConsistency?.status || "missing",
      ok: Boolean(network.icloud?.indexConsistency?.ok),
      exists: Boolean(network.icloud?.indexConsistency?.exists),
      generatedAt: network.icloud?.indexConsistency?.generatedAt || 0,
      latestEntryGeneratedAt: network.icloud?.indexConsistency?.latestEntryGeneratedAt || 0,
      expectedLatestEntryGeneratedAt: network.icloud?.indexConsistency?.expectedLatestEntryGeneratedAt || 0,
      entryCount: network.icloud?.indexConsistency?.entryCount || 0,
      expectedEntryCount: network.icloud?.indexConsistency?.expectedEntryCount || 0,
    },
    availability: {
      status: network.icloud?.availability?.status || "unsupported",
      severity: network.icloud?.availability?.severity || "warning",
      drivePathDetected: Boolean(network.icloud?.availability?.drivePathDetected),
      appFolderExists: Boolean(network.icloud?.availability?.appFolderExists),
      driveWritable: Boolean(network.icloud?.availability?.driveWritable),
      appFolderWritable: Boolean(network.icloud?.availability?.appFolderWritable),
      placeholderCount: network.icloud?.availability?.placeholderCount || 0,
      metadataPendingCount: network.icloud?.availability?.metadataPendingCount || 0,
      pendingCount: network.icloud?.availability?.pendingCount || 0,
      handoffFile: publicIcloudFileState(network.icloud?.availability?.handoffFile),
      packetFile: publicIcloudFileState(network.icloud?.availability?.packetFile),
      indexFile: publicIcloudFileState(network.icloud?.availability?.indexFile),
    },
    lifecycle: network.icloud?.lifecycle || {
      retentionLimit: 0,
      expiredGraceMs: 0,
      entryCount: 0,
      expiredEntryCount: 0,
      prunableEntryCount: 0,
      orphanedFileCount: 0,
    },
    monitor: getIcloudHandoffMonitorStatus(),
    latestEntryOpenEvent: latestOpenEvent,
    latestIgnoredEntryEvent: latestIgnoredEvent,
    latestEntryIssueEvent: latestIssueEvent,
    boundary: {
      handoffOnly: true,
      realtimeRequiresTrustedNetwork: true,
      recommendedRealtimeOptions: ["tailscale", "cloudflare-tunnel", "trusted-https"],
    },
  };
}

export function getReleaseDiagnostics() {
  for (const releaseDir of releaseDirCandidates()) {
    const manifestPath = path.join(releaseDir, "update-feed", "release-manifest.json");
    if (!fs.existsSync(manifestPath)) continue;
    try {
      const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
      const checksumPath = path.join(releaseDir, "SHA256SUMS");
      const artifacts = Array.isArray(manifest.artifacts) ? manifest.artifacts.map(publicReleaseArtifactSummary) : [];
      return {
        manifestAvailable: true,
        checksumAvailable: fs.existsSync(checksumPath),
        version: typeof manifest.version === "string" ? manifest.version : "",
        generatedAt: typeof manifest.generatedAt === "string" ? manifest.generatedAt : "",
        artifactCount: artifacts.length,
        artifacts,
        manualReview: publicReleaseManualReview(),
      };
    } catch {
      return {
        manifestAvailable: false,
        checksumAvailable: false,
        version: "",
        generatedAt: "",
        artifactCount: 0,
        artifacts: [],
        error: "release manifest is unreadable",
        manualReview: publicReleaseManualReview(),
      };
    }
  }
  return {
    manifestAvailable: false,
    checksumAvailable: false,
    version: getDiagnosticBundleVersion(),
    generatedAt: "",
    artifactCount: 0,
    artifacts: [],
    manualReview: publicReleaseManualReview(),
  };
}

export function createDiagnosticBundle() {
  const ai = getAiConfigStatus();
  const providers = listAiProviderStatuses();
  const backups = listBackups().map(publicBackupRecord);
  const pendingRestore = getPendingRestore();
  const network = getNetworkDiagnostics();
  const remoteValidationReport = getRemoteValidationReport();
  const remoteAcceptanceRecords = getRemoteAcceptanceRecords();
  const remoteAcceptanceRunbookRecords = getRemoteAcceptanceRunbookRecords();
  const remoteHealthSummary = summarizeRemoteHealth({
    baseUrl: network.desktopRuntimeConfig?.publicBaseUrl || network.remoteReadiness.baseUrl,
    readiness: network.remoteReadiness,
    report: remoteValidationReport,
  });
  const remoteAcceptanceChecklist = buildRemoteAcceptanceChecklist({
    diagnostics: network,
    health: remoteHealthSummary,
    report: remoteValidationReport,
    records: remoteAcceptanceRecords,
  });
  const remoteAcceptanceSummary = summarizeRemoteAcceptanceChecklist(remoteAcceptanceChecklist);
  const bundle = {
    generatedAt: new Date().toISOString(),
    service: {
      name: "lifeos-local-core",
      version: getDiagnosticBundleVersion(),
      uptime: process.uptime(),
      node: process.version,
      platform: process.platform,
      arch: process.arch,
    },
    environment: redactedEnv(),
    ai: {
      configured: ai.configured,
      provider: ai.provider,
      source: ai.source,
      secureStorage: ai.secureStorage,
      restartRequired: ai.restartRequired,
      updatedAt: ai.updatedAt,
      providers: providers.map((provider) => ({
        id: provider.id,
        provider: provider.provider,
        envVar: provider.envVar,
        configured: provider.configured,
        source: provider.source,
        enabled: provider.enabled,
        secureStorage: provider.secureStorage,
        restartRequired: provider.restartRequired,
        updatedAt: provider.updatedAt,
      })),
    },
    network,
    icloudHandoff: buildIcloudDiagnosticSnapshot(network),
    remote: {
      healthSummary: remoteHealthSummary,
      healthEvidence: getRemoteHealthEvidence(),
      validationReport: remoteValidationReport,
      recoveryReport: getRemoteRecoveryReport(),
      acceptanceChecklist: remoteAcceptanceChecklist,
      acceptanceSummary: remoteAcceptanceSummary,
      acceptanceEvidencePack: buildRemoteAcceptanceEvidencePack({
        checklist: remoteAcceptanceChecklist,
        summary: remoteAcceptanceSummary,
        baseUrl: network.desktopRuntimeConfig?.publicBaseUrl || remoteHealthSummary.baseUrl || network.recommendedBaseUrl,
        runbooks: remoteAcceptanceRunbookRecords,
      }),
      acceptanceRecords: {
        total: remoteAcceptanceRecords.length,
        latest: remoteAcceptanceRecords.slice(-5),
      },
      acceptanceRunbooks: {
        total: remoteAcceptanceRunbookRecords.length,
        latest: remoteAcceptanceRunbookRecords.slice(-5),
      },
    },
    security: getSecurityDiagnostics(),
    calendarSync: buildCalendarSyncPreview(),
    systemActions: buildSystemActionDiagnostics(),
    release: getReleaseDiagnostics(),
    devices: {
      total: getDevices(true).length,
      active: getDevices().length,
      online: getOnlineDeviceCount(),
    },
    database: {
      tables: {
        devices: countTable("devices"),
        bindingSessions: countTable("binding_sessions"),
        chatSessions: countTable("chat_sessions"),
        messages: countTable("messages"),
        memories: countTable("memories"),
        auditLogs: countTable("audit_logs"),
        backups: backups.length,
      },
      backups,
      pendingRestore: pendingRestore
        ? {
          restoredFrom: pendingRestore.restoredFrom,
          preRestoreBackup: publicBackupRecord(pendingRestore.preRestoreBackup),
          scheduledAt: pendingRestore.scheduledAt,
          scheduledForNextStart: pendingRestore.scheduledForNextStart,
          restartRequired: pendingRestore.restartRequired,
        }
        : null,
    },
    recentAudit: listAuditLogs(50).map((log) => ({
      id: log.id,
      actorType: log.actorType,
      action: log.action,
      targetType: log.targetType,
      targetId: log.targetId,
      metadataSummary: summarizeAuditMetadata(log.metadata),
      createdAt: log.createdAt,
    })),
  };
  return redactAuditMetadata(bundle);
}
