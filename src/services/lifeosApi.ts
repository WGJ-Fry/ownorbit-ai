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

export type MobileConnectivityReportInput = {
  ok: boolean;
  currentBase: string;
  latencyMs: number;
  error?: string;
  steps: Array<{ id: "health" | "mobile-shell" | "websocket"; ok: boolean; url: string; latencyMs: number; status?: number; error?: string }>;
};

export type BindingSession = {
  id: string;
  token: string;
  expiresAt: number;
  baseUrl?: string;
  pairingUrl: string;
  localName: string;
};

export type { DeviceCredentialExpiryStatus, StoredDeviceCredential };

export type DeviceCredentialStorageStatus = Awaited<ReturnType<typeof getDeviceCredentialStorageStatus>>;

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
  manualUpdateRequired: true;
  autoUpdateEnabled: false;
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

export type AiProviderId = "gemini" | "openai" | "openrouter" | "local";
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
    envTemplate: string;
    notes: string[];
  };
  safety: {
    publicModeRequired: boolean;
    requiresHttpsForInternet: boolean;
    notes: string[];
  };
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
    | "auto_repair_blocked";
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

async function requestJson<T>(url: string, init?: RequestInit): Promise<T> {
  const method = init?.method || "GET";
  const body = typeof init?.body === "string" ? init.body : "";
  const response = await fetch(apiUrl(url), {
    ...init,
    credentials: "same-origin",
    headers: {
      "Content-Type": "application/json",
      ...getCsrfHeader(),
      ...(await getAuthHeaders(method, url, body)),
      ...(init?.headers || {}),
    },
  });

  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(data?.error || `Request failed: ${response.status}`);
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

export function getAdminStatus() {
  return requestJson<{ configured: boolean; authenticated: boolean; envManaged: boolean; onboardingRequired: boolean | null; nextPath: string | null }>("/api/v1/admin/status");
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
    diagnostics: NetworkDiagnostics;
    message: string;
  }>("/api/v1/admin/cloudflare-tunnel/start", { method: "POST" });
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
    diagnostics: NetworkDiagnostics;
    message: string;
  }>("/api/v1/admin/cloudflare-named-tunnel/start", { method: "POST" });
}

export function runRemoteHealthCheck() {
  return requestJson<{
    skipped: boolean;
    reason: string;
    report: NetworkDiagnostics["remoteValidationReport"];
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
    diagnostics: NetworkDiagnostics;
    message: string;
  }>("/api/v1/admin/tailscale-serve/start", { method: "POST" });
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
  return requestJson<{ ok: true; report: DeviceConnectivityReport }>("/api/v1/devices/me/connectivity-report", {
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

export function getHealth() {
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
  }>("/api/v1/health");
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
