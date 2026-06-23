import fs from "fs";
import path from "path";
import { getAiConfigStatus, listAiProviderStatuses } from "./appSecrets";
import { listAuditLogs, redactAuditMetadata } from "./audit";
import { db, getPendingRestore, listBackups } from "./db";
import { getDevices } from "./devices";
import { getNetworkDiagnostics } from "./networkDiagnostics";
import { getOnlineDeviceCount } from "./realtime";
import { buildRemoteAcceptanceChecklist, getRemoteAcceptanceRecords, getRemoteAcceptanceRunbookRecords, summarizeRemoteAcceptanceChecklist } from "./remoteAcceptance";
import { getRemoteValidationReport, summarizeRemoteHealth } from "./remoteValidationReport";
import { getRemoteRecoveryReport } from "./remoteHealthMonitor";
import { getSecurityDiagnostics } from "./securityDiagnostics";

let cachedPackageVersion: string | null = null;

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
  if (cachedPackageVersion) return cachedPackageVersion;
  try {
    const packageJson = JSON.parse(fs.readFileSync(path.join(process.cwd(), "package.json"), "utf8"));
    cachedPackageVersion = typeof packageJson.version === "string" && packageJson.version.trim()
      ? packageJson.version.trim()
      : "0.0.0-unknown";
  } catch {
    cachedPackageVersion = "0.0.0-unknown";
  }
  return cachedPackageVersion;
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
      validationReport: remoteValidationReport,
      recoveryReport: getRemoteRecoveryReport(),
      acceptanceChecklist: remoteAcceptanceChecklist,
      acceptanceSummary: summarizeRemoteAcceptanceChecklist(remoteAcceptanceChecklist),
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
