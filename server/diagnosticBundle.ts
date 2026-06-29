import fs from "fs";
import path from "path";
import { getAiConfigStatus, listAiProviderStatuses } from "./appSecrets";
import { listAuditLogs, redactAuditMetadata, redactAuditString } from "./audit";
import { buildCalendarSyncPreview } from "./calendarSyncPreview";
import { refreshCalendarSyncReadinessProfile } from "./calendarSyncReadiness";
import { db, getPendingRestore, listBackups } from "./db";
import { getDevices } from "./devices";
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
  const calendarSync = buildCalendarSyncPreview();
  const calendarSyncReadiness = refreshCalendarSyncReadinessProfile(
    { type: "system", id: "diagnostic-bundle" },
    { preview: calendarSync },
  );
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
    calendarSync,
    calendarSyncReadiness,
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
