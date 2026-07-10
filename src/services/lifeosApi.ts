import type { CustomApp, Message } from "../types";
import type { ProblemBlueprint } from "./problemBlueprint";
import { clearDevicePrivateKey, createDeviceKeyPair, isDeviceSignatureAvailable, sha256Base64Url, signDevicePayload } from "./deviceKeyStore";
import { clearDeviceCredential, getCachedDeviceCredential, getDeviceCredentialExpiryStatus, getDeviceCredentialStorageStatus, hydrateDeviceCredential, saveDeviceCredential } from "./deviceCredentialStore";
import { clearActiveChatSessionId } from "./chatSessionStorage";
import type { DeviceCredentialExpiryStatus, StoredDeviceCredential } from "./deviceCredentialStore";

export type BoundDevice = {
  id: string;
  name: string;
  type: "mobile" | "desktop" | "browser";
  status: "online" | "offline" | "revoked";
  publicKey?: string;
  createdAt: number;
  lastSeenAt: number;
  revokedAt?: number;
  connectivityReport?: DeviceConnectivityReport | null;
  icloudHandoffEvent?: DeviceIcloudHandoffEvent | null;
};

export type DeviceConnectivityReport = {
  id: string;
  deviceId: string;
  ok: boolean;
  currentBaseUrl: string;
  healthOk: boolean;
  mobileShellOk: boolean;
  websocketOk: boolean;
  latencyMs: number;
  error?: string;
  createdAt: number;
};

export type DeviceIcloudHandoffEvent = {
  id: string;
  deviceId: string;
  deviceName?: string;
  deviceType?: BoundDevice["type"];
  eventType: "opened-current-entry" | "ignored-superseded-entry" | "opened-stale-entry" | "opened-expired-entry" | "opened-legacy-entry" | "opened-address-mismatch-entry";
  entryBaseUrl: string;
  currentBaseUrl: string;
  storedBaseUrl: string;
  entryGeneratedAt?: number;
  storedGeneratedAt?: number;
  checksumSha256?: string;
  ignoredAt: number;
  createdAt: number;
};

export type MobileConnectivityReportInput = {
  ok: boolean;
  currentBase: string;
  latencyMs: number;
  error?: string;
  steps: Array<{ id: "health" | "mobile-shell" | "websocket"; ok: boolean; url: string; latencyMs: number; status?: number; error?: string }>;
};

export type MobileIcloudHandoffEventReportInput = {
  eventType: DeviceIcloudHandoffEvent["eventType"];
  entryBaseUrl: string;
  currentBaseUrl: string;
  storedBaseUrl: string;
  entryGeneratedAt?: number;
  storedGeneratedAt?: number;
  checksumSha256?: string;
  ignoredAt?: number;
};

export type IcloudHandoffRepairAnalysis = {
  ok: true;
  reason:
    | "ready"
    | "invalid-packet"
    | "phone-entry-expired"
    | "phone-entry-stale"
    | "phone-entry-legacy"
    | "phone-entry-mismatch"
    | "desktop-entry-changed"
    | "phone-connectivity-failed"
    | "desktop-local-or-lan"
    | "temporary-entry";
  severity: "ok" | "warning" | "danger";
  parsed: {
    status: string;
    action: string;
    oneNextAction: string;
    entryBaseUrl: string;
    currentBaseUrl: string;
    mode: string;
    stability: string;
    label: string;
    generatedAt: number;
    expiresAt: number;
    lastConnectivityOk: boolean | null;
    lastConnectivityError: string;
    rawLength: number;
  };
  desktop: {
    desktopId: string;
    desktopName: string;
    recommendedBaseUrl: string;
    lastExportedBaseUrl: string;
    handoffStatus: NetworkDiagnostics["icloud"]["handoffHealth"]["status"];
    handoffNeedsRefresh: boolean;
    remoteReadiness: NetworkDiagnostics["remoteReadiness"]["status"];
    recommendedMode: string;
    recommendedStability: string;
  };
  recommendations: Array<{
    id: "refresh-icloud" | "open-latest-entry" | "regenerate-qr" | "start-tailscale" | "start-cloudflare" | "save-stable-entry" | "test-phone-entry" | "cleanup-old-entry" | "ready";
    severity: "ok" | "warning" | "danger";
    detail: string;
  }>;
  nextAction: {
    id: "refresh-icloud" | "open-latest-entry" | "regenerate-qr" | "start-tailscale" | "start-cloudflare" | "save-stable-entry" | "test-phone-entry" | "cleanup-old-entry" | "ready";
    severity: "ok" | "warning" | "danger";
    detail: string;
  };
};

export type IcloudRepairImportRecord = Omit<IcloudHandoffRepairAnalysis, "ok"> & {
  id: string;
  importedAt: number;
};

export type IcloudAutoRefreshResult = {
  refreshed: boolean;
  reason: string;
  requestedReason?: string;
  status?: string;
  previousStatus?: string;
  indexConsistencyStatus?: string;
  syncReadinessStatus?: string;
  syncReadinessAction?: string;
  generatedAt?: number;
  recommendedBaseUrl?: string;
  recommendedMode?: string;
  recommendedStability?: string;
  recommendedLabel?: string;
  changeType?: string;
  previousBaseUrl?: string;
  error?: string;
};

export type BindingSession = {
  id: string;
  token: string;
  expiresAt: number;
  baseUrl?: string;
  pairingUrl: string;
  localName: string;
  icloudRefresh?: IcloudAutoRefreshResult & {
    requestedReason: string;
    trigger?: "local-core-startup" | "desktop-wake" | "scheduled-check" | "remote-health" | "phone-entry" | "pairing-session" | "manual" | "unknown";
    status: string;
  };
};

export type { DeviceCredentialExpiryStatus, StoredDeviceCredential };

export type DeviceCredentialStorageStatus = Awaited<ReturnType<typeof getDeviceCredentialStorageStatus>>;

type IcloudMetadataSyncState = "unknown" | "synced" | "syncing" | "not-downloaded" | "not-uploaded";

type IcloudFileAvailability = {
  exists: boolean;
  readable: boolean;
  placeholder: boolean;
  placeholderPath: string;
  size: number;
  metadata: {
    available: boolean;
    downloaded: boolean | null;
    downloading: boolean | null;
    uploaded: boolean | null;
    uploading: boolean | null;
    downloadingStatus: string;
    uploadingStatus: string;
    syncState: IcloudMetadataSyncState;
    error: string;
  };
  updatedAt: number;
  placeholderUpdatedAt: number;
  syncStuck: boolean;
  state: "missing" | "ready" | "unreadable" | "placeholder";
};

export type AdminSession = {
  expiresAt: number;
  onboardingRequired?: boolean;
  nextPath?: string;
};

export type OnboardingStatus = {
  steps: Array<{
    id: "ai" | "backup" | "device" | "security";
    label: string;
    done: boolean;
    required?: boolean;
    actionPath: string;
    message: string;
  }>;
  completed: boolean;
  completedAt: number | null;
  required: boolean;
  securityOverall: "ok" | "warning" | "critical";
  nextPath: string;
};

export type ChatSession = {
  id: string;
  title: string;
  createdAt: number;
  updatedAt: number;
};

export type StoredChatMessage = {
  id: string;
  sessionId: string;
  role: "user" | "assistant" | "system" | "tool";
  contentJson: Message;
  sourceDeviceId?: string | null;
  offlineMutationId?: string | null;
  idempotencyKey?: string | null;
  clientSequence?: number | null;
  sourceVersion?: number | null;
  queuedAt?: number | null;
  createdAt: number;
};

export type ChatMessageSaveMetadata = {
  mutationId?: string;
  idempotencyKey?: string;
  clientSequence?: number;
  sourceVersion?: number;
  queuedAt?: number;
};

export type MemoryRecord = {
  id: string;
  title: string;
  content: string;
  sensitivity: "normal" | "sensitive";
  createdAt: number;
  updatedAt: number;
  deletedAt?: number;
};

export type AuditLogRecord = {
  id: string;
  actorType: string;
  actorId?: string | null;
  action: string;
  targetType?: string | null;
  targetId?: string | null;
  metadata: unknown;
  createdAt: number;
};

export type BackupRecord = {
  file: string;
  size: number;
  createdAt: number;
  redaction?: {
    appSecretsDeleted: number;
    sensitiveClientStateDeleted: number;
    adminSessionsDeleted: number;
  };
};

export type PendingRestore = {
  restoredFrom: string;
  preRestoreBackup: BackupRecord;
  scheduledAt: number;
  scheduledForNextStart: boolean;
  restartRequired: boolean;
};

export type BackupPreview = {
  backup: BackupRecord;
  tables: Record<string, number | null>;
  migrations: Array<{ version: number; name: string; appliedAt: number }>;
  sensitiveData?: {
    appSecretsRows: number;
    sensitiveClientStateRows: number;
    ordinaryBackupExcludesSecrets: boolean;
  };
  warnings: string[];
};

export type CleanupResult = {
  auditLogsDeleted: number;
  chatSessionsDeleted: number;
  messagesDeleted: number;
  backupsDeleted: number;
  protectionBackup?: BackupRecord;
  ordinaryBackupExcludesSecrets?: boolean;
};

export type BackupSchedule = {
  enabled: boolean;
  intervalHours: number;
  lastRunAt?: number;
  nextRunAt?: number;
  updatedAt?: number;
};

export type CalendarSyncPreview = {
  generatedAt: string;
  mode: "preview-only" | "connector-ready";
  externalWritesEnabled: boolean;
  writeBackSupported: boolean;
  providers: Array<{
    id: "ics-local" | "apple-calendar" | "google-calendar" | "system-reminders";
    label: string;
    configured: boolean;
    readSupported: boolean;
    writeSupported: boolean;
    requiresPermission: boolean;
    status: "ready-readonly" | "ready-write-gated" | "not-configured" | "future-connector" | "permission-needed";
    recommendations: string[];
  }>;
  operations: Array<{
    id: string;
    providerId: "ics-local" | "apple-calendar" | "google-calendar" | "system-reminders";
    providerLabel: string;
    kind: "event" | "task";
    action: "read-only-import" | "create" | "update" | "complete" | "delete";
    status: "ready" | "blocked" | "needs-review" | "executed";
    title: string;
    scheduledAt?: string;
    externalId?: string;
    source: string;
    writesExternalSystem: boolean;
    risk: "low" | "medium" | "high";
    reason: string;
  }>;
  syncPlan: {
    generatedFrom: "preview";
    canProceedAfterConsent: boolean;
    requiresManualReview: boolean;
    pullExternal: number;
    pushLocal: number;
    reviewConflicts: number;
    blocked: number;
    items: Array<{
      id: string;
      direction: "pull-external" | "push-local" | "review-conflict" | "blocked";
      providerId: "ics-local" | "apple-calendar" | "google-calendar" | "system-reminders";
      kind: "event" | "task";
      title: string;
      scheduledAt?: string;
      externalId?: string;
      operationId?: string;
      localSource?: string;
      externalSource?: string;
      reason: string;
      risk: "low" | "medium" | "high";
    }>;
  };
  safety: {
    dryRunOnly: boolean;
    requiresExplicitConsentBeforeWrite: true;
    requiresConnectorAuthBeforeWrite: true;
    requiresAuditLogBeforeWrite: true;
    requiresRollbackPlanBeforeWrite: true;
  };
  summary: {
    readOnlyItems: number;
    externalReadItems: number;
    externalReadErrors: number;
    blockedWrites: number;
    syncConflicts: number;
    providersReadyForRead: number;
    providersReadyForWrite: number;
    warnings: string[];
  };
  recommendations: string[];
};

export type CalendarSyncExecuteInput = {
  providerId?: "apple-calendar" | "google-calendar" | "system-reminders";
  kind?: "event" | "task";
  action?: "create" | "update" | "complete" | "delete";
  title?: string;
  startsAt?: string;
  dueAt?: string;
  notes?: string;
  completed?: boolean;
  calendarName?: string;
  reminderListName?: string;
  externalId?: string;
  explicitConsent?: boolean;
  confirmationText?: string;
  source?: string;
};

export type CalendarSyncExecutionResult = {
  ok: boolean;
  dryRun: boolean;
  providerId: "apple-calendar" | "google-calendar" | "system-reminders";
  action: "read-only-import" | "create" | "update" | "complete" | "delete";
  kind: "event" | "task";
  title: string;
  externalId?: string;
  executedAt: string;
  message: string;
  rollbackPlan: {
    available: boolean;
    requiresManualReview: boolean;
    hint: string;
    previousState?: {
      title?: string;
      scheduledAt?: string;
      notes?: string;
      completed?: boolean;
    };
  };
  auditSummary: {
    connector: "macos-automation" | "google-calendar-api" | "google-tasks-api" | "not-run";
    consent: boolean;
    writesExternalSystem: boolean;
  };
  historyRecord?: CalendarSyncHistoryRecord;
};

export type CalendarSyncHistoryRecord = {
  id: string;
  providerId: "apple-calendar" | "google-calendar" | "system-reminders";
  kind: "event" | "task";
  action: "create" | "update" | "complete" | "delete";
  title: string;
  externalId?: string;
  status: "executed" | "rolled_back" | "rollback_failed";
  connector: "macos-automation" | "google-calendar-api" | "google-tasks-api" | "not-run";
  source?: string;
  createdAt: number;
  rolledBackAt?: number;
  rollback: {
    available: boolean;
    requiresManualReview: boolean;
    canAutoRollback: boolean;
    reason: string;
  };
};

export type CalendarSyncRunRecord = {
  id: string;
  provider: string;
  mode: "preview" | "external-read" | "external-write" | "acceptance";
  status: "ready" | "blocked" | "needs-review" | "completed";
  startedAt: number;
  finishedAt?: number;
  summary: {
    generatedAt: string;
    previewMode: CalendarSyncPreview["mode"];
    externalWritesEnabled: boolean;
    writeBackSupported: boolean;
    operationCount: number;
    readOnlyItems: number;
    externalReadItems: number;
    blockedWrites: number;
    syncConflicts: number;
    providersReadyForRead: number;
    providersReadyForWrite: number;
    plan: {
      pullExternal: number;
      pushLocal: number;
      reviewConflicts: number;
      blocked: number;
    };
    recentHistory: {
      total: number;
      rollbackReady: number;
      rollbackNeedsManualReview: number;
      rollbackFailed: number;
    };
    twoWayEvidence: {
      externalReadVerified: boolean;
      externalWriteVerified: boolean;
      rollbackEvidenceReady: boolean;
      conflictReviewClear: boolean;
      connectorReadWriteReady: boolean;
      acceptanceReady: boolean;
      missing: string[];
    };
  };
  conflicts: Array<{
    id: string;
    kind: "duplicate" | "blocked-write" | "high-risk-write" | "rollback-review";
    providerId: string;
    itemKind: "event" | "task";
    title: string;
    risk: "low" | "medium" | "high";
    reason: string;
    operationId?: string;
    externalId?: string;
  }>;
  nextSteps: string[];
  createdByType?: string;
  createdById?: string;
};

export type NativeAutomationKind = "clipboard" | "shortcut" | "file" | "app" | "calendar" | "reminder" | "shell";

export type NativeAutomationInput = {
  kind?: NativeAutomationKind;
  title?: string;
  target?: string;
  payload?: string;
  shortcutName?: string;
  appBundleId?: string;
  source?: string;
  explicitConsent?: boolean;
  confirmationText?: string;
};

export type NativeAutomationPlan = {
  generatedAt: string;
  mode: "disabled" | "guarded" | "mock";
  kind: NativeAutomationKind;
  actionId: string;
  status: "ready" | "blocked";
  canExecute: boolean;
  supportedNow: boolean;
  risk: "low" | "medium" | "high";
  commandPreview: string[];
  title: string;
  sanitizedTarget: string;
  sanitizedSource: string;
  payloadPreview: string;
  writesExternalSystem: boolean;
  requirements: string[];
  blockedReasons: string[];
  safety: {
    bridgeEnabled: boolean;
    mockMode: boolean;
    allowlisted: boolean;
    platformSupported: boolean;
    explicitConsent: boolean;
    confirmationAccepted: boolean;
    auditRequired: true;
    sensitivePayloadBlocked: boolean;
    payloadWithinLimit: boolean;
    targetWithinAllowedRoots: boolean;
  };
};

export type NativeAutomationExecutionResult = {
  ok: boolean;
  dryRun: boolean;
  executedAt: string;
  message: string;
  plan: NativeAutomationPlan;
  auditSummary: {
    actionId: string;
    kind: NativeAutomationKind;
    consent: boolean;
    writesExternalSystem: boolean;
    connector: "native-automation-bridge";
  };
  commandResult?: {
    exitCode: number | null;
    stdout: string;
    stderr: string;
    timedOut: boolean;
  };
};

export type ReleaseUpdateCheck = {
  checkedAt: string;
  status: "up-to-date" | "update-available" | "unavailable" | "error";
  current: {
    version: string;
    tag: string;
  };
  latest: {
    version: string;
    tag: string;
    name: string;
    url: string;
    prerelease: boolean;
    publishedAt: string;
    assetCount: number;
    assets: Array<{
      name: string;
      size: number;
      downloadUrl: string;
    }>;
    checksumAsset?: {
      name: string;
      size: number;
      downloadUrl: string;
    };
  } | null;
  updateAvailable: boolean;
  manualUpdateRequired: boolean;
  autoUpdateEnabled: boolean;
  autoUpdate: {
    configured: boolean;
    enabled: boolean;
    mode: "manual" | "feed-ready" | "blocked";
    feedUrl: string | null;
    updateUrlHost: string;
    reason: "not_configured" | "opt_in_required" | "ready" | "non_https" | "url_contains_credentials_or_tokens" | "url_points_to_artifact" | "invalid_url";
    requirements: string[];
  };
  manualUpdatePlan: {
    platform: "macos" | "windows" | "linux" | "unknown";
    assetName: string | null;
    assetUrl: string | null;
    checksumUrl: string | null;
    checksumCommand: string;
    installCommand: string;
    backupRequired: true;
    sha256Required: true;
    autoUpdateBlockedReason: string;
    steps: Array<{
      id: "backup" | "download" | "checksum" | "install" | "restart";
      label: string;
      required: boolean;
      command?: string;
      url?: string;
    }>;
  } | null;
  reason: string;
  recommendations: string[];
};

export type ConfigDiagnostics = {
  ai: {
    configured: boolean;
    id?: AiProviderId;
    provider: string;
    envVar: string;
    source: "environment" | "system_secure_store" | "encrypted_store" | "missing";
    enabled?: boolean;
    models?: string[];
    defaultModel?: string;
    selectedModel?: string;
    secureStorage?: {
      preferred: "electron_safe_storage" | "local_aes_gcm";
      current?: "electron_safe_storage" | "local_aes_gcm";
      label: string;
      systemAvailable: boolean;
      systemName?: string;
      fallbackLabel?: string;
      fallbackActive?: boolean;
      migrationRecommended?: boolean;
    };
    restartRequired: boolean;
    updatedAt?: number;
    recommendations: string[];
  };
  network: {
    host: string;
    publicBaseUrl: string;
    publicAccessAllowed: boolean;
    publicAccessWarning: boolean;
    recommendations: string[];
  };
  storage: {
    dataDir: string;
    dataDirConfigured: boolean;
    backupRetentionCount: string;
    backupSchedule: {
      enabled: boolean;
      intervalHours: number;
      nextRunAt?: number;
    };
    recommendations: string[];
  };
  release: {
    manifestAvailable: boolean;
    checksumAvailable: boolean;
    version: string;
    generatedAt: string;
    artifactCount: number;
    artifacts: Array<{
      platform: string;
      fileName: string;
      feedFile: string;
      size: number;
      sha512Present: boolean;
      sha256: string;
      releaseDate: string;
    }>;
    manualReview: {
      required: boolean;
      items: Array<{
        id: string;
        labelKey: string;
        detailKey: string;
      }>;
    };
    recommendations: string[];
  };
  calendarSync: CalendarSyncPreview;
  securityCheck: {
    publicMode: boolean;
    overall: "ok" | "warning" | "critical";
    items: Array<{
      id: string;
      label: string;
      status: "ok" | "warning" | "critical";
      message: string;
      action: string;
    }>;
  };
};

export type AiProviderId = string;
export type AiProviderStatus = ConfigDiagnostics["ai"] & {
  id: AiProviderId;
  enabled: boolean;
  active: boolean;
};

export type NetworkDiagnostics = {
  host: string;
  port: string;
  publicBaseUrl: string;
  publicAccessAllowed: boolean;
  lanUrls: string[];
  lanEnvTemplate: string;
  recommendedBaseUrl: string;
  remoteReadiness: {
    status: "ready" | "needs-restart" | "temporary" | "local-only" | "lan-only" | "blocked";
    severity: "ok" | "warning" | "danger";
    candidateId: string;
    baseUrl: string;
    blockers: Array<{ id: "noRemoteEntry" | "localOnly" | "lanOnly" | "needsHttps" | "needsPublicOptIn" | "needsRestart" | "temporaryTunnel" | "ready"; detail?: string }>;
    actions: Array<{ id: "noRemoteEntry" | "localOnly" | "lanOnly" | "needsHttps" | "needsPublicOptIn" | "needsRestart" | "temporaryTunnel" | "ready"; detail?: string }>;
  };
  connectionCandidates: Array<{
    id: string;
    label: string;
    baseUrl: string;
    mode: "configured" | "cloudflare" | "tailscale" | "lan" | "local";
    priority: number;
    requiresRestart: boolean;
    stability: "stable" | "temporary" | "local";
    secure: boolean;
    envTemplate: string;
    restartInstruction: string;
    mobilePairUrl: string;
    mobileChatUrl: string;
    notes: string[];
  }>;
  desktopRuntimeConfig: {
    mode: "configured" | "cloudflare" | "tailscale" | "lan" | "local";
    label: string;
    host: "127.0.0.1" | "0.0.0.0";
    port: number;
    publicBaseUrl: string;
    allowPublic: boolean;
    baseUrl: string;
    updatedAt: number;
  } | null;
  icloud: {
    platform: string;
    platformSupported: boolean;
    available: boolean;
    canExport: boolean;
    desktopId: string;
    desktopName: string;
    desktopSlug: string;
    drivePath: string;
    appFolderPath: string;
    handoffFilePath: string;
    packetFilePath: string;
    indexFilePath: string;
    historyFilePath: string;
    availableEntries: Array<{
      desktopId: string;
      desktopName: string;
      desktopSlug: string;
      fileName: string;
      htmlFileName: string;
      packetFileName: string;
      label: string;
      baseUrl: string;
      mode: string;
      stability: string;
      secure: boolean;
      generatedAt: number;
      refreshAfter: number;
      expiresAt: number;
      entryChecksumSha256: string;
    }>;
    entryHistory: Array<{
      desktopId: string;
      desktopName: string;
      reason: string;
      changeType: "first-export" | "public-base-url-changed" | "cloudflare-address-changed" | "tailscale-address-changed" | "lan-address-changed" | "address-changed" | "fallback-candidates-changed" | "refreshed-same-address" | string;
      previousBaseUrl: string;
      previousCandidateId: string;
      previousMode: string;
      previousStability: string;
      previousGeneratedAt: number;
      previousEntryChecksumSha256: string;
      previousFallbackCandidateCount: number;
      baseUrl: string;
      candidateId: string;
      mode: string;
      stability: string;
      fallbackCandidateCount: number;
      generatedAt: number;
      entryChecksumSha256: string;
      htmlFileName: string;
      packetFileName: string;
    }>;
    lifecycle: {
      retentionLimit: number;
      expiredGraceMs: number;
      entryCount: number;
      expiredEntryCount: number;
      prunableEntryCount: number;
      orphanedFileCount: number;
    };
    recommendedBaseUrl: string;
    recommendedLabel: string;
    recommendedMode: string;
    recommendedStability: string;
    handoffHealth: {
      status: "missing" | "fresh" | "stale" | "address-changed" | "expired" | "invalid" | "legacy" | "html-mismatch";
      needsRefresh: boolean;
      lastExportedAt: number;
      lastExportedBaseUrl: string;
      refreshAfter: number;
      expiresAt: number;
      refreshAfterMs: number;
      expiresAfterMs: number;
      checksumOk: boolean | null;
      entryChecksumSha256: string;
      expectedChecksumSha256: string;
      htmlConsistency: {
        status: "missing" | "legacy" | "mismatch" | "matching";
        ok: boolean;
        exists: boolean;
        checksumSha256: string;
        generatedAt: number;
        reason: string;
      };
      reason: string;
    };
    indexConsistency: {
      status: "missing" | "legacy" | "mismatch" | "matching";
      ok: boolean;
      exists: boolean;
      checksumSha256: string;
      expectedChecksumSha256: string;
      generatedAt: number;
      latestEntryGeneratedAt: number;
      expectedLatestEntryGeneratedAt: number;
      entryCount: number;
      expectedEntryCount: number;
      writerDesktopId: string;
      reason: string;
    };
    availability: {
      status: "unsupported" | "account-unavailable" | "missing" | "read-only" | "sync-service-unavailable" | "sync-stuck" | "sync-pending" | "ready";
      severity: "ok" | "warning" | "danger";
      drivePathDetected: boolean;
      appFolderExists: boolean;
      driveWritable: boolean;
      appFolderWritable: boolean;
      placeholderCount: number;
      metadataPendingCount: number;
      pendingCount: number;
      placeholderStuckCount: number;
      metadataStuckCount: number;
      syncStuckCount: number;
      syncStuckAfterMs: number;
      placeholderSamples: string[];
      account: {
        checked: boolean;
        status: "unchecked" | "ready" | "signed-out" | "drive-disabled" | "unknown";
        signedIn: boolean | null;
        driveEnabled: boolean | null;
        source: "unsupported" | "override" | "defaults" | "unavailable";
        error: string;
      };
      syncService: {
        checked: boolean;
        running: boolean;
        processNames: string[];
        error: string;
      };
      handoffFile: IcloudFileAvailability;
      packetFile: IcloudFileAvailability;
      indexFile: IcloudFileAvailability;
    };
    syncReadiness: {
      status: "unsupported" | "missing-drive" | "read-only" | "no-entry" | "needs-refresh" | "sync-stuck" | "syncing" | "ready";
      severity: "ok" | "warning" | "danger";
      canOpenOnPhone: boolean;
      action: "use-apple-device" | "enable-icloud-drive" | "fix-permissions" | "export-entry" | "refresh-entry" | "fix-icloud-sync" | "wait-for-sync" | "open-files-app";
      userStep: {
        id: "use-apple-device" | "enable-icloud-drive" | "fix-permissions" | "create-phone-entry" | "refresh-phone-entry" | "repair-icloud-sync" | "waiting-for-icloud-sync" | "open-phone-files-app";
        primaryAction: "use-qr-or-tunnel" | "open-icloud-settings" | "export-icloud-entry" | "refresh-icloud-entry" | "wait" | "open-files-app";
        titleKey: string;
        bodyKey: string;
        severity: "ok" | "warning" | "danger";
        pendingCount: number;
        pendingFiles: Array<"html" | "packet" | "index">;
        missingFiles: Array<"html" | "packet" | "index">;
        humanRecovery: {
          titleKey: string;
          bodyKey: string;
          primaryCtaKey: string;
          afterKey: string;
          tipKey: string;
          desktopAction: "use-qr-or-tunnel" | "open-icloud-settings" | "export-icloud-entry" | "refresh-icloud-entry" | "wait" | "none";
          phoneAction: "none" | "open-files-app-after-sync" | "open-latest-entry" | "open-files-app";
          showTechnicalDetails: boolean;
          severity: "ok" | "warning" | "danger";
        };
      };
      pendingCount: number;
      pendingFiles: Array<"html" | "packet" | "index">;
      missingFiles: Array<"html" | "packet" | "index">;
      htmlFileState: IcloudFileAvailability["state"];
      packetFileState: IcloudFileAvailability["state"];
      indexFileState: IcloudFileAvailability["state"];
    };
    dataSync: {
      enabled: boolean;
      ready: boolean;
      mode: "handoff-only" | "cloudkit-native";
      status: "not-enabled" | "missing-apple-platform" | "missing-container" | "missing-apple-identity" | "missing-native-helper" | "missing-entitlements" | "no-data-types" | "ready-to-test";
      severity: "ok" | "warning" | "danger";
      dataSyncScope: "entry-file-only" | "cloudkit-native-candidate";
      containerId: string;
      teamIdConfigured: boolean;
      bundleId: string;
      nativeHelper: {
        configured: boolean;
        detected: boolean;
        executable: boolean;
      };
      entitlements: {
        detected: boolean;
        mentionsCloudKit: boolean;
        mentionsContainer: boolean;
      };
      selectedDataTypes: string[];
      blockedDataTypes: string[];
      blockedDataTypePolicy: string;
      notSyncedDataTypes: string[];
      credentialBoundary: {
        policy: string;
        safeDataType: string;
        safeFields: string[];
        neverSyncedFields: string[];
        importedDeviceAction: string;
        phoneRecoveryAction: string;
        userFacingSummary: string;
      };
      recordPlan: Array<{
        dataType: string;
        zone: string;
        recordTypes: string[];
        safeFields: string[];
        forbiddenFields: string[];
        forbiddenFieldCount?: number;
        mutationModel: string;
        conflictPolicy: string;
        requiresUserReview: boolean;
      }>;
      requiredNativeCapabilities: string[];
      nativeHelperContract: {
        protocolVersion: number;
        transport: string;
        requestSchema: string;
        responseSchema: string;
        operations: string[];
        commandArgs: string[];
        timeoutMs: number;
      };
      acceptanceGates: Array<{
        id: string;
        status: "passed" | "blocked" | "manual-required";
        detail: string;
      }>;
      requiresNativeAppleClient: boolean;
      requiresCloudKitContainer: boolean;
      requiresExplicitUserOptIn: boolean;
      nextAction: string;
    };
    phoneConfirmation: {
      status: "missing" | "confirmed" | "stale" | "issue-after-confirm";
      severity: "ok" | "warning" | "danger";
      action: "none" | "open-on-phone" | "refresh-entry";
      confirmedAt: number;
      confirmedDeviceId: string;
      confirmedDeviceName: string;
      confirmedDeviceType: string;
      confirmedEntryBaseUrl: string;
      confirmedEntryGeneratedAt: number;
      expectedEntryGeneratedAt: number;
      expectedBaseUrl: string;
      latestProblemAt: number;
      latestProblemEventType: string;
      latestProblemDeviceName: string;
      reason: string;
    };
    pairingSession: {
      status: "missing" | "ready" | "expiring-soon" | "expired" | "address-changed" | "confirmed";
      severity: "ok" | "warning" | "danger";
      action: "none" | "create-qr" | "use-current-qr" | "regenerate-qr";
      bindingId: string;
      baseUrl: string;
      expectedBaseUrl: string;
      createdAt: number;
      expiresAt: number;
      confirmedAt: number;
      confirmedDeviceId: string;
      expired: boolean;
      secondsRemaining: number;
      reason: string;
    };
    realtimeTransport: false;
    transport: "handoff-only";
    openInstruction: string;
    notes: string[];
    latestEntryOpenEvent?: DeviceIcloudHandoffEvent | null;
    latestIgnoredEntryEvent?: DeviceIcloudHandoffEvent | null;
    latestEntryIssueEvent?: DeviceIcloudHandoffEvent | null;
    latestEntryRepair?: {
      status: "none" | "current-entry-opened" | "old-entry-opened" | "problem-entry-opened" | "needs-refresh";
      severity: "ok" | "warning" | "danger";
      action: "none" | "open-on-phone" | "refresh-icloud" | "refresh-and-regenerate-qr";
      eventId: string;
      eventType: DeviceIcloudHandoffEvent["eventType"] | string;
      deviceId: string;
      deviceName: string;
      deviceType: string;
      eventAt: number;
      entryBaseUrl: string;
      currentBaseUrl: string;
      storedBaseUrl: string;
      recommendedBaseUrl: string;
      lastExportedBaseUrl: string;
      entryGeneratedAt: number;
      storedGeneratedAt: number;
      checksumPresent: boolean;
      needsRefresh: boolean;
      needsQr: boolean;
      reason: string;
    };
    latestRepairImport?: IcloudRepairImportRecord | null;
    acceptance?: {
      ready: boolean;
      generatedAt: number;
      passed: number;
      total: number;
      needsAction: number;
      manualRequired: number;
      recommendedAction: "export-icloud-entry" | "open-on-phone" | "regenerate-qr" | "choose-live-network-entry" | "record-real-world-check" | "ready";
      nextItemId?: "icloud-entry-synced" | "phone-opened-current-entry" | "pairing-qr-current" | "realtime-entry-ready" | "cellular-mobile-chat" | "restart-restore" | "network-switch" | "network-interruption" | "old-entry-repair";
      nextManualItemId?: "icloud-entry-synced" | "phone-opened-current-entry" | "pairing-qr-current" | "realtime-entry-ready" | "cellular-mobile-chat" | "restart-restore" | "network-switch" | "network-interruption" | "old-entry-repair";
      nextReviewAt?: number;
      items: Array<{
        id: "icloud-entry-synced" | "phone-opened-current-entry" | "pairing-qr-current" | "realtime-entry-ready" | "cellular-mobile-chat" | "restart-restore" | "network-switch" | "network-interruption" | "old-entry-repair";
        status: "passed" | "needs-action" | "manual-required";
        severity: "ok" | "warning" | "danger";
        evidence: string;
        action: "export-icloud-entry" | "open-on-phone" | "regenerate-qr" | "choose-live-network-entry" | "record-real-world-check" | "ready";
        acceptedAt?: number;
        expiresAt?: number;
      }>;
    };
  };
  remoteValidationReport: {
    id: string;
    label: string;
    baseUrl: string;
    url: string;
    ok: boolean;
    status: number;
    latencyMs: number;
    passed: number;
    total: number;
    createdAt: number;
    error?: string;
    httpsStatus?: {
      ok: boolean;
      protocol: string;
      requiredForLongTerm: boolean;
      trustedByRuntime: boolean;
      error?: string;
    };
    steps: Array<{
      id: string;
      ok: boolean;
      status: number;
      url: string;
      latencyMs: number;
      error?: string;
    }>;
  } | null;
  remoteHealthSummary: {
    status: "healthy" | "unchecked" | "failing" | "stale" | "temporary" | "insecure" | "missing" | "qr-warning";
    severity: "ok" | "warning" | "danger";
    entryKind: "missing" | "temporary-cloudflare" | "tailscale" | "stable-https" | "insecure-http" | "custom";
    baseUrl: string;
    lastCheckedAt: number | null;
    ageMs: number | null;
    recommendations: Array<
      | "save-long-term-entry"
      | "run-remote-health"
      | "replace-temporary-tunnel"
      | "use-https"
      | "refresh-stale-check"
      | "fix-health-check"
      | "fix-mobile-shell"
      | "fix-websocket"
      | "refresh-pairing-qr"
      | "ready"
    >;
    checks: Array<{
      id: "https" | "health" | "mobile-shell" | "websocket" | "qr-entry";
      status: "ok" | "warning" | "fail" | "unknown";
      detail?: string;
    }>;
  };
  remoteHealthMonitor: {
    enabled: boolean;
    running: boolean;
    inFlight: boolean;
    intervalMs: number;
    startedAt: number | null;
    lastRunAt: number | null;
    nextRunAt: number | null;
  };
  icloudMonitor: {
    enabled: boolean;
    running: boolean;
    intervalMs: number;
    startedAt: number | null;
    lastRunAt: number | null;
    nextRunAt: number | null;
    startupRunAt: number | null;
    startupRunReason: string | null;
    startupResult: {
      reason: string;
      requestedReason?: string;
      trigger?: "local-core-startup" | "desktop-wake" | "scheduled-check" | "remote-health" | "phone-entry" | "pairing-session" | "manual" | "unknown";
      checkedAt: number;
      refreshed: boolean;
      refreshReason: string;
      status: string;
      previousStatus?: string;
      indexConsistencyStatus?: string;
      previousIndexConsistencyStatus?: string;
      syncReadinessStatus?: string;
      syncReadinessAction?: string;
      phoneConfirmationStatus?: string;
      phoneConfirmationAction?: string;
      previousPhoneConfirmationStatus?: string;
      pairingSessionStatus?: string;
      pairingSessionAction?: string;
      previousPairingSessionStatus?: string;
      generatedAt?: number;
      recommendedBaseUrl?: string;
      changeType?: string;
      previousBaseUrl?: string;
      error?: string;
    } | null;
    lastResult: {
      reason: string;
      requestedReason?: string;
      trigger?: "local-core-startup" | "desktop-wake" | "scheduled-check" | "remote-health" | "phone-entry" | "pairing-session" | "manual" | "unknown";
      checkedAt: number;
      refreshed: boolean;
      refreshReason: string;
      status: string;
      previousStatus?: string;
      indexConsistencyStatus?: string;
      previousIndexConsistencyStatus?: string;
      syncReadinessStatus?: string;
      syncReadinessAction?: string;
      phoneConfirmationStatus?: string;
      phoneConfirmationAction?: string;
      previousPhoneConfirmationStatus?: string;
      pairingSessionStatus?: string;
      pairingSessionAction?: string;
      previousPairingSessionStatus?: string;
      generatedAt?: number;
      recommendedBaseUrl?: string;
      changeType?: string;
      previousBaseUrl?: string;
      error?: string;
    } | null;
  };
  remoteHealthEvidence: {
    total: number;
    passed: number;
    failed: number;
    recoveryAttempts: number;
    recoveryRestored: number;
    latestOk: boolean | null;
    firstCheckedAt: number | null;
    lastCheckedAt: number | null;
    observedMinutes: number;
    consecutiveOk: number;
    consecutiveFailures: number;
    longRunReady: boolean;
    latest: Array<{
      id: string;
      reason: string;
      baseUrl: string;
      ok: boolean;
      passed: number;
      total: number;
      latencyMs: number;
      failedStepIds: string[];
      recoveryAttempted: boolean;
      recoveryRestored: boolean;
      recoveryAction: "none" | "run-remote-health" | "check-tailscale" | "check-cloudflare" | "check-tunnel-target";
      createdAt: number;
    }>;
  };
  remoteRecoveryReport: {
    id: string;
    reason: string;
    mode: "cloudflare" | "tailscale" | "configured" | "unknown";
    baseUrl: string;
    restoredBaseUrl: string;
    attempted: boolean;
    restored: boolean;
    started: boolean;
    recoveryReason: string;
    recoveryAction: "none" | "run-remote-health" | "check-tailscale" | "check-cloudflare" | "check-tunnel-target";
    error?: string;
    healthOkBefore: boolean;
    healthOkAfter: boolean;
    createdAt: number;
  } | null;
  remoteAcceptanceChecklist: Array<{
    id: "tailscale-https-serve" | "cloudflare-named-tunnel" | "remote-smoke" | "restart-restore" | "cellular-mobile-chat" | "network-switch" | "stale-qr-repair" | "network-interruption" | "diagnostic-export" | "ci-remote-mock";
    status: "passed" | "needs-action" | "manual-required";
    evidence: string;
    action: string;
    command?: string;
    acceptedAt?: number;
    expiresAt?: number;
  }>;
  remoteAcceptanceSummary: {
    ready: boolean;
    passed: number;
    total: number;
    needsAction: number;
    manualRequired: number;
    hasLongTermEntry: boolean;
    hasRealWorldEvidence: boolean;
    blockingItems: Array<{
      id: "tailscale-https-serve" | "cloudflare-named-tunnel" | "remote-smoke" | "restart-restore" | "cellular-mobile-chat" | "network-switch" | "stale-qr-repair" | "network-interruption" | "diagnostic-export" | "ci-remote-mock";
      status: "needs-action" | "manual-required";
      action: string;
      command?: string;
    }>;
  };
  remoteAcceptanceEvidencePack: {
    ready: boolean;
    generatedAt: number;
    baseUrl: string;
    longTermEntryReady: boolean;
    automatedReady: boolean;
    realWorldReady: boolean;
    realWorldPassed: number;
    realWorldTotal: number;
    missingCount: number;
    expiredCount: number;
    missingRealWorldIds: Array<NetworkDiagnostics["remoteAcceptanceChecklist"][number]["id"]>;
    expiredRealWorldIds: Array<NetworkDiagnostics["remoteAcceptanceChecklist"][number]["id"]>;
    nextReviewAt?: number;
    latestAcceptedAt?: number;
    latestRunbookImportedAt?: number;
    recommendedAction: "save-long-term-entry" | "run-remote-smoke" | "complete-real-world-checks" | "refresh-expired-evidence" | "export-diagnostics" | "ready";
    priorityTasks: Array<{
      id: NetworkDiagnostics["remoteAcceptanceChecklist"][number]["id"] | "long-term-entry";
      priority: "critical" | "high" | "normal";
      status: "blocked" | "missing" | "expired";
      titleKey: string;
      bodyKey: string;
      command?: string;
    }>;
    scenarioMatrix: Array<{
      id: NetworkDiagnostics["remoteAcceptanceChecklist"][number]["id"];
      status: "passed" | "missing" | "expired";
      titleKey: string;
      proofKey: string;
      evidence: string;
      nextAction: "record-evidence" | "refresh-evidence" | "keep-record";
      acceptedAt?: number;
      expiresAt?: number;
      ageDays?: number;
    }>;
    coverage: Array<{
      id: NetworkDiagnostics["remoteAcceptanceChecklist"][number]["id"];
      status: "passed" | "needs-action" | "manual-required";
      acceptedAt?: number;
      expiresAt?: number;
      evidence: string;
    }>;
  };
  remoteAcceptanceRunbooks: {
    total: number;
    latest: Array<{
      id: string;
      baseUrl: string;
      entryKind: "temporary-cloudflare" | "tailscale-https" | "local" | "stable-https" | "insecure-http";
      longTermReady: boolean;
      longTermReason: string;
      realWorldAcceptanceRequired: boolean;
      completionStatus: "ready" | "automated-ready-manual-required" | "not-ready";
      generatedAt: string;
      importedAt: number;
      automatedChecks: {
        ok: boolean;
        passed: number;
        total: number;
        latencyMs: number;
        httpsStatus?: {
          ok: boolean;
          protocol: string;
          requiredForLongTerm: boolean;
          trustedByRuntime: boolean;
          error?: string;
        };
      };
      manualAcceptance: Array<{ id: string; title: string; required: boolean }>;
    }>;
  };
  latestBindingSession: {
    id: string;
    baseUrl: string | null;
    expiresAt: number;
    confirmedAt: number | null;
    expired: boolean;
  } | null;
  cloudflare: {
    installed: boolean;
    running: boolean;
    managed: {
      running: boolean;
      starting: boolean;
      url: string;
      pid: number | null;
      startedAt: number | null;
      command: string;
      lastOutput: string;
      lastError: string;
      kind: "quick" | "named" | "";
      reconnectAttempts: number;
      lastReconnectAt: number | null;
      reconnectScheduledAt: number | null;
      reconnectReason: string;
    };
    version: string;
    detectedUrls: string[];
    suggestedCommand: string;
    installCommand: string;
    installUrl: string;
    envTemplate: string;
    notes: string[];
  };
  cloudflareNamedTunnel: {
    configured: boolean;
    ready: boolean;
    configPath: string;
    configExists: boolean;
    credentialsFileExists: boolean;
    name: string;
    hostname: string;
    credentialsFile: string;
    baseUrl: string;
    command: string;
    configPreview: string;
    notes: string[];
  };
  tailscale: {
    installed: boolean;
    online: boolean;
    loginCommand: string;
    version: string;
    deviceName: string;
    tailnetName: string;
    magicDnsEnabled: boolean;
    urls: string[];
    magicDnsUrls: string[];
    httpsServeUrl: string;
    httpsServeReady: boolean;
    serveRunning: boolean;
    serveCommand: string;
    serveStatus: string;
    mobileUrls: string[];
    installCommand: string;
    installUrl: string;
    autoInstall: {
      available: boolean;
      method: "homebrew-cask" | "manual";
      command: string;
      reason: "already-installed" | "terminal-password-required" | "homebrew-missing" | "unsupported-platform";
    };
    envTemplate: string;
    notes: string[];
  };
  safety: {
    publicModeRequired: boolean;
    requiresHttpsForInternet: boolean;
    notes: string[];
  };
};

export type CloudKitNativeHelperResult = {
  ok: boolean;
  status: "passed" | "failed" | "skipped";
  operation: "probe" | "roundtrip" | "subscription-probe" | "sync-export" | "sync-import-preview" | "sync-changes-preview" | "sync-import-quarantine";
  checkedAt: string;
  readinessStatus: string;
  reason?: string;
  requestHash?: string;
  helperProtocol?: {
    protocolVersion: number;
    transport: string;
    requestSchema: string;
    responseSchema: string;
    operations: Array<"probe" | "roundtrip" | "subscription-probe" | "sync-export" | "sync-import-preview" | "sync-changes-preview" | "sync-import-quarantine">;
    commandArgs: string[];
    timeoutMs: number;
  };
  evidenceId?: string;
  accountStatus?: string;
  containerReachable?: boolean;
  capabilitiesVerified?: string[];
  requiredNativeCapabilities?: string[];
  missingNativeCapabilities?: string[];
  nativeCapabilityCoverageOk?: boolean;
  requiredOperationCapabilities?: string[];
  missingOperationCapabilities?: string[];
  operationCapabilityCoverageOk?: boolean;
  roundtrip?: {
    created: boolean;
    fetched: boolean;
    deleted: boolean;
    recordType: string;
    zone: string;
  };
  subscriptionProbe?: {
    subscriptionId: string;
    exists: boolean;
    saved: boolean;
    contentAvailable: boolean;
  };
  syncExport?: {
    attempted: number;
    saved: number;
    created: number;
    updated: number;
    unchanged: number;
    conflicts: number;
    failed: number;
    recordPlanHash: string;
    zones: string[];
    recordTypes: string[];
  };
  syncImportPreview?: {
    scannedZones: string[];
    scannedRecordTypes: string[];
    fetched: number;
    failed: number;
    truncated: boolean;
    records: Array<{
      zone: string;
      recordType: string;
      recordName: string;
      lifeosSchema: string;
      lifeosDataType: string;
      sourceIdHash: string;
      mutationId: string;
      contentHash: string;
      logicalClock: number;
      payloadByteSize: number;
      modifiedAt: string;
      requiresUserReview: boolean;
    }>;
  };
  syncChangesPreview?: {
    scannedZones: string[];
    changed: number;
    deleted: number;
    failed: number;
    moreComing: boolean;
    rawPayloadIncluded: boolean;
    zones: Array<{
      zone: string;
      previousServerChangeTokenPresent: boolean;
      serverChangeTokenCaptured: boolean;
      changed: number;
      deleted: number;
      failed: number;
      moreComing: boolean;
      pagesFetched: number;
    }>;
    changedRecords: Array<{
      zone: string;
      recordType: string;
      recordName: string;
      lifeosSchema: string;
      lifeosDataType: string;
      sourceIdHash: string;
      mutationId: string;
      contentHash: string;
      logicalClock: number;
      payloadByteSize: number;
      modifiedAt: string;
      requiresUserReview: boolean;
    }>;
    deletedRecords: Array<{
      zone: string;
      recordType: string;
      recordName: string;
      deletedAt: string;
    }>;
  };
  syncImportQuarantine?: {
    scannedZones: string[];
    changed: number;
    deleted: number;
    failed: number;
    moreComing: boolean;
    rawPayloadIncluded: boolean;
    zones: Array<{
      zone: string;
      previousServerChangeTokenPresent: boolean;
      serverChangeTokenCaptured: boolean;
      changed: number;
      deleted: number;
      failed: number;
      moreComing: boolean;
      pagesFetched: number;
    }>;
    changedRecords: Array<{
      zone: string;
      recordType: string;
      recordName: string;
      lifeosSchema: string;
      lifeosDataType: string;
      sourceIdHash: string;
      mutationId: string;
      contentHash: string;
      logicalClock: number;
      payloadByteSize: number;
      modifiedAt: string;
      requiresUserReview: boolean;
      payloadCaptured: boolean;
    }>;
    deletedRecords: Array<{
      zone: string;
      recordType: string;
      recordName: string;
      deletedAt: string;
    }>;
  };
  warnings?: string[];
  errors?: string[];
  command?: {
    exitCode: number | null;
    timedOut: boolean;
    stdoutBytes: number;
    stderr: string;
  };
};

export type CloudKitSyncCheckpoint = {
  zone: string;
  tokenState: "none" | "pending-preview" | "applied";
  appliedServerChangeTokenPresent: boolean;
  pendingServerChangeTokenPresent: boolean;
  lastEvidenceId?: string;
  lastPreviewAt?: number;
  lastAppliedAt?: number;
  changedCount: number;
  deletedCount: number;
  failedCount: number;
  moreComing: boolean;
  updatedAt: number;
};

export type CloudKitSyncQuarantineSummary = {
  importedChanged: number;
  importedDeleted: number;
  skipped: number;
  autoReady: number;
  pendingReview: number;
  applied: number;
  conflicts: number;
  failed: number;
  payloadStored: boolean;
};

export type CloudKitSyncQuarantineItem = {
  id: string;
  zone: string;
  recordType: string;
  recordName: string;
  changeType: "changed" | "deleted";
  status: string;
  mutationId?: string;
  contentHash?: string;
  logicalClock: number;
  payloadByteSize: number;
  requiresUserReview: boolean;
  serverModifiedAt?: string;
  deletedAt?: string;
  sourceEvidenceId?: string;
  importedAt: number;
  appliedAt?: number;
  error?: string;
  payloadCaptured: boolean;
};

export type CloudKitSyncApplyResult = {
  attempted: number;
  applied: number;
  manualReviewRequired: number;
  conflicts: number;
  failed: number;
  skipped: number;
  promotedZones: string[];
  blockedZones: string[];
  records: Array<{ id: string; zone: string; recordType: string; status: "applied" | "conflict" | "failed" | "skipped"; error?: string }>;
  summary: CloudKitSyncQuarantineSummary;
  checkpoints: CloudKitSyncCheckpoint[];
};

export type CloudKitSyncNowResult = {
  ok: boolean;
  status: "needs-setup" | "no-changes" | "imported" | "applied" | "conflicts" | "more-coming" | "failed";
  nextAction: "configure-cloudkit" | "wait-for-icloud" | "review-conflicts" | "run-again" | "retry" | "done";
  startedAt: number;
  finishedAt: number;
  limit: number;
  changes: {
    result: CloudKitNativeHelperResult;
    savedCheckpointCount: number;
    checkpoints: CloudKitSyncCheckpoint[];
  };
  import?: {
    result: CloudKitNativeHelperResult;
    tokenSaved: number;
    integrityRejected: number;
    rejectionReasons: Array<{ reason: string; count: number }>;
    quarantine: CloudKitSyncQuarantineSummary;
    checkpoints: CloudKitSyncCheckpoint[];
  };
  apply: CloudKitSyncApplyResult;
  quarantine: {
    summary: CloudKitSyncQuarantineSummary;
    checkpoints: CloudKitSyncCheckpoint[];
  };
  backups: Array<{ stage: "import-quarantine" | "apply-quarantine"; created: true; size: number; createdAt: number; redaction?: BackupRecord["redaction"] }>;
  safety: {
    rawPayloadReturnedToAdmin: false;
    serverChangeTokenReturnedToAdmin: false;
    appliesOnlyConflictFreeRecords: true;
  };
};

export type CloudKitSyncUploadNowResult = {
  ok: boolean;
  status: "needs-setup" | "empty" | "blocked" | "uploaded" | "failed";
  nextAction: "configure-cloudkit" | "add-local-data" | "review-blocked-records" | "retry" | "done";
  startedAt: number;
  finishedAt: number;
  limit: number;
  export: CloudKitSyncExportSummary;
  backup?: { stage: "export-cloudkit"; created: true; size: number; createdAt: number; redaction?: BackupRecord["redaction"] };
  result?: CloudKitNativeHelperResult;
  safety: {
    rawPayloadReturnedToAdmin: false;
    rawPayloadSentOnlyToNativeHelper: boolean;
    localBackupPathReturnedToAdmin: false;
    requiresExplicitConfirmation: true;
  };
};

export type CloudKitSyncCycleResult = {
  ok: boolean;
  status: "needs-setup" | "remote-failed" | "remote-conflicts" | "remote-more-coming" | "upload-blocked" | "upload-failed" | "local-empty" | "completed";
  nextAction: "configure-cloudkit" | "review-conflicts" | "review-blocked-records" | "continue-pull" | "retry" | "use-lifeos" | "done";
  startedAt: number;
  finishedAt: number;
  limit: number;
  pull: Omit<CloudKitSyncNowResult, "safety"> & {
    safety: {
      rawPayloadReturnedToAdmin: false;
      cloudKitChangeTokenReturnedToAdmin: false;
      appliesOnlyConflictFreeRecords: true;
    };
  };
  upload?: CloudKitSyncUploadNowResult;
  safety: {
    rawPayloadReturnedToAdmin: false;
    cloudKitChangeTokenReturnedToAdmin: false;
    localBackupPathReturnedToAdmin: false;
    uploadRunsOnlyAfterConflictFreePull: true;
  };
};

export type CloudKitAutoSyncLastResult = {
  ok: boolean;
  status: CloudKitSyncCycleResult["status"] | "skipped" | "already-running" | "failed";
  nextAction: CloudKitSyncCycleResult["nextAction"] | "wait" | "configure-cloudkit" | "retry";
  reason: "scheduled" | "manual" | "not-ready" | "already-running" | "error";
  startedAt: number;
  finishedAt: number;
  readinessStatus?: string;
  dataSyncScope?: string;
  pullStatus?: CloudKitSyncCycleResult["pull"]["status"];
  pullApplied?: number;
  pullConflicts?: number;
  uploadStatus?: NonNullable<CloudKitSyncCycleResult["upload"]>["status"];
  uploadSaved?: number;
  error?: string;
  rawPayloadReturnedToAdmin: false;
  cloudKitChangeTokenReturnedToAdmin: false;
  localBackupPathReturnedToAdmin: false;
};

export type CloudKitAutoSyncSchedule = {
  enabled: boolean;
  intervalMinutes: number;
  lastRunAt?: number;
  nextRunAt?: number;
  updatedAt?: number;
  lastResult?: CloudKitAutoSyncLastResult;
  pendingLocalChanges?: {
    total: number;
    byType: Record<string, number>;
    firstChangedAt: number;
    lastChangedAt: number;
    nextSuggestedRunAt: number;
    rawPayloadStored: false;
  };
};

export type CloudKitSyncBatchPreview = {
  ok: boolean;
  status: "skipped" | "blocked" | "empty" | "needs-review" | "ready";
  generatedAt: string;
  readinessStatus: string;
  dataSyncScope: NetworkDiagnostics["icloud"]["dataSync"]["dataSyncScope"];
  selectedDataTypes: string[];
  readyRecordCount: number;
  blockedRecordCount: number;
  totalCandidateCount: number;
  truncated: boolean;
  limit: number;
  zones: Array<{ zone: string; records: number }>;
  recordTypes: Array<{ recordType: string; records: number }>;
  records: Array<{
    id: string;
    dataType: string;
    zone: string;
    recordType: string;
    recordName: string;
    mutationId: string;
    logicalClock: number;
    fieldNames: string[];
    byteSize: number;
    contentHash: string;
    requiresUserReview: boolean;
  }>;
  blockedRecords: Array<{
    id: string;
    dataType: string;
    recordType: string;
    reason: "sensitive-memory" | "secret-like-content" | "unsafe-field" | "malformed-json" | "unsupported-record";
    contentHash: string;
  }>;
  safety: {
    forbiddenFieldNames: string[];
    forbiddenFieldCount: number;
    blockedDataTypes: string[];
    notSyncedDataTypes: string[];
    credentialBoundary: NetworkDiagnostics["icloud"]["dataSync"]["credentialBoundary"];
    secretLikeContentBlocked: number;
    sensitiveMemoryBlocked: number;
    rawPayloadIncluded: false;
  };
  helperPayloadPlan: {
    schema: "lifeos-cloudkit-sync-batch-preview.v1";
    operation: "preview";
    sendsRawUserContent: false;
    nextHelperOperation: "probe" | "roundtrip" | "sync-export-blocked";
    recordPlanHash: string;
  };
  nextAction: string;
};

export type CloudKitSyncExportSummary = {
  ok: boolean;
  status: "blocked" | "ready";
  generatedAt: string;
  requestId: string;
  preview: CloudKitSyncBatchPreview;
  exportRecordCount: number;
  recordPlanHash: string;
  zones: Array<{ zone: string; records: number }>;
  safety: {
    rawPayloadReturnedToAdmin: false;
    rawPayloadSentToNativeHelper: boolean;
    blockedBeforeExport: number;
    requiresExplicitConfirmation: true;
  };
};

export type CloudKitDeviceTrustMetadataItem = {
  id: string;
  displayName: string;
  deviceType: string;
  trustState: string;
  publicKeyFingerprintShort?: string;
  accessExpiresAt?: number;
  createdAt?: number;
  lastSeenAt?: number;
  revokedAt?: number;
  reviewStatus: "needs-rebind" | "reviewed" | "ignored";
  accessGranted: false;
  importedAt: number;
  appliedAt: number;
  nextAction: "rebind-device" | "review-revoked-device" | "keep-for-reference";
  guidance: string;
};

export type CloudKitDeviceTrustMetadataSummary = {
  total: number;
  needsRebind: number;
  revoked: number;
  accessGranted: 0;
  newestAppliedAt: number | null;
  nextAction: "rebind-device" | "review-revoked-device" | "none";
  rawCredentialReturnedToAdmin: false;
  deviceAccessGrantedFromCloudKit: false;
};

export type ConnectionTestResult = {
  ok: boolean;
  httpsStatus?: {
    ok: boolean;
    protocol: string;
    requiredForLongTerm: boolean;
    trustedByRuntime: boolean;
    error?: string;
  };
  status: number;
  url: string;
  latencyMs: number;
  service?: string;
  publicAccessWarning?: boolean;
  error?: string;
  steps?: Array<{
    id: "health" | "mobile-shell" | "websocket";
    ok: boolean;
    status: number;
    url: string;
    latencyMs: number;
    error?: string;
  }>;
  fixes?: Array<{
    id:
      | "desktop-service-unreachable"
      | "wrong-lifeos-target"
      | "mobile-shell-missing"
      | "websocket-upgrade-blocked"
      | "localhost-phone-unreachable"
      | "https-required"
      | "public-mode-risk";
    stepId?: "health" | "mobile-shell" | "websocket";
    severity: "warning" | "danger";
  }>;
};

export type MobilePairingIntent = {
  token: string;
};

export type StoredProblemBlueprint = ProblemBlueprint & {
  id: string;
  problem: string;
  status: "planned" | "generated";
  source: "studio" | "chat" | "mobile";
  generatedAppId?: string | null;
  generatedAppName?: string | null;
  createdByType?: string | null;
  createdById?: string | null;
  createdAt: number;
  updatedAt: number;
};

export type StoredCustomApp = CustomApp & {
  source: "studio" | "chat" | "import" | "migration";
  problemBlueprintId?: string | null;
  createdByType?: string | null;
  createdById?: string | null;
  updatedAt: number;
  deletedAt?: number | null;
};

export type StoredCustomAppVersion = {
  id: string;
  appId: string;
  version: number;
  code: string;
  note?: string | null;
  createdByType?: string | null;
  createdById?: string | null;
  createdAt: number;
};

export type CustomAppVersionComparison = {
  appId: string;
  fromVersion: number;
  toVersion: number;
  fromCreatedAt: number;
  toCreatedAt: number;
  fromNote?: string | null;
  toNote?: string | null;
  fromBytes: number;
  toBytes: number;
  addedLines: number;
  removedLines: number;
  changedLines: number;
  unchangedLines: number;
  totalChangedLines: number;
  risk: "low" | "medium" | "high";
  riskNotes: string[];
  reviewChecklist: string[];
  repairHints: string[];
  preview: {
    added: string[];
    removed: string[];
    changed: Array<{ before: string; after: string }>;
  };
};

export type CustomAppRepairProposal = {
  appId: string;
  appName: string;
  issue: string;
  risk: "low" | "medium" | "high";
  suspectedArea: "runtime-error" | "state" | "capability" | "action-policy" | "unknown";
  summary: string;
  evidence: string[];
  repairSteps: string[];
  permissionReview: string[];
  versionSafety: string[];
  executionPlan: CustomAppRepairExecutionPlan;
  suggestedInstruction: string;
  generatedAt: number;
};

export type CustomAppRepairExecutionPlan = {
  mode: "auto-save" | "manual-review" | "blocked";
  canAutoApply: boolean;
  reasonKey: "low-risk-runtime" | "needs-permission-review" | "high-risk-action" | "unknown-area" | "retry-limit";
  checks: string[];
  nextSteps: string[];
};

export type CustomAppAutoRepairExecutionSession = {
  id: string;
  appId: string;
  taskId: string;
  status: "ready" | "blocked";
  mode: "studio-refine-worker" | "manual-review-gate";
  canRunUnattended: boolean;
  reasonKey: CustomAppRepairExecutionPlan["reasonKey"];
  instruction: string;
  requiredSteps: string[];
  smokeChecks: string[];
  completionEndpoint: string;
  rollbackVersion?: number | null;
  createdAt: number;
  expiresAt: number;
};

export type CustomAppAutoRepairTask = {
  id: string;
  appId: string;
  status: "ready" | "blocked";
  mode: CustomAppRepairExecutionPlan["mode"];
  canAutoApply: boolean;
  reasonKey: CustomAppRepairExecutionPlan["reasonKey"];
  suggestedInstruction: string;
  requiredChecks: string[];
  nextSteps: string[];
  repairAttempt: number;
  retryLimit: number;
  rollbackVersion?: number | null;
  executionSession?: CustomAppAutoRepairExecutionSession | null;
  createdAt: number;
};

export type CustomAppAutoRepairReadiness = {
  status: "ready" | "blocked" | "needs-review";
  canAutoApply: boolean;
  decision: "resume-in-studio" | "manual-review" | "smoke-verification";
  passedChecks: string[];
  failedChecks: string[];
  rollbackVersion?: number | null;
  generatedAt: number;
};

export type CustomAppAutoRepairResult = {
  id: string;
  appId: string;
  taskId?: string;
  status: "applied" | "needs-review" | "unchanged" | "blocked";
  fromVersion?: number | null;
  toVersion?: number | null;
  comparisonRisk?: "low" | "medium" | "high" | null;
  rollbackVersion?: number | null;
  rollbackAvailable: boolean;
  verification: {
    status: "pending-smoke" | "needs-review" | "not-changed";
    requiredChecks: string[];
    failures: string[];
  };
  nextSteps: string[];
  createdAt: number;
};

export type CustomAppAutoRepairSmokeReview = {
  id: string;
  appId: string;
  resultId: string;
  taskId?: string | null;
  status: "passed" | "failed";
  method?: "manual" | "static-auto";
  note?: string | null;
  failures: string[];
  staticChecks?: string[];
  rollbackRecommended: boolean;
  nextSteps: string[];
  reviewedAt: number;
};

export type CustomAppAutoRepairAutoRollback = {
  attempted: boolean;
  status: "rolled-back" | "skipped" | "failed";
  reason: string;
  fromVersion?: number | null;
  rollbackVersion?: number | null;
  toVersion?: number | null;
  eventId?: string | null;
  error?: string | null;
};

export type CustomAppAutoRepairQueueItem = {
  id: string;
  appId: string;
  eventId: string;
  taskId: string;
  status: "pending" | "blocked" | "needs-review";
  waitingFor: "studio-refine" | "manual-review" | "smoke-verification";
  canResumeInStudio: boolean;
  resumeInstruction: string;
  task: CustomAppAutoRepairTask;
  executionSession?: CustomAppAutoRepairExecutionSession | null;
  readiness: CustomAppAutoRepairReadiness;
  repairProposal?: CustomAppRepairProposal | null;
  latestResult?: CustomAppAutoRepairResult | null;
  latestSmokeReview?: CustomAppAutoRepairSmokeReview | null;
  rollbackVersion?: number | null;
  createdAt: number;
};

export type StoredCustomAppState = {
  appId: string;
  state: unknown;
  updatedByType?: string | null;
  updatedById?: string | null;
  updatedAt: number;
};

export type StoredCustomAppActionRequest = {
  id: string;
  appId: string;
  actionType: "open_url";
  label: string;
  targetUrl: string;
  targetScheme: string;
  paramsSummary: string;
  risk: "low" | "medium" | "high";
  status: "pending" | "approved" | "cancelled" | "blocked";
  reason?: string | null;
  createdByType?: string | null;
  createdById?: string | null;
  createdAt: number;
  decidedByType?: string | null;
  decidedById?: string | null;
  decidedAt?: number | null;
  decisionNote?: string | null;
};

export type CustomAppActionPolicyTemplate = "global" | "web" | "navigation" | "communication" | "shortcuts" | "locked";

export type StoredCustomAppActionPolicy = {
  appId: string;
  template: CustomAppActionPolicyTemplate;
  allowedSchemes: string[];
  requireConfirmation: boolean;
  updatedByType?: string | null;
  updatedById?: string | null;
  updatedAt: number;
};

export type CustomAppCapabilityId =
  | "storage"
  | "openExternal"
  | "navigation"
  | "communication"
  | "shortcuts"
  | "network"
  | "clipboard"
  | "fileImport"
  | "backgroundSync";

export type StoredCustomAppCapabilityManifest = {
  appId: string;
  allowedCapabilities: CustomAppCapabilityId[];
  declaredCapabilities: CustomAppCapabilityId[];
  riskLevel: "low" | "medium" | "high";
  updatedByType?: string | null;
  updatedById?: string | null;
  updatedAt: number;
};

export type StoredCustomAppCapabilityRequest = {
  id: string;
  appId: string;
  requestedCapabilities: CustomAppCapabilityId[];
  missingCapabilities: CustomAppCapabilityId[];
  label: string;
  reason?: string | null;
  risk: "low" | "medium" | "high";
  status: "pending" | "approved" | "denied";
  createdByType?: string | null;
  createdById?: string | null;
  createdAt: number;
  decidedByType?: string | null;
  decidedById?: string | null;
  decidedAt?: number | null;
  decisionNote?: string | null;
};

export type StoredCustomAppRuntimeEvent = {
  id: string;
  appId: string;
  eventType:
    | "opened"
    | "ready"
    | "console"
    | "error"
    | "state_read"
    | "state_saved"
    | "action_requested"
    | "capability_requested"
    | "debug_requested"
    | "debug_applied"
    | "auto_repair_planned"
    | "auto_repair_blocked"
    | "auto_repair_applied"
    | "auto_repair_needs_review"
    | "auto_repair_smoke_passed"
    | "auto_repair_smoke_failed"
    | "auto_repair_auto_rolled_back";
  severity: "info" | "warning" | "error";
  label: string;
  message: string;
  detail: unknown;
  createdByType?: string | null;
  createdById?: string | null;
  createdAt: number;
};

export function getLifeOSBasePath(pathname = typeof window === "undefined" ? "/" : window.location?.pathname || "/") {
  const match = String(pathname || "/").match(/^(.*?)(?:\/(?:admin|mobile|chat)(?:\/|$)|\/?$)/);
  const basePath = (match?.[1] || "").replace(/\/+$/, "");
  return basePath === "/" ? "" : basePath;
}

export function apiUrl(path: string) {
  const normalizedPath = path.startsWith("/") ? path : `/${path}`;
  return `${getLifeOSBasePath()}${normalizedPath}`;
}

export function realtimeWebSocketUrl(path = "/api/v1/ws") {
  const protocol = window.location.protocol === "https:" ? "wss" : "ws";
  return `${protocol}://${window.location.host}${apiUrl(path)}`;
}

type JsonRequestInit = RequestInit & { timeoutMs?: number };

export class LifeosApiError extends Error {
  status: number;
  code: string;
  payload: unknown;

  constructor(message: string, status: number, code = "", payload: unknown = null) {
    super(message);
    this.name = "LifeosApiError";
    this.status = status;
    this.code = code;
    this.payload = payload;
  }
}

async function requestJson<T>(url: string, init?: JsonRequestInit): Promise<T> {
  const method = init?.method || "GET";
  const body = typeof init?.body === "string" ? init.body : "";
  const { timeoutMs = 15_000, signal, ...fetchInit } = init || {};
  const controller = !signal && timeoutMs > 0 ? new AbortController() : null;
  const timeout = controller ? setTimeout(() => controller.abort(), timeoutMs) : null;
  let response: Response;
  try {
    response = await fetch(apiUrl(url), {
      ...fetchInit,
      credentials: "same-origin",
      signal: signal || controller?.signal,
      headers: {
        "Content-Type": "application/json",
        ...getCsrfHeader(),
        ...(await getAuthHeaders(method, url, body)),
        ...(fetchInit.headers || {}),
      },
    });
  } catch (error: any) {
    if (error?.name === "AbortError") {
      throw new Error("Request timed out. Please retry after the local core is ready.");
    }
    throw error;
  } finally {
    if (timeout) clearTimeout(timeout);
  }

  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new LifeosApiError(data?.error || `Request failed: ${response.status}`, response.status, String(data?.code || ""), data);
  }
  return data;
}

export async function getMobilePairingIntent(): Promise<MobilePairingIntent> {
  const response = await fetch(apiUrl("/api/v1/mobile/pairing-intent"), {
    credentials: "same-origin",
    headers: {
      "Content-Type": "application/json",
    },
  });
  return response.json().catch(() => ({ token: "" }));
}

function getCookie(name: string) {
  return document.cookie
    .split(";")
    .map((cookie) => cookie.trim())
    .find((cookie) => cookie.startsWith(`${name}=`))
    ?.slice(name.length + 1);
}

function getCsrfHeader(): Record<string, string> {
  const token = getCookie("lifeos_csrf");
  return token ? { "X-LifeOS-CSRF": decodeURIComponent(token) } : {};
}

export async function getAuthHeaders(method = "GET", url = "/", body = ""): Promise<Record<string, string>> {
  const deviceCredential = await getStoredDeviceCredentialAsync();
  if (deviceCredential?.device?.id && deviceCredential.accessToken) {
    return {
      "X-LifeOS-Device-ID": deviceCredential.device.id,
      "X-LifeOS-Device-Token": deviceCredential.accessToken,
    };
  }

  if (deviceCredential?.device?.id && deviceCredential.authMethod === "signature") {
    const timestamp = String(Date.now());
    const nonce = crypto.randomUUID();
    const path = new URL(url, window.location.origin).pathname;
    const bodyHash = await sha256Base64Url(body);
    const payload = buildDeviceSignaturePayload({ method, path, bodyHash, timestamp, nonce });
    const signature = await signDevicePayload(payload);
    if (signature) {
      return {
        "X-LifeOS-Device-ID": deviceCredential.device.id,
        "X-LifeOS-Device-Timestamp": timestamp,
        "X-LifeOS-Device-Nonce": nonce,
        "X-LifeOS-Device-Signature": signature,
      };
    }
  }

  return {};
}

export function buildDeviceSignaturePayload(input: { method: string; path: string; bodyHash: string; timestamp: string; nonce: string }) {
  return [input.method.toUpperCase(), input.path, input.bodyHash, input.timestamp, input.nonce].join("\n");
}

export function getStoredAdminSession(): AdminSession | null {
  const raw = localStorage.getItem("lifeos_admin_session");
  if (!raw) return null;
  try {
    const session = JSON.parse(raw);
    if (!session?.expiresAt || session.expiresAt <= Date.now()) {
      localStorage.removeItem("lifeos_admin_session");
      return null;
    }
    return session;
  } catch {
    return null;
  }
}

export function saveStoredAdminSession(session: AdminSession) {
  localStorage.setItem("lifeos_admin_session", JSON.stringify({ expiresAt: session.expiresAt }));
}

export function clearStoredAdminSession() {
  localStorage.removeItem("lifeos_admin_session");
}

export function getStoredDeviceCredential(): StoredDeviceCredential | null {
  return getCachedDeviceCredential();
}

export function getStoredDeviceCredentialAsync(): Promise<StoredDeviceCredential | null> {
  return hydrateDeviceCredential();
}

export function getStoredDeviceCredentialStorageStatus() {
  return getDeviceCredentialStorageStatus();
}

export function getStoredDeviceCredentialExpiryStatus(credential: StoredDeviceCredential | null | undefined, now?: number) {
  return getDeviceCredentialExpiryStatus(credential, now);
}

export function saveStoredDeviceCredential(credential: StoredDeviceCredential) {
  return saveDeviceCredential(credential);
}

export async function clearStoredDeviceCredential() {
  await clearDeviceCredential();
  await clearDevicePrivateKey().catch(() => null);
}

export function getAdminStatus(options?: { timeoutMs?: number }) {
  return requestJson<{ configured: boolean; authenticated: boolean; envManaged: boolean; onboardingRequired: boolean | null; nextPath: string | null }>("/api/v1/admin/status", options);
}

export function getOnboardingStatus() {
  return requestJson<{ onboarding: OnboardingStatus }>("/api/v1/admin/onboarding");
}

export function completeOnboarding() {
  return requestJson<{ onboarding: OnboardingStatus }>("/api/v1/admin/onboarding/complete", { method: "PUT" });
}

export function getConfigDiagnostics() {
  return requestJson<ConfigDiagnostics>("/api/v1/admin/config-diagnostics");
}

export function getReleaseUpdateCheck() {
  return requestJson<ReleaseUpdateCheck>("/api/v1/admin/release/update-check");
}

export function getCalendarSyncPreview() {
  return requestJson<CalendarSyncPreview>("/api/v1/admin/calendar-sync/preview");
}

export function previewCalendarSync(proposedItems: Array<{
  providerId?: CalendarSyncPreview["providers"][number]["id"];
  kind?: "event" | "task";
  action?: "create" | "update" | "complete" | "delete";
  title?: string;
  startsAt?: string;
  dueAt?: string;
  externalId?: string;
  source?: string;
}>) {
  return requestJson<CalendarSyncPreview>("/api/v1/admin/calendar-sync/preview", {
    method: "POST",
    body: JSON.stringify({ proposedItems }),
  });
}

export function executeCalendarSyncOperation(input: CalendarSyncExecuteInput) {
  return requestJson<CalendarSyncExecutionResult>("/api/v1/admin/calendar-sync/execute", {
    method: "POST",
    body: JSON.stringify(input),
  });
}

export function getCalendarSyncHistory() {
  return requestJson<{ records: CalendarSyncHistoryRecord[] }>("/api/v1/admin/calendar-sync/history");
}

export function getCalendarSyncRuns() {
  return requestJson<{ records: CalendarSyncRunRecord[] }>("/api/v1/admin/calendar-sync/runs");
}

export function createCalendarSyncRun(proposedItems: Array<{
  providerId?: CalendarSyncPreview["providers"][number]["id"];
  kind?: "event" | "task";
  action?: "create" | "update" | "complete" | "delete";
  title?: string;
  startsAt?: string;
  dueAt?: string;
  externalId?: string;
  source?: string;
}>) {
  return requestJson<{ record: CalendarSyncRunRecord }>("/api/v1/admin/calendar-sync/runs", {
    method: "POST",
    body: JSON.stringify({ proposedItems }),
  });
}

export function rollbackCalendarSyncOperation(operationId: string, confirmationText: string) {
  return requestJson<{ record: CalendarSyncHistoryRecord; result: CalendarSyncExecutionResult }>(`/api/v1/admin/calendar-sync/operations/${encodeURIComponent(operationId)}/rollback`, {
    method: "POST",
    body: JSON.stringify({ explicitConsent: true, confirmationText }),
  });
}

export function createNativeAutomationPlan(input: NativeAutomationInput) {
  return requestJson<NativeAutomationPlan>("/api/v1/admin/native-automation/plan", {
    method: "POST",
    body: JSON.stringify(input),
  });
}

export function executeNativeAutomation(input: NativeAutomationInput) {
  return requestJson<NativeAutomationExecutionResult>("/api/v1/admin/native-automation/execute", {
    method: "POST",
    body: JSON.stringify(input),
  });
}

export function getNetworkDiagnostics() {
  return requestJson<NetworkDiagnostics>("/api/v1/admin/network-diagnostics");
}

export function testConnectionUrl(baseUrl: string, options: { persist?: boolean; label?: string } = {}) {
  return requestJson<{ result: ConnectionTestResult; remoteValidationReport?: NetworkDiagnostics["remoteValidationReport"] }>("/api/v1/admin/network-diagnostics/test-url", {
    method: "POST",
    body: JSON.stringify({ baseUrl, ...options }),
  });
}

export function saveDesktopConnectionConfig(input: { mode: NetworkDiagnostics["connectionCandidates"][number]["mode"]; label: string; baseUrl: string }) {
  return requestJson<{
    config: NonNullable<NetworkDiagnostics["desktopRuntimeConfig"]>;
    icloudRefresh: IcloudAutoRefreshResult;
    diagnostics: NetworkDiagnostics;
    restartRequired: boolean;
    message: string;
  }>("/api/v1/admin/desktop-connection-config", {
    method: "PUT",
    body: JSON.stringify(input),
  });
}

export function getCloudflareTunnelStatus() {
  return requestJson<{
    tunnel: NetworkDiagnostics["cloudflare"]["managed"];
    diagnostics: NetworkDiagnostics;
  }>("/api/v1/admin/cloudflare-tunnel");
}

export function startCloudflareTunnel() {
  return requestJson<{
    tunnel: NetworkDiagnostics["cloudflare"]["managed"];
    config: NonNullable<NetworkDiagnostics["desktopRuntimeConfig"]>;
    icloudRefresh: IcloudAutoRefreshResult;
    diagnostics: NetworkDiagnostics;
    message: string;
  }>("/api/v1/admin/cloudflare-tunnel/start", { method: "POST" });
}

export function exportIcloudHandoff() {
  return requestJson<{
    handoff: NetworkDiagnostics["icloud"] & {
      ok: true;
      generatedAt: number;
      cleanup: {
        removedEntryCount: number;
        removedOrphanedFileCount: number;
        removedFiles: string[];
        errorCount: number;
        errors: string[];
        expiredGraceMs: number;
      };
    };
    diagnostics: NetworkDiagnostics;
    message: string;
  }>("/api/v1/admin/icloud-handoff/export", { method: "POST" });
}

export function cleanupIcloudHandoffEntries() {
  return requestJson<{
    handoff: NetworkDiagnostics["icloud"] & {
      ok: true;
      cleanedAt: number;
      cleanup: {
        removedEntryCount: number;
        removedOrphanedFileCount: number;
        removedFiles: string[];
        errorCount: number;
        errors: string[];
        expiredGraceMs: number;
      };
    };
    diagnostics: NetworkDiagnostics;
    message: string;
  }>("/api/v1/admin/icloud-handoff/cleanup", { method: "POST" });
}

export function analyzeIcloudHandoffRepairPacket(packet: string) {
  return requestJson<{
    analysis: IcloudHandoffRepairAnalysis;
    repairImport: IcloudRepairImportRecord;
    icloudRefresh: IcloudAutoRefreshResult;
    diagnostics: NetworkDiagnostics;
  }>("/api/v1/admin/icloud-handoff/repair-packet", {
    method: "POST",
    body: JSON.stringify({ packet }),
  });
}

export function stopCloudflareTunnel() {
  return requestJson<{
    tunnel: NetworkDiagnostics["cloudflare"]["managed"];
    diagnostics: NetworkDiagnostics;
    message: string;
  }>("/api/v1/admin/cloudflare-tunnel/stop", { method: "POST" });
}

export function generateCloudflareNamedTunnelConfig(input: { name: string; hostname: string; credentialsFile: string }) {
  return requestJson<{
    namedTunnel: NetworkDiagnostics["cloudflareNamedTunnel"];
    diagnostics: NetworkDiagnostics;
    message: string;
  }>("/api/v1/admin/cloudflare-named-tunnel/config", {
    method: "POST",
    body: JSON.stringify(input),
  });
}

export function startCloudflareNamedTunnel() {
  return requestJson<{
    tunnel: NetworkDiagnostics["cloudflare"]["managed"];
    namedTunnel: NetworkDiagnostics["cloudflareNamedTunnel"];
    refresh: { refreshed: boolean; ready: boolean; reason: string };
    icloudRefresh: IcloudAutoRefreshResult;
    diagnostics: NetworkDiagnostics;
    message: string;
  }>("/api/v1/admin/cloudflare-named-tunnel/start", { method: "POST" });
}

export function runRemoteHealthCheck() {
  return requestJson<{
    skipped: boolean;
    reason: string;
    report: NetworkDiagnostics["remoteValidationReport"];
    icloudRefresh?: IcloudAutoRefreshResult;
    diagnostics: NetworkDiagnostics;
  }>("/api/v1/admin/network-diagnostics/remote-health", { method: "POST" });
}

export function recordRemoteAcceptance(
  id: NetworkDiagnostics["remoteAcceptanceChecklist"][number]["id"],
  note = "",
  evidence?: { source?: string; requirements?: string[] },
) {
  return requestJson<{
    record: {
      id: NetworkDiagnostics["remoteAcceptanceChecklist"][number]["id"];
      baseUrl: string;
      note: string;
      evidence: {
        entryKind: string;
        verifiedUrl: string;
        source: string;
        requirements: string[];
      };
      createdAt: number;
    };
    diagnostics: NetworkDiagnostics;
  }>("/api/v1/admin/network-diagnostics/acceptance", {
    method: "POST",
    body: JSON.stringify({ id, note, evidence }),
  });
}

export function recordIcloudAcceptance(
  id: NonNullable<NetworkDiagnostics["icloud"]["acceptance"]>["items"][number]["id"],
  note = "",
  evidence?: { source?: string; requirements?: string[] },
) {
  return requestJson<{
    record: {
      id: NetworkDiagnostics["remoteAcceptanceChecklist"][number]["id"];
      baseUrl: string;
      note: string;
      evidence: {
        entryKind: string;
        verifiedUrl: string;
        source: string;
        requirements: string[];
      };
      createdAt: number;
    };
    diagnostics: NetworkDiagnostics;
  }>("/api/v1/admin/icloud-handoff/acceptance", {
    method: "POST",
    body: JSON.stringify({ id, note, evidence }),
  });
}

export function runCloudKitDataSyncHelper(operation: CloudKitNativeHelperResult["operation"]) {
  return requestJson<{
    result: CloudKitNativeHelperResult;
    diagnostics: NetworkDiagnostics;
  }>("/api/v1/admin/icloud-data-sync/helper", {
    method: "POST",
    timeoutMs: 30_000,
    body: JSON.stringify({ operation }),
  });
}

export function getCloudKitSyncBatchPreview(limit?: number) {
  const query = limit ? `?limit=${encodeURIComponent(String(limit))}` : "";
  return requestJson<{
    preview: CloudKitSyncBatchPreview;
    diagnostics: NetworkDiagnostics;
  }>(`/api/v1/admin/icloud-data-sync/batch-preview${query}`);
}

export function runCloudKitSyncExport(input: { confirmation: string; limit?: number }) {
  return requestJson<{
    result: CloudKitNativeHelperResult;
    export: CloudKitSyncExportSummary;
    backup: BackupRecord;
    diagnostics: NetworkDiagnostics;
  }>("/api/v1/admin/icloud-data-sync/export", {
    method: "POST",
    timeoutMs: 70_000,
    body: JSON.stringify(input),
  });
}

export function runCloudKitSyncImportPreview() {
  return requestJson<{
    result: CloudKitNativeHelperResult;
    diagnostics: NetworkDiagnostics;
  }>("/api/v1/admin/icloud-data-sync/import-preview", {
    method: "POST",
    timeoutMs: 70_000,
  });
}

export function runCloudKitSyncChangesPreview() {
  return requestJson<{
    result: CloudKitNativeHelperResult;
    checkpoints: CloudKitSyncCheckpoint[];
    diagnostics: NetworkDiagnostics;
  }>("/api/v1/admin/icloud-data-sync/changes-preview", {
    method: "POST",
    timeoutMs: 70_000,
  });
}

export function runCloudKitSyncImportQuarantine(input: { confirmation: string }) {
  return requestJson<{
    result: CloudKitNativeHelperResult;
    quarantine: CloudKitSyncQuarantineSummary;
    checkpoints: CloudKitSyncCheckpoint[];
    backup?: BackupRecord;
    diagnostics: NetworkDiagnostics;
  }>("/api/v1/admin/icloud-data-sync/import-quarantine", {
    method: "POST",
    timeoutMs: 70_000,
    body: JSON.stringify(input),
  });
}

export function getCloudKitSyncQuarantine(limit?: number) {
  const query = limit ? `?limit=${encodeURIComponent(String(limit))}` : "";
  return requestJson<{
    quarantine: {
      items: CloudKitSyncQuarantineItem[];
      summary: CloudKitSyncQuarantineSummary;
      checkpoints: CloudKitSyncCheckpoint[];
    };
    diagnostics: NetworkDiagnostics;
  }>(`/api/v1/admin/icloud-data-sync/quarantine${query}`);
}

export function getCloudKitDeviceTrustMetadata(limit?: number) {
  const query = limit ? `?limit=${encodeURIComponent(String(limit))}` : "";
  return requestJson<{
    deviceTrust: {
      items: CloudKitDeviceTrustMetadataItem[];
      summary: CloudKitDeviceTrustMetadataSummary;
    };
    diagnostics: NetworkDiagnostics;
  }>(`/api/v1/admin/icloud-data-sync/device-trust${query}`);
}

export function applyCloudKitSyncQuarantine(input: { confirmation: string; limit?: number }) {
  return requestJson<{
    apply: CloudKitSyncApplyResult;
    backup?: BackupRecord;
    diagnostics: NetworkDiagnostics;
  }>("/api/v1/admin/icloud-data-sync/apply-quarantine", {
    method: "POST",
    timeoutMs: 70_000,
    body: JSON.stringify(input),
  });
}

export function runCloudKitSyncNow(input: { confirmation: string; limit?: number }) {
  return requestJson<{
    sync: CloudKitSyncNowResult;
    diagnostics: NetworkDiagnostics;
  }>("/api/v1/admin/icloud-data-sync/sync-now", {
    method: "POST",
    timeoutMs: 90_000,
    body: JSON.stringify(input),
  });
}

export function runCloudKitSyncUploadNow(input: { confirmation: string; limit?: number }) {
  return requestJson<{
    upload: CloudKitSyncUploadNowResult;
    diagnostics: NetworkDiagnostics;
  }>("/api/v1/admin/icloud-data-sync/upload-now", {
    method: "POST",
    timeoutMs: 90_000,
    body: JSON.stringify(input),
  });
}

export function runCloudKitSyncCycle(input: { confirmation: string; limit?: number }) {
  return requestJson<{
    cycle: CloudKitSyncCycleResult;
    diagnostics: NetworkDiagnostics;
  }>("/api/v1/admin/icloud-data-sync/cycle", {
    method: "POST",
    timeoutMs: 120_000,
    body: JSON.stringify(input),
  });
}

export function getCloudKitAutoSyncSchedule() {
  return requestJson<{
    schedule: CloudKitAutoSyncSchedule;
    diagnostics: NetworkDiagnostics;
  }>("/api/v1/admin/icloud-data-sync/auto-sync");
}

export function updateCloudKitAutoSyncSchedule(input: { enabled: boolean; intervalMinutes: number }) {
  return requestJson<{
    schedule: CloudKitAutoSyncSchedule;
    diagnostics: NetworkDiagnostics;
  }>("/api/v1/admin/icloud-data-sync/auto-sync", {
    method: "PUT",
    body: JSON.stringify(input),
  });
}

export function runCloudKitAutoSyncNow() {
  return requestJson<{
    skipped: boolean;
    reason: "scheduled" | "manual" | "not-ready" | "already-running" | "error";
    schedule: CloudKitAutoSyncSchedule;
    lastResult: CloudKitAutoSyncLastResult;
    cycle?: CloudKitSyncCycleResult;
    diagnostics: NetworkDiagnostics;
  }>("/api/v1/admin/icloud-data-sync/auto-sync/run-now", {
    method: "POST",
    timeoutMs: 120_000,
  });
}

export function importRemoteAcceptanceReport(report: unknown) {
  return requestJson<{
    record: {
      id: string;
      baseUrl: string;
      entryKind: string;
      longTermReady: boolean;
      realWorldAcceptanceRequired: boolean;
      completionStatus: "ready" | "automated-ready-manual-required" | "not-ready";
      importedAt: number;
      automatedChecks: {
        ok: boolean;
        passed: number;
        total: number;
        httpsStatus?: { ok: boolean; protocol: string; requiredForLongTerm: boolean; trustedByRuntime: boolean; error?: string };
      };
      manualAcceptance: Array<{ id: string; title: string; required: boolean }>;
    };
    diagnostics: NetworkDiagnostics;
  }>("/api/v1/admin/network-diagnostics/acceptance-report", {
    method: "POST",
    body: JSON.stringify({ report }),
  });
}

export function runRemoteAcceptance() {
  return requestJson<{
    record: {
      id: string;
      baseUrl: string;
      entryKind: string;
      longTermReady: boolean;
      realWorldAcceptanceRequired: boolean;
      completionStatus: "ready" | "automated-ready-manual-required" | "not-ready";
      importedAt: number;
      automatedChecks: {
        ok: boolean;
        passed: number;
        total: number;
        httpsStatus?: { ok: boolean; protocol: string; requiredForLongTerm: boolean; trustedByRuntime: boolean; error?: string };
      };
      manualAcceptance: Array<{ id: string; title: string; required: boolean }>;
    };
    result: NonNullable<NetworkDiagnostics["remoteValidationReport"]>;
    diagnostics: NetworkDiagnostics;
  }>("/api/v1/admin/network-diagnostics/acceptance-run", { method: "POST" });
}

export function startTailscaleHttpsServe() {
  return requestJson<{
    serve: {
      ok: boolean;
      command: string;
      output: string;
      url: string;
      status: NetworkDiagnostics["tailscale"];
    };
    config: NonNullable<NetworkDiagnostics["desktopRuntimeConfig"]>;
    icloudRefresh: IcloudAutoRefreshResult;
    diagnostics: NetworkDiagnostics;
    message: string;
  }>("/api/v1/admin/tailscale-serve/start", { method: "POST" });
}

export function installTailscaleClient() {
  return requestJson<{
    install: {
      ok: boolean;
      alreadyInstalled: boolean;
      needsUserAction?: boolean;
      terminalOpened?: boolean;
      action?: "terminal-opened" | "copy-command";
      command: string;
      terminalCommand?: string;
      output: string;
      status: NetworkDiagnostics["tailscale"];
      message: string;
    };
    diagnostics: NetworkDiagnostics;
    message: string;
  }>("/api/v1/admin/tailscale/install", {
    method: "POST",
    body: JSON.stringify({ confirm: "install-tailscale" }),
    timeoutMs: 10 * 60 * 1000,
  });
}

export function stopTailscaleHttpsServe() {
  return requestJson<{
    serve: {
      ok: boolean;
      command: string;
      output: string;
      url: string;
      status: NetworkDiagnostics["tailscale"];
    };
    diagnostics: NetworkDiagnostics;
    message: string;
  }>("/api/v1/admin/tailscale-serve/stop", { method: "POST" });
}

export function diagnosticBundleDownloadUrl() {
  return "/api/v1/admin/diagnostic-bundle";
}

export function saveAiKey(apiKey: string) {
  return requestJson<{ ai: ConfigDiagnostics["ai"] }>("/api/v1/admin/ai-key", {
    method: "PUT",
    body: JSON.stringify({ apiKey }),
  });
}

export function deleteAiKey() {
  return requestJson<{ ai: ConfigDiagnostics["ai"] }>("/api/v1/admin/ai-key", { method: "DELETE" });
}

export function listAiProviders() {
  return requestJson<{ providers: AiProviderStatus[] }>("/api/v1/admin/ai-providers");
}

export function saveAiProviderKey(providerId: AiProviderId, apiKey: string) {
  return requestJson<{ provider: AiProviderStatus }>(`/api/v1/admin/ai-providers/${providerId}/key`, {
    method: "PUT",
    body: JSON.stringify({ apiKey }),
  });
}

export function deleteAiProviderKey(providerId: AiProviderId) {
  return requestJson<{ provider: AiProviderStatus }>(`/api/v1/admin/ai-providers/${providerId}/key`, { method: "DELETE" });
}

export function updateAiProviderModel(providerId: AiProviderId, model: string) {
  return requestJson<{ provider: AiProviderStatus }>(`/api/v1/admin/ai-providers/${providerId}/model`, {
    method: "PUT",
    body: JSON.stringify({ model }),
  });
}

export function updateActiveAiProvider(providerId: AiProviderId) {
  return requestJson<{ provider: AiProviderStatus; providers: AiProviderStatus[] }>(`/api/v1/admin/ai-providers/${providerId}/active`, { method: "PUT" });
}

export type AiProviderTestResult = {
  ok: boolean;
  provider: AiProviderStatus;
  message: string;
  mode: "configuration" | "live";
  liveSupported: boolean;
  selectedModel?: string;
  checkedAt: number;
  result: "ready" | "not_configured" | "disabled" | "live_ready" | "live_failed";
  reason?: string;
  credentialKind?: "api_key" | "endpoint";
  modelCount?: number;
  discoveredModelCount?: number;
  modelCatalogUpdated?: boolean;
  selectedModelAvailable?: boolean;
};

export function testAiProvider(providerId: AiProviderId, mode: "configuration" | "live" = "configuration") {
  return requestJson<AiProviderTestResult>(`/api/v1/admin/ai-providers/${providerId}/test`, {
    method: "POST",
    body: JSON.stringify({ mode }),
  });
}

export async function setupAdmin(password: string) {
  const session = await requestJson<AdminSession>("/api/v1/admin/setup", {
    method: "POST",
    body: JSON.stringify({ password }),
  });
  saveStoredAdminSession(session);
  return session;
}

export async function loginAdmin(password: string) {
  const session = await requestJson<AdminSession>("/api/v1/admin/login", {
    method: "POST",
    body: JSON.stringify({ password }),
  });
  saveStoredAdminSession(session);
  return session;
}

export async function resetLocalAdminPassword(newPassword: string) {
  const session = await requestJson<AdminSession>("/api/v1/admin/local-password-reset", {
    method: "POST",
    body: JSON.stringify({ newPassword }),
  });
  saveStoredAdminSession(session);
  return session;
}

export function changeAdminPassword(input: { currentPassword: string; newPassword: string }) {
  return requestJson<{ ok: true; passwordPolicy: unknown; securityCheck: ConfigDiagnostics["securityCheck"] }>("/api/v1/admin/password", {
    method: "PUT",
    body: JSON.stringify(input),
  });
}

export async function logoutAdmin() {
  try {
    await requestJson<{ ok: true }>("/api/v1/admin/logout", { method: "POST" });
  } finally {
    clearStoredAdminSession();
  }
}

export function startBindingSession(baseUrl?: string) {
  return requestJson<BindingSession>("/api/v1/devices/bind/start", {
    method: "POST",
    body: JSON.stringify(baseUrl ? { baseUrl } : {}),
  });
}

export function getBindingSession(bindingId: string) {
  return requestJson<{
    id: string;
    expiresAt: number;
    baseUrl?: string;
    confirmedAt?: number;
    device: BoundDevice | null;
  }>(`/api/v1/devices/bind/${bindingId}`);
}

export async function confirmBinding(token: string, deviceName: string) {
  const keyPair = isDeviceSignatureAvailable() ? await createDeviceKeyPair() : null;
  const credential = await requestJson<StoredDeviceCredential>("/api/v1/devices/bind/confirm", {
    method: "POST",
    body: JSON.stringify({
      token,
      deviceName,
      deviceType: "mobile",
      ...(keyPair ? { publicKey: keyPair.publicKey } : {}),
    }),
  });
  if (!keyPair) return credential;
  return {
    device: credential.device,
    authMethod: "signature" as const,
    accessTokenExpiresAt: credential.accessTokenExpiresAt,
  };
}

export async function rotateDeviceToken() {
  const existingCredential = await getStoredDeviceCredentialAsync();
  if (existingCredential?.authMethod === "signature") return existingCredential;

  const credential = await requestJson<StoredDeviceCredential>("/api/v1/devices/token/rotate", { method: "POST" });
  await saveStoredDeviceCredential(credential);
  return credential;
}

export async function revokeCurrentDeviceBinding() {
  return requestJson<{ ok: true; device: BoundDevice }>("/api/v1/devices/me", { method: "DELETE" });
}

export function reportMobileConnectivity(result: MobileConnectivityReportInput) {
  return requestJson<{ ok: true; report: DeviceConnectivityReport; icloudRefresh?: IcloudAutoRefreshResult | null }>("/api/v1/devices/me/connectivity-report", {
    method: "POST",
    body: JSON.stringify({
      ok: result.ok,
      currentBase: result.currentBase,
      latencyMs: result.latencyMs,
      error: result.error,
      steps: result.steps.map((step) => ({
        id: step.id,
        ok: step.ok,
        status: step.status,
        latencyMs: step.latencyMs,
        error: step.error,
      })),
    }),
  });
}

export function reportMobileIcloudHandoffEvent(event: MobileIcloudHandoffEventReportInput) {
  return requestJson<{
    ok: true;
    event: DeviceIcloudHandoffEvent;
    icloudRefresh: IcloudAutoRefreshResult;
  }>("/api/v1/devices/me/icloud-handoff-event", {
    method: "POST",
    body: JSON.stringify(event),
  });
}

export function getLatestMobileConnectivityReport() {
  return requestJson<{ report: DeviceConnectivityReport | null }>("/api/v1/devices/me/connectivity-report");
}

export async function createDeviceWebSocketAuthMessage() {
  const credential = await getStoredDeviceCredentialAsync();
  if (!credential) return null;

  if (credential.accessToken) {
    return {
      type: "auth",
      deviceId: credential.device.id,
      accessToken: credential.accessToken,
      timestamp: Date.now(),
    };
  }

  if (credential.authMethod === "signature") {
    const timestamp = String(Date.now());
    const nonce = crypto.randomUUID();
    const payload = buildDeviceSignaturePayload({
      method: "WS",
      path: "/api/v1/ws",
      bodyHash: "",
      timestamp,
      nonce,
    });
    const signature = await signDevicePayload(payload);
    if (!signature) return null;
    return {
      type: "auth",
      deviceId: credential.device.id,
      timestamp,
      nonce,
      signature,
    };
  }

  return null;
}

export function listDevices() {
  return requestJson<{ devices: BoundDevice[] }>("/api/v1/devices");
}

export function revokeDevice(deviceId: string) {
  return requestJson<{ ok: true }>(`/api/v1/devices/${deviceId}`, { method: "DELETE" });
}

export function requestDeviceTokenRotation(deviceId: string) {
  return requestJson<{ ok: true; delivered: boolean }>(`/api/v1/devices/${deviceId}/token/rotation-request`, { method: "POST" });
}

export function getHealth(options?: { timeoutMs?: number }) {
  return requestJson<{
    ok: boolean;
    service: string;
    version: string;
    uptime: number;
    deviceCount: number;
    onlineDeviceCount: number;
    aiConfigured: boolean;
    adminConfigured: boolean;
    host: string;
    networkMode: "local" | "lan";
    publicBaseUrl: string;
    remoteEntryMode: "configured" | "cloudflare" | "tailscale" | "lan" | "local" | null;
    publicAccessWarning: boolean;
    publicAccessAllowed: boolean;
    publicSetupRisk: boolean;
    publicRisk: {
      overall: "ok" | "warning" | "critical";
      items: Array<{
        id: string;
        label: string;
        status: "ok" | "warning" | "critical";
        message: string;
        action: string;
      }>;
    };
    timestamp: number;
  }>("/api/v1/health", options);
}

export function listBackups() {
  return requestJson<{ backups: BackupRecord[] }>("/api/v1/backups");
}

export function getBackupSchedule() {
  return requestJson<{ schedule: BackupSchedule }>("/api/v1/backups/schedule");
}

export function updateBackupSchedule(input: { enabled: boolean; intervalHours: number }) {
  return requestJson<{ schedule: BackupSchedule }>("/api/v1/backups/schedule", {
    method: "PUT",
    body: JSON.stringify(input),
  });
}

export function runBackupScheduleNow() {
  return requestJson<{ backup: BackupRecord; schedule: BackupSchedule }>("/api/v1/backups/schedule/run-now", {
    method: "POST",
  });
}

export function listAuditLogs() {
  return requestJson<{ logs: AuditLogRecord[] }>("/api/v1/audit-logs");
}

export function getPendingRestore() {
  return requestJson<{ pendingRestore: PendingRestore | null }>("/api/v1/backups/pending-restore");
}

export function backupDownloadUrl(file: string) {
  return `/api/v1/backups/${encodeURIComponent(file)}/download`;
}

export type DataExportScope = "chat" | "memories" | "devices" | "auditLogs" | "customApps";

export function dataExportDownloadUrl(scopes?: DataExportScope[]) {
  const selected = scopes?.filter(Boolean) || [];
  if (!selected.length || selected.length === 5) return "/api/v1/data/export";
  return `/api/v1/data/export?scope=${encodeURIComponent(selected.join(","))}`;
}

export function createBackup() {
  return requestJson<{ backup: BackupRecord }>("/api/v1/backups", { method: "POST" });
}

export function exportEncryptedBackup(file: string, passphrase: string) {
  return requestJson<{ payload: unknown }>(`/api/v1/backups/${encodeURIComponent(file)}/encrypted-export`, {
    method: "POST",
    body: JSON.stringify({ passphrase }),
  });
}

export function importEncryptedBackup(payload: unknown, passphrase: string) {
  return requestJson<{ backup: BackupRecord; preview: BackupPreview }>("/api/v1/backups/encrypted-import", {
    method: "POST",
    body: JSON.stringify({ payload, passphrase }),
  });
}

export function restoreBackup(file: string) {
  return requestJson<{ restore: PendingRestore }>(
    `/api/v1/backups/${encodeURIComponent(file)}/restore`,
    { method: "POST" },
  );
}

export function cancelPendingRestore() {
  return requestJson<{ ok: true; cancelledRestore: PendingRestore | null }>("/api/v1/backups/pending-restore", { method: "DELETE" });
}

export function previewBackup(file: string) {
  return requestJson<{ preview: BackupPreview }>(`/api/v1/backups/${encodeURIComponent(file)}/preview`);
}

export function cleanupData(options: { auditOlderThanDays?: number; chatOlderThanDays?: number; backupKeepCount?: number }) {
  return requestJson<{ cleanup: CleanupResult }>("/api/v1/data/cleanup", {
    method: "POST",
    body: JSON.stringify(options),
  });
}

export function previewDataCleanup(options: { auditOlderThanDays?: number; chatOlderThanDays?: number; backupKeepCount?: number }) {
  return requestJson<{ cleanup: CleanupResult }>("/api/v1/data/cleanup/preview", {
    method: "POST",
    body: JSON.stringify(options),
  });
}

export function listChatSessions() {
  return requestJson<{ sessions: ChatSession[] }>("/api/v1/chat/sessions");
}

export function createChatSession(title = "JARVIS Main Session") {
  return requestJson<{ session: ChatSession }>("/api/v1/chat/sessions", {
    method: "POST",
    body: JSON.stringify({ title }),
  });
}

export function getChatSessionMessages(sessionId: string) {
  return requestJson<{ session: ChatSession; messages: StoredChatMessage[] }>(`/api/v1/chat/sessions/${sessionId}/messages`);
}

export async function saveChatMessage(sessionId: string, message: Message, metadata?: ChatMessageSaveMetadata) {
  const credential = await getStoredDeviceCredentialAsync();
  return requestJson<{ message: StoredChatMessage }>(`/api/v1/chat/sessions/${sessionId}/messages`, {
    method: "POST",
    body: JSON.stringify({
      role: message.role === "model" ? "assistant" : message.role,
      content: message,
      sourceDeviceId: credential?.device.id,
      metadata,
    }),
  });
}

export function clearActiveChatSession() {
  clearActiveChatSessionId();
}

export function listMemories() {
  return requestJson<{ memories: MemoryRecord[] }>("/api/v1/memories");
}

export function listProblemBlueprints(limit = 12) {
  return requestJson<{ blueprints: StoredProblemBlueprint[] }>(`/api/v1/problem-blueprints?limit=${encodeURIComponent(String(limit))}`);
}

export function createProblemBlueprint(problem: string, source: StoredProblemBlueprint["source"] = "studio") {
  return requestJson<{ blueprint: StoredProblemBlueprint }>("/api/v1/problem-blueprints", {
    method: "POST",
    body: JSON.stringify({ problem, source }),
  });
}

export function attachGeneratedAppToProblemBlueprint(blueprintId: string, input: { appId: string; appName: string }) {
  return requestJson<{ blueprint: StoredProblemBlueprint }>(`/api/v1/problem-blueprints/${encodeURIComponent(blueprintId)}/generated-app`, {
    method: "PUT",
    body: JSON.stringify(input),
  });
}

export function listCustomApps(limit = 100) {
  return requestJson<{ apps: StoredCustomApp[] }>(`/api/v1/custom-apps?limit=${encodeURIComponent(String(limit))}`);
}

export function createCustomAppRecord(app: CustomApp, source: StoredCustomApp["source"] = "studio", problemBlueprintId?: string | null) {
  return requestJson<{ app: StoredCustomApp }>("/api/v1/custom-apps", {
    method: "POST",
    body: JSON.stringify({ ...app, source, problemBlueprintId }),
  });
}

export function updateCustomAppRecord(appId: string, input: Partial<Pick<CustomApp, "name" | "description" | "visibility" | "status" | "code">> & { problemBlueprintId?: string | null }) {
  return requestJson<{ app: StoredCustomApp }>(`/api/v1/custom-apps/${encodeURIComponent(appId)}`, {
    method: "PATCH",
    body: JSON.stringify(input),
  });
}

export function listCustomAppVersions(appId: string, limit = 20) {
  return requestJson<{ versions: StoredCustomAppVersion[] }>(`/api/v1/custom-apps/${encodeURIComponent(appId)}/versions?limit=${encodeURIComponent(String(limit))}`);
}

export function compareCustomAppVersions(appId: string, fromVersion?: number, toVersion?: number) {
  const params = new URLSearchParams();
  if (fromVersion !== undefined) params.set("from", String(fromVersion));
  if (toVersion !== undefined) params.set("to", String(toVersion));
  const suffix = params.toString() ? `?${params.toString()}` : "";
  return requestJson<{ comparison: CustomAppVersionComparison }>(`/api/v1/custom-apps/${encodeURIComponent(appId)}/version-compare${suffix}`);
}

export function rollbackCustomAppVersion(appId: string, version: number) {
  return requestJson<{ app: StoredCustomApp; version: StoredCustomAppVersion }>(`/api/v1/custom-apps/${encodeURIComponent(appId)}/versions/${encodeURIComponent(String(version))}/rollback`, {
    method: "POST",
  });
}

export function getCustomAppState(appId: string) {
  return requestJson<{ state: StoredCustomAppState }>(`/api/v1/custom-apps/${encodeURIComponent(appId)}/state`);
}

export function saveCustomAppState(appId: string, state: unknown) {
  return requestJson<{ state: StoredCustomAppState }>(`/api/v1/custom-apps/${encodeURIComponent(appId)}/state`, {
    method: "PUT",
    body: JSON.stringify({ state }),
  });
}

export function listCustomAppRuntimeEvents(appId: string, limit = 20) {
  return requestJson<{ events: StoredCustomAppRuntimeEvent[] }>(`/api/v1/custom-apps/${encodeURIComponent(appId)}/runtime-events?limit=${encodeURIComponent(String(limit))}`);
}

export function listCustomAppAutoRepairQueue(appId: string, limit = 20) {
  return requestJson<{ queue: CustomAppAutoRepairQueueItem[] }>(`/api/v1/custom-apps/${encodeURIComponent(appId)}/auto-repairs/queue?limit=${encodeURIComponent(String(limit))}`);
}

export function createCustomAppRuntimeEvent(
  appId: string,
  input: Partial<Pick<StoredCustomAppRuntimeEvent, "eventType" | "severity" | "label" | "message" | "detail">>,
) {
  return requestJson<{ event: StoredCustomAppRuntimeEvent }>(`/api/v1/custom-apps/${encodeURIComponent(appId)}/runtime-events`, {
    method: "POST",
    body: JSON.stringify(input),
  });
}

export function createCustomAppDebugRequest(appId: string, input: { issue?: string; message?: string }) {
  return requestJson<{ event: StoredCustomAppRuntimeEvent | null; repairProposal: CustomAppRepairProposal; suggestedInstruction: string; recentEvents: StoredCustomAppRuntimeEvent[] }>(
    `/api/v1/custom-apps/${encodeURIComponent(appId)}/debug-requests`,
    {
      method: "POST",
      body: JSON.stringify(input),
    },
  );
}

export function createCustomAppAutoRepairPlan(appId: string, input: { issue?: string; message?: string }) {
  return requestJson<{
    debugEvent: StoredCustomAppRuntimeEvent | null;
    autoRepairEvent: StoredCustomAppRuntimeEvent | null;
    autoRepairTask: CustomAppAutoRepairTask;
    executionSession: CustomAppAutoRepairExecutionSession;
    repairProposal: CustomAppRepairProposal;
    suggestedInstruction: string;
    recentEvents: StoredCustomAppRuntimeEvent[];
  }>(
    `/api/v1/custom-apps/${encodeURIComponent(appId)}/auto-repairs`,
    {
      method: "POST",
      body: JSON.stringify(input),
    },
  );
}

export function completeCustomAppAutoRepair(appId: string, input: {
  taskId?: string;
  fromVersion?: number | null;
  rollbackVersion?: number | null;
  suggestedInstruction?: string;
  instruction?: string;
  autoSmoke?: boolean;
  staticSmoke?: boolean;
  runStaticSmoke?: boolean;
}) {
  return requestJson<{
    event: StoredCustomAppRuntimeEvent | null;
    result: CustomAppAutoRepairResult;
    comparison: CustomAppVersionComparison | null;
    staticSmoke?: {
      event: StoredCustomAppRuntimeEvent | null;
      review: CustomAppAutoRepairSmokeReview;
      result: CustomAppAutoRepairResult;
    } | null;
    autoRollback?: CustomAppAutoRepairAutoRollback | null;
  }>(
    `/api/v1/custom-apps/${encodeURIComponent(appId)}/auto-repairs/complete`,
    {
      method: "POST",
      body: JSON.stringify(input),
    },
  );
}

export function recordCustomAppAutoRepairSmokeReview(appId: string, input: {
  resultId: string;
  status: "passed" | "failed" | "smoke-passed" | "smoke-failed";
  note?: string;
  failures?: string[];
}) {
  return requestJson<{
    event: StoredCustomAppRuntimeEvent | null;
    review: CustomAppAutoRepairSmokeReview;
    result: CustomAppAutoRepairResult;
  }>(
    `/api/v1/custom-apps/${encodeURIComponent(appId)}/auto-repairs/smoke-review`,
    {
      method: "POST",
      body: JSON.stringify(input),
    },
  );
}

export function getCustomAppCapabilityManifest(appId: string) {
  return requestJson<{ manifest: StoredCustomAppCapabilityManifest }>(`/api/v1/custom-apps/${encodeURIComponent(appId)}/capabilities`);
}

export function updateCustomAppCapabilityManifest(
  appId: string,
  input: { allowedCapabilities?: CustomAppCapabilityId[]; declaredCapabilities?: CustomAppCapabilityId[]; capabilities?: CustomAppCapabilityId[] },
) {
  return requestJson<{ manifest: StoredCustomAppCapabilityManifest }>(`/api/v1/custom-apps/${encodeURIComponent(appId)}/capabilities`, {
    method: "PUT",
    body: JSON.stringify(input),
  });
}

export function listCustomAppCapabilityRequests(appId: string, limit = 20) {
  return requestJson<{ requests: StoredCustomAppCapabilityRequest[] }>(`/api/v1/custom-apps/${encodeURIComponent(appId)}/capability-requests?limit=${encodeURIComponent(String(limit))}`);
}

export function createCustomAppCapabilityRequest(
  appId: string,
  input: { requestedCapabilities?: CustomAppCapabilityId[]; capabilities?: CustomAppCapabilityId[]; label?: string; reason?: string },
) {
  return requestJson<{ request: StoredCustomAppCapabilityRequest }>(`/api/v1/custom-apps/${encodeURIComponent(appId)}/capability-requests`, {
    method: "POST",
    body: JSON.stringify(input),
  });
}

export function decideCustomAppCapabilityRequest(appId: string, requestId: string, decision: "approved" | "denied", note?: string) {
  return requestJson<{ request: StoredCustomAppCapabilityRequest }>(`/api/v1/custom-apps/${encodeURIComponent(appId)}/capability-requests/${encodeURIComponent(requestId)}/decision`, {
    method: "POST",
    body: JSON.stringify({ decision, note }),
  });
}

export function getCustomAppActionPolicy(appId: string) {
  return requestJson<{ policy: StoredCustomAppActionPolicy }>(`/api/v1/custom-apps/${encodeURIComponent(appId)}/action-policy`);
}

export function updateCustomAppActionPolicy(
  appId: string,
  input: { template?: CustomAppActionPolicyTemplate; allowedSchemes?: string[]; requireConfirmation?: boolean },
) {
  return requestJson<{ policy: StoredCustomAppActionPolicy }>(`/api/v1/custom-apps/${encodeURIComponent(appId)}/action-policy`, {
    method: "PUT",
    body: JSON.stringify(input),
  });
}

export function listCustomAppActionRequests(appId: string, limit = 20) {
  return requestJson<{ requests: StoredCustomAppActionRequest[] }>(`/api/v1/custom-apps/${encodeURIComponent(appId)}/action-requests?limit=${encodeURIComponent(String(limit))}`);
}

export function createCustomAppActionRequest(appId: string, input: { actionType?: "open_url"; type?: "open_url"; label?: string; targetUrl: string; reason?: string }) {
  return requestJson<{ request: StoredCustomAppActionRequest }>(`/api/v1/custom-apps/${encodeURIComponent(appId)}/action-requests`, {
    method: "POST",
    body: JSON.stringify(input),
  });
}

export function decideCustomAppActionRequest(appId: string, requestId: string, decision: "approved" | "cancelled", note?: string) {
  return requestJson<{ request: StoredCustomAppActionRequest }>(`/api/v1/custom-apps/${encodeURIComponent(appId)}/action-requests/${encodeURIComponent(requestId)}/decision`, {
    method: "POST",
    body: JSON.stringify({ decision, note }),
  });
}

export function deleteCustomAppRecord(appId: string) {
  return requestJson<{ ok: true }>(`/api/v1/custom-apps/${encodeURIComponent(appId)}`, { method: "DELETE" });
}

export function createMemory(input: { title: string; content: string; sensitivity?: "normal" | "sensitive" }) {
  return requestJson<{ memory: MemoryRecord }>("/api/v1/memories", {
    method: "POST",
    body: JSON.stringify(input),
  });
}

export function updateMemory(memoryId: string, input: Partial<Pick<MemoryRecord, "title" | "content" | "sensitivity">>) {
  return requestJson<{ memory: MemoryRecord }>(`/api/v1/memories/${memoryId}`, {
    method: "PATCH",
    body: JSON.stringify(input),
  });
}

export function deleteMemory(memoryId: string) {
  return requestJson<{ ok: true }>(`/api/v1/memories/${memoryId}`, { method: "DELETE" });
}

export async function getClientState<T>(key: string, fallback: T): Promise<T> {
  try {
    const data = await requestJson<{ key: string; value: T; updatedAt: number }>(`/api/v1/state/${encodeURIComponent(key)}`);
    return data.value;
  } catch {
    return fallback;
  }
}

export function setClientState<T>(key: string, value: T) {
  return requestJson<{ key: string; value: T; updatedAt: number }>(`/api/v1/state/${encodeURIComponent(key)}`, {
    method: "PUT",
    body: JSON.stringify({ value }),
  });
}
