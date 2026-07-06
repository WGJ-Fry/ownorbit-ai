import { useState } from "react";
import { AlertTriangle, ArrowRight, CheckCircle2, ClipboardCheck, ClipboardPaste, Cloud, ExternalLink, Loader2, QrCode, RefreshCw, ShieldCheck, Smartphone, Wifi } from "lucide-react";
import { analyzeIcloudHandoffRepairPacket } from "../../services/lifeosApi";
import type { IcloudAutoRefreshResult, IcloudHandoffRepairAnalysis, NetworkDiagnostics } from "../../services/lifeosApi";
import { useI18n } from "../../i18n/I18nProvider";
import type { TranslationKey } from "../../i18n/translations";
import { getPrimaryIcloudAction } from "./appleRemoteIcloudPrimaryAction";

type ConnectionCandidate = NetworkDiagnostics["connectionCandidates"][number];
type IcloudAvailability = NetworkDiagnostics["icloud"]["availability"];
type IcloudFileState = IcloudAvailability["handoffFile"];
type IcloudFileId = "html" | "packet" | "index";
type IcloudAvailableEntry = NetworkDiagnostics["icloud"]["availableEntries"][number];

type Props = {
  diagnostics: NetworkDiagnostics | null;
  busy: string | null;
  onExportIcloud: () => void;
  onCleanupIcloud: () => void;
  onStartTailscale: () => void;
  onStartCloudflare: () => void;
  onSaveCandidate: (candidate: ConnectionCandidate) => void;
  onTestCandidate: (candidate: ConnectionCandidate) => void;
};

const readinessStatusKeys: Record<NetworkDiagnostics["remoteReadiness"]["status"], TranslationKey> = {
  ready: "connection.readiness.status.ready",
  "needs-restart": "connection.readiness.status.needsRestart",
  temporary: "connection.readiness.status.temporary",
  "local-only": "connection.readiness.status.localOnly",
  "lan-only": "connection.readiness.status.lanOnly",
  blocked: "connection.readiness.status.blocked",
};

const handoffHealthStatusKeys: Record<NetworkDiagnostics["icloud"]["handoffHealth"]["status"], TranslationKey> = {
  missing: "onboarding.appleRemoteIcloudHealthMissing",
  fresh: "onboarding.appleRemoteIcloudHealthFresh",
  stale: "onboarding.appleRemoteIcloudHealthStale",
  "address-changed": "onboarding.appleRemoteIcloudHealthAddressChanged",
  expired: "onboarding.appleRemoteIcloudHealthExpired",
  invalid: "onboarding.appleRemoteIcloudHealthInvalid",
  legacy: "onboarding.appleRemoteIcloudHealthLegacy",
  "html-mismatch": "onboarding.appleRemoteIcloudHealthHtmlMismatch",
};

const handoffHealthReasonKeys: Record<NetworkDiagnostics["icloud"]["handoffHealth"]["status"], TranslationKey> = {
  missing: "onboarding.appleRemoteIcloudReasonMissing",
  fresh: "onboarding.appleRemoteIcloudReasonFresh",
  stale: "onboarding.appleRemoteIcloudReasonStale",
  "address-changed": "onboarding.appleRemoteIcloudReasonAddressChanged",
  expired: "onboarding.appleRemoteIcloudReasonExpired",
  invalid: "onboarding.appleRemoteIcloudReasonInvalid",
  legacy: "onboarding.appleRemoteIcloudReasonLegacy",
  "html-mismatch": "onboarding.appleRemoteIcloudReasonHtmlMismatch",
};

const icloudAvailabilityKeys: Record<NetworkDiagnostics["icloud"]["availability"]["status"], TranslationKey> = {
  unsupported: "onboarding.appleRemoteIcloudAvailabilityUnsupported",
  "account-unavailable": "onboarding.appleRemoteIcloudAvailabilityAccountUnavailable",
  missing: "onboarding.appleRemoteIcloudAvailabilityMissing",
  "read-only": "onboarding.appleRemoteIcloudAvailabilityReadOnly",
  "sync-service-unavailable": "onboarding.appleRemoteIcloudAvailabilityServiceUnavailable",
  "sync-stuck": "onboarding.appleRemoteIcloudAvailabilitySyncStuck",
  "sync-pending": "onboarding.appleRemoteIcloudAvailabilitySyncPending",
  ready: "onboarding.appleRemoteIcloudAvailabilityReady",
};

const icloudAccountStatusKeys: Record<NetworkDiagnostics["icloud"]["availability"]["account"]["status"], TranslationKey> = {
  unchecked: "onboarding.appleRemoteIcloudAvailabilityAccountUnknown",
  ready: "onboarding.appleRemoteIcloudAvailabilityAccountReady",
  "signed-out": "onboarding.appleRemoteIcloudAvailabilityAccountSignedOut",
  "drive-disabled": "onboarding.appleRemoteIcloudAvailabilityAccountDriveDisabled",
  unknown: "onboarding.appleRemoteIcloudAvailabilityAccountUnknown",
};

const icloudIndexConsistencyKeys: Record<NetworkDiagnostics["icloud"]["indexConsistency"]["status"], TranslationKey> = {
  missing: "onboarding.appleRemoteIcloudIndexMissing",
  legacy: "onboarding.appleRemoteIcloudIndexLegacy",
  mismatch: "onboarding.appleRemoteIcloudIndexMismatch",
  matching: "onboarding.appleRemoteIcloudIndexMatching",
};

const icloudFileLabelKeys: Record<IcloudFileId, TranslationKey> = {
  html: "onboarding.appleRemoteIcloudFileHtml",
  packet: "onboarding.appleRemoteIcloudFilePacket",
  index: "onboarding.appleRemoteIcloudFileIndex",
};

const icloudFileStateKeys: Record<IcloudFileState["state"], TranslationKey> = {
  missing: "onboarding.appleRemoteIcloudFileStateMissing",
  ready: "onboarding.appleRemoteIcloudFileStateReady",
  unreadable: "onboarding.appleRemoteIcloudFileStateUnreadable",
  placeholder: "onboarding.appleRemoteIcloudFileStatePlaceholder",
};

const icloudMetadataSyncStateKeys: Record<IcloudFileState["metadata"]["syncState"], TranslationKey> = {
  unknown: "onboarding.appleRemoteIcloudMetadataUnknown",
  synced: "onboarding.appleRemoteIcloudMetadataSynced",
  syncing: "onboarding.appleRemoteIcloudMetadataSyncing",
  "not-downloaded": "onboarding.appleRemoteIcloudMetadataNotDownloaded",
  "not-uploaded": "onboarding.appleRemoteIcloudMetadataNotUploaded",
};

const icloudSyncReadinessKeys: Record<NetworkDiagnostics["icloud"]["syncReadiness"]["status"], TranslationKey> = {
  unsupported: "onboarding.appleRemoteIcloudSyncUnsupported",
  "missing-drive": "onboarding.appleRemoteIcloudSyncMissingDrive",
  "read-only": "onboarding.appleRemoteIcloudSyncReadOnly",
  "no-entry": "onboarding.appleRemoteIcloudSyncNoEntry",
  "needs-refresh": "onboarding.appleRemoteIcloudSyncNeedsRefresh",
  "sync-stuck": "onboarding.appleRemoteIcloudSyncStuck",
  syncing: "onboarding.appleRemoteIcloudSyncSyncing",
  ready: "onboarding.appleRemoteIcloudSyncReady",
};

const icloudSyncActionKeys: Record<NetworkDiagnostics["icloud"]["syncReadiness"]["action"], TranslationKey> = {
  "use-apple-device": "onboarding.appleRemoteIcloudSyncActionApple",
  "enable-icloud-drive": "onboarding.appleRemoteIcloudSyncActionEnable",
  "fix-permissions": "onboarding.appleRemoteIcloudSyncActionPermissions",
  "export-entry": "onboarding.appleRemoteIcloudSyncActionExport",
  "refresh-entry": "onboarding.appleRemoteIcloudSyncActionRefresh",
  "fix-icloud-sync": "onboarding.appleRemoteIcloudSyncActionFixSync",
  "wait-for-sync": "onboarding.appleRemoteIcloudSyncActionWait",
  "open-files-app": "onboarding.appleRemoteIcloudSyncActionOpen",
};

const icloudPhoneConfirmationKeys: Record<NetworkDiagnostics["icloud"]["phoneConfirmation"]["status"], TranslationKey> = {
  missing: "onboarding.appleRemoteIcloudPhoneConfirmMissing",
  confirmed: "onboarding.appleRemoteIcloudPhoneConfirmConfirmed",
  stale: "onboarding.appleRemoteIcloudPhoneConfirmStale",
  "issue-after-confirm": "onboarding.appleRemoteIcloudPhoneConfirmIssueAfter",
};

const icloudPhoneConfirmationActionKeys: Record<NetworkDiagnostics["icloud"]["phoneConfirmation"]["action"], TranslationKey> = {
  none: "onboarding.appleRemoteIcloudPhoneConfirmActionNone",
  "open-on-phone": "onboarding.appleRemoteIcloudPhoneConfirmActionOpen",
  "refresh-entry": "onboarding.appleRemoteIcloudPhoneConfirmActionRefresh",
};

const icloudPairingSessionKeys: Record<NetworkDiagnostics["icloud"]["pairingSession"]["status"], TranslationKey> = {
  missing: "onboarding.appleRemoteIcloudPairingMissing",
  ready: "onboarding.appleRemoteIcloudPairingReady",
  "expiring-soon": "onboarding.appleRemoteIcloudPairingExpiringSoon",
  expired: "onboarding.appleRemoteIcloudPairingExpired",
  "address-changed": "onboarding.appleRemoteIcloudPairingAddressChanged",
  confirmed: "onboarding.appleRemoteIcloudPairingConfirmed",
};

const icloudPairingSessionActionKeys: Record<NetworkDiagnostics["icloud"]["pairingSession"]["action"], TranslationKey> = {
  none: "onboarding.appleRemoteIcloudPairingActionNone",
  "create-qr": "onboarding.appleRemoteIcloudPairingActionCreate",
  "use-current-qr": "onboarding.appleRemoteIcloudPairingActionUse",
  "regenerate-qr": "onboarding.appleRemoteIcloudPairingActionRegenerate",
};

const repairReasonKeys: Record<IcloudHandoffRepairAnalysis["reason"], TranslationKey> = {
  ready: "onboarding.appleRemoteIcloudRepairReasonReady",
  "invalid-packet": "onboarding.appleRemoteIcloudRepairReasonInvalid",
  "phone-entry-expired": "onboarding.appleRemoteIcloudRepairReasonExpired",
  "phone-entry-stale": "onboarding.appleRemoteIcloudRepairReasonStale",
  "phone-entry-legacy": "onboarding.appleRemoteIcloudRepairReasonLegacy",
  "phone-entry-mismatch": "onboarding.appleRemoteIcloudRepairReasonMismatch",
  "desktop-entry-changed": "onboarding.appleRemoteIcloudRepairReasonChanged",
  "phone-connectivity-failed": "onboarding.appleRemoteIcloudRepairReasonConnectivity",
  "desktop-local-or-lan": "onboarding.appleRemoteIcloudRepairReasonLocal",
  "temporary-entry": "onboarding.appleRemoteIcloudRepairReasonTemporary",
};

const repairRecommendationKeys: Record<IcloudHandoffRepairAnalysis["recommendations"][number]["id"], TranslationKey> = {
  "refresh-icloud": "onboarding.appleRemoteIcloudRepairRecRefresh",
  "open-latest-entry": "onboarding.appleRemoteIcloudRepairRecOpenLatest",
  "regenerate-qr": "onboarding.appleRemoteIcloudRepairRecQr",
  "start-tailscale": "onboarding.appleRemoteIcloudRepairRecTailscale",
  "start-cloudflare": "onboarding.appleRemoteIcloudRepairRecCloudflare",
  "save-stable-entry": "onboarding.appleRemoteIcloudRepairRecStable",
  "test-phone-entry": "onboarding.appleRemoteIcloudRepairRecTest",
  ready: "onboarding.appleRemoteIcloudRepairRecReady",
};

const icloudAcceptanceItemKeys: Record<NonNullable<NetworkDiagnostics["icloud"]["acceptance"]>["items"][number]["id"], TranslationKey> = {
  "icloud-entry-synced": "onboarding.appleRemoteIcloudAcceptanceItemSynced",
  "phone-opened-current-entry": "onboarding.appleRemoteIcloudAcceptanceItemPhone",
  "pairing-qr-current": "onboarding.appleRemoteIcloudAcceptanceItemQr",
  "realtime-entry-ready": "onboarding.appleRemoteIcloudAcceptanceItemRealtime",
  "cellular-mobile-chat": "onboarding.appleRemoteIcloudAcceptanceItemCellular",
  "network-switch": "onboarding.appleRemoteIcloudAcceptanceItemSwitch",
  "old-entry-repair": "onboarding.appleRemoteIcloudAcceptanceItemOldEntry",
};

const icloudAcceptanceActionKeys: Record<NonNullable<NetworkDiagnostics["icloud"]["acceptance"]>["recommendedAction"], TranslationKey> = {
  "export-icloud-entry": "onboarding.appleRemoteIcloudAcceptanceActionExport",
  "open-on-phone": "onboarding.appleRemoteIcloudAcceptanceActionOpen",
  "regenerate-qr": "onboarding.appleRemoteIcloudAcceptanceActionQr",
  "choose-live-network-entry": "onboarding.appleRemoteIcloudAcceptanceActionLiveEntry",
  "record-real-world-check": "onboarding.appleRemoteIcloudAcceptanceActionRecord",
  ready: "onboarding.appleRemoteIcloudAcceptanceActionReady",
};

const issueEventKindKeys: Record<NonNullable<NetworkDiagnostics["icloud"]["latestEntryIssueEvent"]>["eventType"], TranslationKey> = {
  "opened-current-entry": "onboarding.appleRemoteIcloudIssueKindCurrent",
  "ignored-superseded-entry": "onboarding.appleRemoteIcloudIssueKindSuperseded",
  "opened-stale-entry": "onboarding.appleRemoteIcloudIssueKindStale",
  "opened-expired-entry": "onboarding.appleRemoteIcloudIssueKindExpired",
  "opened-legacy-entry": "onboarding.appleRemoteIcloudIssueKindLegacy",
  "opened-address-mismatch-entry": "onboarding.appleRemoteIcloudIssueKindMismatch",
};

const latestEntryRepairStatusKeys: Record<NonNullable<NetworkDiagnostics["icloud"]["latestEntryRepair"]>["status"], TranslationKey> = {
  none: "onboarding.appleRemoteIcloudRepairStatusNone",
  "current-entry-opened": "onboarding.appleRemoteIcloudRepairStatusCurrent",
  "old-entry-opened": "onboarding.appleRemoteIcloudRepairStatusOld",
  "problem-entry-opened": "onboarding.appleRemoteIcloudRepairStatusProblem",
  "needs-refresh": "onboarding.appleRemoteIcloudRepairStatusRefresh",
};

const latestEntryRepairActionKeys: Record<NonNullable<NetworkDiagnostics["icloud"]["latestEntryRepair"]>["action"], TranslationKey> = {
  none: "onboarding.appleRemoteIcloudRepairActionNone",
  "open-on-phone": "onboarding.appleRemoteIcloudRepairActionOpen",
  "refresh-icloud": "onboarding.appleRemoteIcloudRepairActionRefresh",
  "refresh-and-regenerate-qr": "onboarding.appleRemoteIcloudRepairActionRefreshQr",
};

const historyChangeTypeKeys: Record<string, TranslationKey> = {
  "first-export": "onboarding.appleRemoteIcloudHistoryFirstExport",
  "public-base-url-changed": "onboarding.appleRemoteIcloudHistoryPublicBaseChanged",
  "cloudflare-address-changed": "onboarding.appleRemoteIcloudHistoryCloudflareChanged",
  "tailscale-address-changed": "onboarding.appleRemoteIcloudHistoryTailscaleChanged",
  "lan-address-changed": "onboarding.appleRemoteIcloudHistoryLanChanged",
  "address-changed": "onboarding.appleRemoteIcloudHistoryAddressChanged",
  "fallback-candidates-changed": "onboarding.appleRemoteIcloudHistoryFallbackChanged",
  "refreshed-same-address": "onboarding.appleRemoteIcloudHistoryRefreshed",
};

const icloudMonitorTriggerKeys: Record<string, TranslationKey> = {
  "local-core-startup": "onboarding.appleRemoteIcloudMonitorTriggerStartup",
  "desktop-wake": "onboarding.appleRemoteIcloudMonitorTriggerWake",
  "scheduled-check": "onboarding.appleRemoteIcloudMonitorTriggerSchedule",
  "remote-health": "onboarding.appleRemoteIcloudMonitorTriggerRemoteHealth",
  "phone-entry": "onboarding.appleRemoteIcloudMonitorTriggerPhone",
  "pairing-session": "onboarding.appleRemoteIcloudMonitorTriggerPairing",
  manual: "onboarding.appleRemoteIcloudMonitorTriggerManual",
  unknown: "onboarding.appleRemoteIcloudMonitorTriggerUnknown",
};

function monitorTriggerKey(trigger?: string): TranslationKey {
  return icloudMonitorTriggerKeys[trigger || ""] || "onboarding.appleRemoteIcloudMonitorTriggerUnknown";
}

function icloudFileTone(file: IcloudFileState) {
  if (file.syncStuck || file.state === "unreadable") return "border-amber-400/20 bg-amber-500/10 text-amber-50";
  if (file.state === "placeholder" || ["syncing", "not-downloaded", "not-uploaded"].includes(file.metadata.syncState)) return "border-sky-400/20 bg-sky-500/10 text-sky-50";
  if (file.state === "missing") return "border-zinc-500/20 bg-white/[0.03] text-zinc-300";
  return "border-emerald-400/20 bg-emerald-500/10 text-emerald-50";
}

function icloudEntryState(entry: IcloudAvailableEntry, now = Date.now()) {
  if (entry.expiresAt && now >= entry.expiresAt) {
    return {
      key: "onboarding.appleRemoteIcloudEntryExpired" as TranslationKey,
      className: "bg-red-500/15 text-red-100",
    };
  }
  if (entry.refreshAfter && now >= entry.refreshAfter) {
    return {
      key: "onboarding.appleRemoteIcloudEntryRefresh" as TranslationKey,
      className: "bg-amber-500/15 text-amber-100",
    };
  }
  return {
    key: "onboarding.appleRemoteIcloudEntryUsable" as TranslationKey,
    className: "bg-emerald-500/15 text-emerald-100",
  };
}

type IcloudLatestEntryRepair = NonNullable<NetworkDiagnostics["icloud"]["latestEntryRepair"]>;

function isAppleRuntime() {
  if (typeof navigator === "undefined") return false;
  const platform = (navigator as Navigator & { userAgentData?: { platform?: string } }).userAgentData?.platform || navigator.platform || "";
  const agent = navigator.userAgent || "";
  return /Mac|iPhone|iPad|iPod/i.test(`${platform} ${agent}`);
}

function getPreferredCandidate(diagnostics: NetworkDiagnostics | null) {
  const candidates = diagnostics?.connectionCandidates || [];
  const readinessId = diagnostics?.remoteReadiness?.candidateId;
  return (
    candidates.find((candidate) => candidate.id === readinessId && candidate.mode !== "local") ||
    candidates.find((candidate) => candidate.mode === "tailscale" && candidate.stability === "stable") ||
    candidates.find((candidate) => candidate.mode !== "local" && candidate.stability === "stable" && candidate.secure) ||
    candidates.find((candidate) => candidate.mode !== "local" && candidate.secure) ||
    candidates.find((candidate) => candidate.mode !== "local") ||
    null
  );
}

function formatHandoffTime(value?: number) {
  if (!value) return "";
  try {
    return new Date(value).toLocaleString();
  } catch {
    return "";
  }
}

function compactLatestEntryRepairUrls(repair: IcloudLatestEntryRepair) {
  return [
    { key: "onboarding.appleRemoteIcloudEventEntryUrl" as TranslationKey, value: repair.entryBaseUrl },
    { key: "onboarding.appleRemoteIcloudEventCurrentUrl" as TranslationKey, value: repair.currentBaseUrl },
    { key: "onboarding.appleRemoteIcloudEventStoredUrl" as TranslationKey, value: repair.storedBaseUrl },
    { key: "onboarding.appleRemoteIcloudEventDesktopUrl" as TranslationKey, value: repair.recommendedBaseUrl },
  ].filter((item, index, all) => (
    item.value && all.findIndex((candidate) => candidate.value === item.value) === index
  ));
}

export function getSimpleIcloudStatus(icloud: NetworkDiagnostics["icloud"] | undefined) {
  const availability = icloud?.availability;
  const health = icloud?.handoffHealth;
  const syncReadiness = icloud?.syncReadiness;
  const latestEntryRepair = icloud?.latestEntryRepair;
  const pairingSession = icloud?.pairingSession;
  if (availability?.status === "account-unavailable") {
    return {
      tone: "border-amber-400/20 bg-amber-500/10 text-amber-50",
      icon: "warning" as const,
      titleKey: "onboarding.appleRemoteIcloudSimpleAccountTitle" as TranslationKey,
      bodyKey: "onboarding.appleRemoteIcloudSimpleAccountBody" as TranslationKey,
    };
  }
  if (!icloud?.canExport || availability?.status === "missing" || availability?.status === "unsupported" || availability?.status === "read-only") {
    return {
      tone: "border-amber-400/20 bg-amber-500/10 text-amber-50",
      icon: "warning" as const,
      titleKey: "onboarding.appleRemoteIcloudSimpleUnavailableTitle" as TranslationKey,
      bodyKey: "onboarding.appleRemoteIcloudSimpleUnavailableBody" as TranslationKey,
    };
  }
  if (availability?.status === "sync-pending") {
    return {
      tone: "border-amber-400/20 bg-amber-500/10 text-amber-50",
      icon: "sync" as const,
      titleKey: "onboarding.appleRemoteIcloudSimpleSyncingTitle" as TranslationKey,
      bodyKey: "onboarding.appleRemoteIcloudSimpleSyncingBody" as TranslationKey,
    };
  }
  if (availability?.status === "sync-stuck") {
    return {
      tone: "border-amber-400/20 bg-amber-500/10 text-amber-50",
      icon: "warning" as const,
      titleKey: "onboarding.appleRemoteIcloudSimpleStuckTitle" as TranslationKey,
      bodyKey: "onboarding.appleRemoteIcloudSimpleStuckBody" as TranslationKey,
    };
  }
  if (!health || health.status === "missing") {
    return {
      tone: "border-sky-400/20 bg-sky-500/10 text-sky-50",
      icon: "sync" as const,
      titleKey: "onboarding.appleRemoteIcloudSimpleMissingTitle" as TranslationKey,
      bodyKey: "onboarding.appleRemoteIcloudSimpleMissingBody" as TranslationKey,
    };
  }
  if (latestEntryRepair?.status === "old-entry-opened" || latestEntryRepair?.status === "problem-entry-opened" || latestEntryRepair?.needsRefresh) {
    return {
      tone: latestEntryRepair.severity === "danger" ? "border-red-400/20 bg-red-500/10 text-red-50" : "border-amber-400/20 bg-amber-500/10 text-amber-50",
      icon: "refresh" as const,
      titleKey: "onboarding.appleRemoteIcloudSimpleOldEntryTitle" as TranslationKey,
      bodyKey: latestEntryRepair.needsQr ? "onboarding.appleRemoteIcloudSimpleOldEntryQrBody" as TranslationKey : "onboarding.appleRemoteIcloudSimpleOldEntryBody" as TranslationKey,
    };
  }
  if (pairingSession?.action === "create-qr" || pairingSession?.action === "regenerate-qr") {
    return {
      tone: pairingSession.severity === "danger" ? "border-red-400/20 bg-red-500/10 text-red-50" : "border-amber-400/20 bg-amber-500/10 text-amber-50",
      icon: "qr" as const,
      titleKey: "onboarding.appleRemoteIcloudSimpleQrTitle" as TranslationKey,
      bodyKey: "onboarding.appleRemoteIcloudSimpleQrBody" as TranslationKey,
    };
  }
  if (syncReadiness?.status === "needs-refresh") {
    return {
      tone: "border-amber-400/20 bg-amber-500/10 text-amber-50",
      icon: "refresh" as const,
      titleKey: "onboarding.appleRemoteIcloudSimpleRefreshTitle" as TranslationKey,
      bodyKey: "onboarding.appleRemoteIcloudSimpleRefreshBody" as TranslationKey,
    };
  }
  if (health.needsRefresh || health.status !== "fresh") {
    return {
      tone: "border-amber-400/20 bg-amber-500/10 text-amber-50",
      icon: "refresh" as const,
      titleKey: "onboarding.appleRemoteIcloudSimpleRefreshTitle" as TranslationKey,
      bodyKey: "onboarding.appleRemoteIcloudSimpleRefreshBody" as TranslationKey,
    };
  }
  return {
    tone: "border-emerald-400/20 bg-emerald-500/10 text-emerald-50",
    icon: "ready" as const,
    titleKey: "onboarding.appleRemoteIcloudSimpleReadyTitle" as TranslationKey,
    bodyKey: "onboarding.appleRemoteIcloudSimpleReadyBody" as TranslationKey,
  };
}

function icloudAcceptanceStatusTone(status: NonNullable<NetworkDiagnostics["icloud"]["acceptance"]>["items"][number]["status"]) {
  if (status === "passed") return "border-emerald-300/20 bg-emerald-400/10 text-emerald-50";
  if (status === "needs-action") return "border-amber-300/20 bg-amber-400/10 text-amber-50";
  return "border-sky-300/20 bg-sky-400/10 text-sky-50";
}

export default function OnboardingAppleRemoteCard({ diagnostics, busy, onExportIcloud, onCleanupIcloud, onStartTailscale, onStartCloudflare, onSaveCandidate, onTestCandidate }: Props) {
  const { t } = useI18n();
  const [repairText, setRepairText] = useState("");
  const [repairBusy, setRepairBusy] = useState(false);
  const [repairError, setRepairError] = useState("");
  const [repairAnalysis, setRepairAnalysis] = useState<IcloudHandoffRepairAnalysis | null>(null);
  const [repairRefresh, setRepairRefresh] = useState<IcloudAutoRefreshResult | null>(null);
  const appleRuntime = isAppleRuntime();
  const candidate = getPreferredCandidate(diagnostics);
  const icloud = diagnostics?.icloud;
  const handoffHealth = icloud?.handoffHealth;
  const icloudAvailability = icloud?.availability;
  const indexConsistency = icloud?.indexConsistency;
  const syncReadiness = icloud?.syncReadiness;
  const phoneConfirmation = icloud?.phoneConfirmation;
  const pairingSession = icloud?.pairingSession;
  const icloudAcceptance = icloud?.acceptance;
  const icloudMonitor = diagnostics?.icloudMonitor;
  const icloudLifecycle = icloud?.lifecycle;
  const latestEntryRepair = icloud?.latestEntryRepair || null;
  const latestRepairImport = icloud?.latestRepairImport || null;
  const latestHistory = icloud?.entryHistory?.slice(0, 3) || [];
  const availableEntryCount = icloud?.availableEntries?.length || 0;
  const availableEntries = icloud?.availableEntries?.slice(0, 6) || [];
  const readiness = diagnostics?.remoteReadiness;
  const tailscaleInstalled = Boolean(diagnostics?.tailscale.installed);
  const tailscaleInstallUrl = diagnostics?.tailscale.installUrl || "https://tailscale.com/download";
  const isIcloudBusy = Boolean(busy?.startsWith("icloud-handoff"));
  const isIcloudCleanupBusy = busy === "icloud-handoff-cleanup";
  const isBusy = Boolean(busy?.startsWith("remote-") || isIcloudBusy);
  const readinessTone = readiness?.severity === "ok" ? "text-emerald-200" : readiness?.severity === "danger" ? "text-red-200" : "text-amber-200";
  const candidateReady = Boolean(candidate);
  const canExportIcloud = Boolean(icloud?.canExport);
  const handoffHealthTone = handoffHealth?.status === "fresh" ? "bg-emerald-500/15 text-emerald-100" : handoffHealth?.status === "address-changed" || handoffHealth?.status === "expired" || handoffHealth?.status === "invalid" || handoffHealth?.status === "html-mismatch" ? "bg-red-500/15 text-red-100" : "bg-amber-500/15 text-amber-100";
  const icloudAvailabilityTone = icloudAvailability?.severity === "ok" ? "bg-emerald-500/15 text-emerald-100" : icloudAvailability?.severity === "danger" ? "bg-red-500/15 text-red-100" : "bg-amber-500/15 text-amber-100";
  const icloudIndexTone = indexConsistency?.ok ? "bg-emerald-500/15 text-emerald-100" : indexConsistency?.status === "mismatch" ? "bg-red-500/15 text-red-100" : "bg-amber-500/15 text-amber-100";
  const syncReadinessTone = syncReadiness?.severity === "ok" ? "border-emerald-400/20 bg-emerald-500/10 text-emerald-50" : syncReadiness?.severity === "danger" ? "border-red-400/20 bg-red-500/10 text-red-50" : "border-amber-400/20 bg-amber-500/10 text-amber-50";
  const phoneConfirmationTone = phoneConfirmation?.severity === "ok" ? "border-emerald-400/20 bg-emerald-500/10 text-emerald-50" : phoneConfirmation?.severity === "danger" ? "border-red-400/20 bg-red-500/10 text-red-50" : "border-amber-400/20 bg-amber-500/10 text-amber-50";
  const pairingSessionTone = pairingSession?.severity === "ok" ? "border-emerald-400/20 bg-emerald-500/10 text-emerald-50" : pairingSession?.severity === "danger" ? "border-red-400/20 bg-red-500/10 text-red-50" : "border-amber-400/20 bg-amber-500/10 text-amber-50";
  const icloudSyncStuckMinutes = Math.max(1, Math.round((icloudAvailability?.syncStuckAfterMs || 0) / 60000));
  const lastExportedAt = formatHandoffTime(handoffHealth?.lastExportedAt);
  const refreshAfter = formatHandoffTime(handoffHealth?.refreshAfter);
  const icloudMonitorStartedAt = formatHandoffTime(icloudMonitor?.startedAt || undefined);
  const icloudMonitorStartupRunAt = formatHandoffTime(icloudMonitor?.startupRunAt || undefined);
  const icloudMonitorLastRunAt = formatHandoffTime(icloudMonitor?.lastRunAt || undefined);
  const icloudMonitorNextRunAt = formatHandoffTime(icloudMonitor?.nextRunAt || undefined);
  const icloudMonitorIntervalSeconds = Math.round((icloudMonitor?.intervalMs || 0) / 1000);
  const phoneConfirmationAt = formatHandoffTime(phoneConfirmation?.confirmedAt);
  const latestRepairAt = formatHandoffTime(latestEntryRepair?.eventAt);
  const latestRepairImportAt = formatHandoffTime(latestRepairImport?.importedAt);
  const latestEntryRepairTone = latestEntryRepair?.severity === "ok" ? "border-emerald-400/20 bg-emerald-500/10 text-emerald-50" : latestEntryRepair?.severity === "danger" ? "border-red-400/20 bg-red-500/10 text-red-50" : "border-amber-400/20 bg-amber-500/10 text-amber-50";
  const latestRepairImportTone = latestRepairImport?.severity === "ok" ? "border-emerald-400/20 bg-emerald-500/10 text-emerald-50" : latestRepairImport?.severity === "danger" ? "border-red-400/20 bg-red-500/10 text-red-50" : "border-amber-400/20 bg-amber-500/10 text-amber-50";
  const latestRepairImportActions = latestRepairImport?.recommendations
    ?.slice(0, 3)
    .map((item) => t((repairRecommendationKeys[item.id as keyof typeof repairRecommendationKeys] || "onboarding.appleRemoteIcloudRepairRecReady") as TranslationKey))
    .join(" / ") || "";
  const simpleIcloudStatus = getSimpleIcloudStatus(icloud);
  const primaryIcloudAction = getPrimaryIcloudAction({ icloud, latestEntryRepair, pairingSession, syncReadiness, handoffHealth, canExportIcloud });
  const icloudTrackedFiles = icloudAvailability
    ? [
        { id: "html" as const, file: icloudAvailability.handoffFile },
        { id: "packet" as const, file: icloudAvailability.packetFile },
        { id: "index" as const, file: icloudAvailability.indexFile },
      ]
    : [];

  const analyzeRepairPacketText = async (text: string) => {
    const packet = text.trim();
    if (!packet) {
      setRepairError(t("onboarding.appleRemoteIcloudRepairEmpty"));
      setRepairAnalysis(null);
      setRepairRefresh(null);
      return;
    }
    setRepairBusy(true);
    setRepairError("");
    try {
      const result = await analyzeIcloudHandoffRepairPacket(packet);
      setRepairAnalysis(result.analysis);
      setRepairRefresh(result.icloudRefresh || null);
    } catch (error) {
      setRepairAnalysis(null);
      setRepairRefresh(null);
      setRepairError(t("onboarding.appleRemoteIcloudRepairFailed"));
    } finally {
      setRepairBusy(false);
    }
  };

  const handleAnalyzeRepair = () => {
    analyzeRepairPacketText(repairText);
  };

  const handlePasteAndAnalyzeRepair = async () => {
    if (typeof navigator === "undefined" || !navigator.clipboard?.readText) {
      setRepairAnalysis(null);
      setRepairError(t("onboarding.appleRemoteIcloudRepairClipboardUnavailable"));
      return;
    }
    setRepairError("");
    setRepairAnalysis(null);
    try {
      const packet = (await navigator.clipboard.readText()).trim();
      setRepairText(packet);
      await analyzeRepairPacketText(packet);
    } catch {
      setRepairAnalysis(null);
      setRepairError(t("onboarding.appleRemoteIcloudRepairClipboardFailed"));
    }
  };

  const renderIcloudFixActions = () => (
    <div className="mt-3 grid gap-2 sm:grid-cols-2">
      <button
        type="button"
        onClick={onExportIcloud}
        disabled={!canExportIcloud || isBusy}
        className="inline-flex items-center justify-center gap-2 rounded-xl border border-sky-300/20 bg-sky-500/10 px-3 py-2 text-xs font-bold text-sky-50 disabled:opacity-50"
      >
        {isIcloudBusy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}
        {t("onboarding.appleRemoteRefreshIcloud")}
      </button>
      <a
        href="/admin/devices/pair"
        className="inline-flex items-center justify-center gap-2 rounded-xl border border-amber-200/20 bg-black/15 px-3 py-2 text-xs font-bold text-amber-50"
      >
        <QrCode className="h-3.5 w-3.5" />
        {t("onboarding.appleRemoteOpenQr")}
      </a>
    </div>
  );

  const renderLatestEntryRepairUrls = (repair: IcloudLatestEntryRepair) => {
    const urls = compactLatestEntryRepairUrls(repair);
    if (!urls.length) return null;
    return (
      <div className="mt-2 grid gap-1 rounded-lg bg-[#060a10]/40 p-2 font-mono text-[10px] opacity-70">
        {urls.map((item) => (
          <div key={`${item.key}-${item.value}`} className="grid gap-0.5">
            <span className="font-sans text-[10px] font-bold opacity-80">{t(item.key)}</span>
            <span className="break-all">{item.value}</span>
          </div>
        ))}
      </div>
    );
  };

  const renderRepairRecommendationAction = (item: IcloudHandoffRepairAnalysis["recommendations"][number]) => {
    const label = t(repairRecommendationKeys[item.id]);
    const actionClass = "inline-flex w-full items-center justify-center gap-2 rounded-xl border px-3 py-2 text-left text-[11px] font-bold disabled:opacity-50";

    if (item.id === "refresh-icloud" || item.id === "open-latest-entry") {
      return (
        <button
          key={item.id}
          type="button"
          onClick={onExportIcloud}
          disabled={!canExportIcloud || isBusy}
          className={`${actionClass} border-sky-300/20 bg-sky-500/10 text-sky-50`}
        >
          {isIcloudBusy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5 shrink-0" />}
          <span>{label}</span>
        </button>
      );
    }

    if (item.id === "regenerate-qr") {
      return (
        <a
          key={item.id}
          href="/admin/devices/pair"
          className={`${actionClass} border-amber-200/20 bg-black/15 text-amber-50`}
        >
          <QrCode className="h-3.5 w-3.5 shrink-0" />
          <span>{label}</span>
        </a>
      );
    }

    if (item.id === "start-tailscale") {
      return tailscaleInstalled ? (
        <button
          key={item.id}
          type="button"
          onClick={onStartTailscale}
          disabled={isBusy}
          className={`${actionClass} border-blue-300/20 bg-blue-500/10 text-blue-100`}
        >
          {busy === "remote-tailscale" ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Wifi className="h-3.5 w-3.5 shrink-0" />}
          <span>{label}</span>
        </button>
      ) : (
        <a
          key={item.id}
          href={tailscaleInstallUrl}
          target="_blank"
          rel="noreferrer"
          className={`${actionClass} border-blue-300/20 bg-blue-500/10 text-blue-100`}
        >
          <ExternalLink className="h-3.5 w-3.5 shrink-0" />
          <span>{label}</span>
        </a>
      );
    }

    if (item.id === "start-cloudflare") {
      return (
        <button
          key={item.id}
          type="button"
          onClick={onStartCloudflare}
          disabled={isBusy}
          className={`${actionClass} border-white/[0.08] bg-white/[0.03] text-zinc-200`}
        >
          {busy === "remote-cloudflare" ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Cloud className="h-3.5 w-3.5 shrink-0" />}
          <span>{label}</span>
        </button>
      );
    }

    if (item.id === "save-stable-entry") {
      return (
        <button
          key={item.id}
          type="button"
          onClick={() => candidate && onSaveCandidate(candidate)}
          disabled={isBusy || !candidateReady}
          className={`${actionClass} border-emerald-400/20 bg-emerald-500/10 text-emerald-200`}
        >
          {busy === "remote-save" ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <ShieldCheck className="h-3.5 w-3.5 shrink-0" />}
          <span>{label}</span>
        </button>
      );
    }

    if (item.id === "test-phone-entry") {
      return (
        <button
          key={item.id}
          type="button"
          onClick={() => candidate && onTestCandidate(candidate)}
          disabled={isBusy || !candidateReady}
          className={`${actionClass} border-white/[0.08] bg-white/[0.03] text-zinc-200`}
        >
          {busy === "remote-test" ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <CheckCircle2 className="h-3.5 w-3.5 shrink-0" />}
          <span>{label}</span>
        </button>
      );
    }

    return (
      <div key={item.id} className="flex items-center gap-2 rounded-xl bg-black/15 p-2 text-[11px] font-bold">
        <CheckCircle2 className="h-3.5 w-3.5 shrink-0" />
        <span>{label}</span>
      </div>
    );
  };

  return (
    <section className="rounded-[28px] border border-sky-400/15 bg-[#101722] p-5">
      <div className="flex items-start justify-between gap-3">
        <div className="flex gap-3">
          <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl border border-sky-400/20 bg-sky-500/10 text-sky-200">
            <Wifi className="h-5 w-5" />
          </div>
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <h2 className="font-bold">{t("onboarding.appleRemoteTitle")}</h2>
              <span className="rounded-full border border-white/[0.08] bg-white/[0.04] px-2 py-0.5 text-[10px] font-bold text-sky-100">
                {appleRuntime ? t("onboarding.appleRemoteDetected") : t("onboarding.appleRemoteWorksElsewhere")}
              </span>
            </div>
            <p className="mt-2 text-sm leading-relaxed text-zinc-400">
              {t("onboarding.appleRemoteDescription")}
            </p>
          </div>
        </div>
        {readiness?.severity === "ok" ? <CheckCircle2 className="mt-1 h-5 w-5 shrink-0 text-emerald-300" /> : null}
      </div>

      <div className="mt-5 rounded-2xl border border-sky-400/15 bg-sky-500/10 p-4 text-xs leading-relaxed text-sky-50/85">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="font-bold text-sky-50">{t("onboarding.appleRemoteDefaultPath")}</div>
          <span className={`rounded-full bg-[#060a10]/55 px-2 py-0.5 text-[10px] font-bold ${readinessTone}`}>
            {readiness ? t(readinessStatusKeys[readiness.status]) : t("connection.readiness.status.localOnly")}
          </span>
        </div>
        <div className="mt-2 break-all font-mono text-[11px] text-sky-100/80">
          {candidate?.baseUrl || t("onboarding.appleRemoteNoCandidate")}
        </div>
        {candidate ? (
          <div className="mt-3 border-t border-sky-200/10 pt-3 text-sky-50/75">
            <div className="font-bold text-sky-50">{candidate.label}</div>
            <div className="mt-1">{candidate.notes[0] || t("onboarding.appleRemoteCandidateReady")}</div>
            {candidate.requiresRestart ? <div className="mt-1 text-amber-100">{t("onboarding.appleRemoteRestartNeeded")}</div> : null}
          </div>
        ) : null}
      </div>

      <div className="mt-3 rounded-2xl border border-white/[0.06] bg-white/[0.03] p-4 text-xs leading-relaxed text-zinc-400">
        <div className="flex gap-2">
          <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-emerald-300" />
          <span>{t("onboarding.appleRemoteIcloudHint")}</span>
        </div>
        <div className="mt-3 rounded-xl border border-cyan-300/15 bg-cyan-500/10 p-3 text-[11px] leading-relaxed text-cyan-50/80">
          <div className="flex gap-2">
            <Cloud className="mt-0.5 h-4 w-4 shrink-0 text-cyan-200" />
            <div>
              <div className="font-bold text-cyan-50">{t("onboarding.appleRemoteIcloudBoundaryTitle")}</div>
              <div className="mt-1">{t("onboarding.appleRemoteIcloudBoundaryBody")}</div>
              <div className="mt-1">{t("onboarding.appleRemoteIcloudDataBoundaryBody")}</div>
            </div>
          </div>
        </div>
        <div className="mt-3 rounded-xl border border-white/[0.06] bg-[#060a10]/45 p-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <span className="font-bold text-zinc-100">{t("onboarding.appleRemoteIcloudStatus")}</span>
            <span className={`rounded-full px-2 py-0.5 text-[10px] font-bold ${canExportIcloud ? "bg-emerald-500/15 text-emerald-100" : "bg-amber-500/15 text-amber-100"}`}>
              {canExportIcloud ? t("onboarding.appleRemoteIcloudReady") : t("onboarding.appleRemoteIcloudUnavailable")}
            </span>
          </div>
          <div className={`mt-3 rounded-xl border p-3 ${simpleIcloudStatus.tone}`}>
            <div className="flex gap-2">
              {simpleIcloudStatus.icon === "ready" ? <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" /> : simpleIcloudStatus.icon === "qr" ? <QrCode className="mt-0.5 h-4 w-4 shrink-0" /> : simpleIcloudStatus.icon === "refresh" ? <RefreshCw className="mt-0.5 h-4 w-4 shrink-0" /> : simpleIcloudStatus.icon === "warning" ? <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" /> : <Cloud className="mt-0.5 h-4 w-4 shrink-0" />}
              <div>
                <div className="font-bold">{t(simpleIcloudStatus.titleKey)}</div>
                <div className="mt-1 text-[11px] leading-relaxed opacity-80">{t(simpleIcloudStatus.bodyKey)}</div>
              </div>
            </div>
          </div>
          <div className={`mt-3 rounded-xl border p-3 ${primaryIcloudAction.tone}`}>
            <div className="flex gap-2">
              {primaryIcloudAction.icon === "ready" ? <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" /> : primaryIcloudAction.icon === "qr" ? <QrCode className="mt-0.5 h-4 w-4 shrink-0" /> : primaryIcloudAction.icon === "sync" ? <Cloud className="mt-0.5 h-4 w-4 shrink-0" /> : primaryIcloudAction.icon === "phone" ? <Smartphone className="mt-0.5 h-4 w-4 shrink-0" /> : primaryIcloudAction.icon === "warning" ? <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" /> : <RefreshCw className="mt-0.5 h-4 w-4 shrink-0" />}
              <div className="min-w-0 flex-1">
                <div className="font-bold">{t(primaryIcloudAction.titleKey)}</div>
                <div className="mt-1 text-[11px] leading-relaxed opacity-80">{t(primaryIcloudAction.bodyKey)}</div>
                {primaryIcloudAction.cta === "export" ? (
                  <button
                    type="button"
                    onClick={onExportIcloud}
                    disabled={!canExportIcloud || isBusy}
                    className="mt-3 inline-flex items-center justify-center gap-2 rounded-xl border border-current/15 bg-black/15 px-3 py-2 text-xs font-bold disabled:opacity-50"
                  >
                    {isIcloudBusy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}
                    {t("onboarding.appleRemoteRefreshIcloud")}
                  </button>
                ) : null}
                {primaryIcloudAction.cta === "qr" ? (
                  <a
                    href="/admin/devices/pair"
                    className="mt-3 inline-flex items-center justify-center gap-2 rounded-xl border border-current/15 bg-black/15 px-3 py-2 text-xs font-bold"
                  >
                    <QrCode className="h-3.5 w-3.5" />
                    {t("onboarding.appleRemoteOpenQr")}
                  </a>
                ) : null}
              </div>
            </div>
          </div>
          {syncReadiness ? (
            <div className={`mt-3 rounded-xl border p-3 ${syncReadinessTone}`}>
              <div className="flex gap-2">
                {syncReadiness.canOpenOnPhone ? <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" /> : syncReadiness.status === "syncing" ? <Loader2 className="mt-0.5 h-4 w-4 shrink-0 animate-spin" /> : <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />}
                <div>
                  <div className="font-bold">{t(icloudSyncReadinessKeys[syncReadiness.status])}</div>
                  <div className="mt-1 text-[11px] leading-relaxed opacity-80">
                    {t(icloudSyncActionKeys[syncReadiness.action], { count: syncReadiness.pendingCount, minutes: icloudSyncStuckMinutes })}
                  </div>
                </div>
              </div>
            </div>
          ) : null}
          {availableEntryCount > 1 ? (
            <div className="mt-3 rounded-xl border border-sky-400/15 bg-sky-500/10 p-3 text-[11px] leading-relaxed text-sky-50/80">
              <div className="font-bold text-sky-50">{t("onboarding.appleRemoteIcloudMultiDesktopTitle", { count: availableEntryCount })}</div>
              <div className="mt-1">{t("onboarding.appleRemoteIcloudMultiDesktopBody")}</div>
            </div>
          ) : null}
          {phoneConfirmation ? (
            <div className={`mt-3 rounded-xl border p-3 ${phoneConfirmationTone}`}>
              <div className="flex gap-2">
                {phoneConfirmation.severity === "ok" ? <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" /> : phoneConfirmation.status === "missing" ? <Cloud className="mt-0.5 h-4 w-4 shrink-0" /> : <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />}
                <div>
                  <div className="font-bold">{t(icloudPhoneConfirmationKeys[phoneConfirmation.status])}</div>
                  <div className="mt-1 text-[11px] leading-relaxed opacity-80">
                    {t(icloudPhoneConfirmationActionKeys[phoneConfirmation.action], {
                      device: phoneConfirmation.confirmedDeviceName || phoneConfirmation.confirmedDeviceId || "-",
                      time: phoneConfirmationAt || "-",
                    })}
                  </div>
                </div>
              </div>
            </div>
          ) : null}
          {pairingSession ? (
            <div className={`mt-3 rounded-xl border p-3 ${pairingSessionTone}`}>
              <div className="flex gap-2">
                {pairingSession.severity === "ok" ? <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" /> : <QrCode className="mt-0.5 h-4 w-4 shrink-0" />}
                <div>
                  <div className="font-bold">{t(icloudPairingSessionKeys[pairingSession.status])}</div>
                  <div className="mt-1 text-[11px] leading-relaxed opacity-80">
                    {t(icloudPairingSessionActionKeys[pairingSession.action], { seconds: pairingSession.secondsRemaining })}
                  </div>
                  {pairingSession.action === "regenerate-qr" || pairingSession.action === "create-qr" ? (
                    <div className="mt-3">
                      <a
                        href="/admin/devices/pair"
                        className="inline-flex items-center justify-center gap-2 rounded-xl border border-amber-200/20 bg-black/15 px-3 py-2 text-xs font-bold text-amber-50"
                      >
                        <QrCode className="h-3.5 w-3.5" />
                        {t("onboarding.appleRemoteOpenQr")}
                      </a>
                    </div>
                  ) : null}
                  {pairingSession.status === "address-changed" ? (
                    <div className="mt-2 grid gap-1 rounded-lg bg-[#060a10]/40 p-2 font-mono text-[10px] opacity-80">
                      <div>{pairingSession.baseUrl || "-"}</div>
                      <div>{pairingSession.expectedBaseUrl || "-"}</div>
                    </div>
                  ) : null}
                </div>
              </div>
            </div>
          ) : null}
          {icloudAcceptance ? (
            <div className={`mt-3 rounded-xl border p-3 ${icloudAcceptance.ready ? "border-emerald-400/20 bg-emerald-500/10 text-emerald-50" : "border-sky-400/20 bg-sky-500/10 text-sky-50"}`}>
              <div className="flex gap-2">
                <ClipboardCheck className="mt-0.5 h-4 w-4 shrink-0" />
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="font-bold">{t("onboarding.appleRemoteIcloudAcceptanceTitle")}</div>
                    <span className="rounded-full border border-current/15 bg-black/10 px-2 py-0.5 text-[10px] font-bold">
                      {icloudAcceptance.passed}/{icloudAcceptance.total}
                    </span>
                  </div>
                  <p className="mt-1 text-[11px] leading-relaxed opacity-80">
                    {icloudAcceptance.ready
                      ? t("onboarding.appleRemoteIcloudAcceptanceReady")
                      : t("onboarding.appleRemoteIcloudAcceptanceBody")}
                  </p>
                  <div className="mt-2 rounded-lg border border-current/10 bg-black/10 p-2 text-[11px] leading-relaxed">
                    {t(icloudAcceptanceActionKeys[icloudAcceptance.recommendedAction])}
                  </div>
                  <div className="mt-2 grid gap-1.5">
                    {icloudAcceptance.items
                      .filter((item) => item.status !== "passed")
                      .slice(0, 4)
                      .map((item) => (
                        <div key={item.id} className={`rounded-lg border px-2 py-1.5 text-[11px] ${icloudAcceptanceStatusTone(item.status)}`}>
                          <div className="flex flex-wrap items-center justify-between gap-2">
                            <span className="font-bold">{t(icloudAcceptanceItemKeys[item.id])}</span>
                            <span className="text-[10px] font-bold opacity-75">{t(`onboarding.appleRemoteIcloudAcceptanceStatus.${item.status}` as any)}</span>
                          </div>
                          <div className="mt-1 opacity-75">{item.evidence}</div>
                        </div>
                      ))}
                  </div>
                  {icloudAcceptance.nextReviewAt ? (
                    <div className="mt-2 text-[10px] opacity-70">
                      {t("onboarding.appleRemoteIcloudAcceptanceNextReview", { time: formatHandoffTime(icloudAcceptance.nextReviewAt) })}
                    </div>
                  ) : null}
                </div>
              </div>
            </div>
          ) : null}
          {latestEntryRepair && latestEntryRepair.status !== "none" ? (
            <div className={`mt-3 rounded-xl border p-3 ${latestEntryRepairTone}`}>
              <div className="flex gap-2">
                {latestEntryRepair.severity === "ok" ? <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" /> : <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />}
                <div className="min-w-0 flex-1">
                  <div className="font-bold">{t(latestEntryRepairStatusKeys[latestEntryRepair.status])}</div>
                  <div className="mt-1 text-[11px] leading-relaxed opacity-80">
                    {t("onboarding.appleRemoteIcloudRepairSummaryBody", {
                      device: latestEntryRepair.deviceName || latestEntryRepair.deviceId || "-",
                      time: latestRepairAt || "-",
                      kind: latestEntryRepair.eventType ? t(issueEventKindKeys[latestEntryRepair.eventType as keyof typeof issueEventKindKeys] || "onboarding.appleRemoteIcloudIssueKindCurrent") : "-",
                    })}
                  </div>
                  <div className="mt-2 rounded-lg border border-current/10 bg-black/10 p-2 text-[11px] font-bold">
                    {t(latestEntryRepairActionKeys[latestEntryRepair.action])}
                  </div>
                  {renderLatestEntryRepairUrls(latestEntryRepair)}
                  {latestEntryRepair.needsRefresh || latestEntryRepair.needsQr ? renderIcloudFixActions() : null}
                </div>
              </div>
            </div>
          ) : null}
          {latestRepairImport ? (
            <div className={`mt-3 rounded-xl border p-3 ${latestRepairImportTone}`}>
              <div className="flex gap-2">
                {latestRepairImport.severity === "ok" ? <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" /> : <ClipboardPaste className="mt-0.5 h-4 w-4 shrink-0" />}
                <div className="min-w-0 flex-1">
                  <div className="font-bold">{t("onboarding.appleRemoteIcloudRepairImportTitle")}</div>
                  <div className="mt-1 text-[11px] leading-relaxed opacity-80">
                    {t("onboarding.appleRemoteIcloudRepairImportBody", {
                      time: latestRepairImportAt || "-",
                      entry: latestRepairImport.parsed.entryBaseUrl || "-",
                      reason: t(repairReasonKeys[latestRepairImport.reason as keyof typeof repairReasonKeys] || "onboarding.appleRemoteIcloudRepairReasonInvalid"),
                    })}
                  </div>
                  {latestRepairImportActions ? (
                    <div className="mt-2 rounded-lg border border-current/10 bg-black/10 p-2 text-[11px] font-bold">
                      {t("onboarding.appleRemoteIcloudRepairImportAction", { actions: latestRepairImportActions })}
                    </div>
                  ) : null}
                </div>
              </div>
            </div>
          ) : null}
          <details className="mt-3 rounded-xl border border-white/[0.06] bg-[#060a10]/30 p-3 text-[11px] text-zinc-500">
            <summary className="cursor-pointer font-bold text-zinc-200">{t("onboarding.appleRemoteIcloudAdvancedDiagnostics")}</summary>
            <div className="mt-3 break-all font-mono text-[11px] text-zinc-500">
              {icloud?.handoffFilePath || icloud?.openInstruction || t("onboarding.appleRemoteIcloudNoPath")}
            </div>
            {icloudAvailability ? (
              <div className="mt-3 rounded-xl border border-white/[0.06] bg-[#060a10]/30 p-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="font-bold text-zinc-100">{t("onboarding.appleRemoteIcloudAvailabilityTitle")}</span>
                  <span className={`rounded-full px-2 py-0.5 text-[10px] font-bold ${icloudAvailabilityTone}`}>
                    {t(icloudAvailabilityKeys[icloudAvailability.status])}
                  </span>
                </div>
                {icloudAvailability.status === "sync-pending" ? (
                  <div className="mt-2 text-[11px] leading-relaxed text-amber-100">
                    {t("onboarding.appleRemoteIcloudAvailabilityPendingBody", { count: icloudAvailability.pendingCount })}
                  </div>
                ) : null}
                {icloudAvailability.status === "sync-stuck" ? (
                  <div className="mt-2 text-[11px] leading-relaxed text-amber-100">
                    {t("onboarding.appleRemoteIcloudAvailabilityStuckBody", { count: icloudAvailability.syncStuckCount, minutes: icloudSyncStuckMinutes })}
                  </div>
                ) : null}
                {icloudAvailability.status === "sync-service-unavailable" ? (
                  <div className="mt-2 text-[11px] leading-relaxed text-amber-100">
                    {t("onboarding.appleRemoteIcloudAvailabilityServiceBody")}
                  </div>
                ) : null}
                {icloudAvailability.status === "account-unavailable" ? (
                  <div className="mt-2 text-[11px] leading-relaxed text-red-100">
                    {t("onboarding.appleRemoteIcloudAvailabilityAccountBody")}
                  </div>
                ) : null}
                {icloudAvailability.status === "read-only" ? (
                  <div className="mt-2 text-[11px] leading-relaxed text-red-100">
                    {t("onboarding.appleRemoteIcloudAvailabilityReadOnlyBody")}
                  </div>
                ) : null}
                {icloudAvailability.account?.checked ? (
                  <div className="mt-2 text-[10px] leading-relaxed text-zinc-500">
                    {t("onboarding.appleRemoteIcloudAvailabilityAccountLine")}: {t(icloudAccountStatusKeys[icloudAvailability.account.status])}
                    {icloudAvailability.account.error ? ` (${icloudAvailability.account.error})` : ""}
                  </div>
                ) : null}
                {icloudAvailability.syncService?.checked ? (
                  <div className="mt-2 text-[10px] leading-relaxed text-zinc-500">
                    {t("onboarding.appleRemoteIcloudAvailabilityServiceLine")}: {icloudAvailability.syncService.running ? t("onboarding.appleRemoteIcloudAvailabilityServiceRunning") : t("onboarding.appleRemoteIcloudAvailabilityServiceStopped")}
                    {icloudAvailability.syncService.processNames.length ? ` (${icloudAvailability.syncService.processNames.join(", ")})` : ""}
                  </div>
                ) : null}
                <div className="mt-3 rounded-xl border border-white/[0.06] bg-black/10 p-2">
                  <div className="mb-2 font-bold text-zinc-200">{t("onboarding.appleRemoteIcloudFileTitle")}</div>
                  <div className="grid gap-1.5">
                    {icloudTrackedFiles.map(({ id, file }) => (
                      <div key={id} className={`rounded-lg border px-2 py-1.5 text-[10px] leading-relaxed ${icloudFileTone(file)}`}>
                        <div className="flex flex-wrap items-center justify-between gap-2">
                          <span className="font-bold">{t(icloudFileLabelKeys[id])}</span>
                          <span className="font-bold">{t(icloudFileStateKeys[file.state])}</span>
                        </div>
                        <div className="mt-1 opacity-75">
                          {t("onboarding.appleRemoteIcloudMetadataState")}: {t(icloudMetadataSyncStateKeys[file.metadata.syncState])}
                          {file.size ? ` · ${Math.round(file.size / 1024)}KB` : ""}
                        </div>
                        {file.placeholderPath ? (
                          <div className="mt-1 break-all opacity-75">
                            {t("onboarding.appleRemoteIcloudFilePlaceholder", { name: file.placeholderPath })}
                          </div>
                        ) : null}
                        {file.syncStuck ? (
                          <div className="mt-1 font-bold text-amber-100">{t("onboarding.appleRemoteIcloudFileSyncStuck")}</div>
                        ) : null}
                        {file.metadata.error ? (
                          <div className="mt-1 break-all text-red-100">{file.metadata.error}</div>
                        ) : null}
                      </div>
                    ))}
                  </div>
                  {icloudAvailability.placeholderSamples.length ? (
                    <div className="mt-2 break-all text-[10px] leading-relaxed text-amber-100/80">
                      {t("onboarding.appleRemoteIcloudFilePlaceholderSamples", { names: icloudAvailability.placeholderSamples.join(", ") })}
                    </div>
                  ) : null}
                </div>
              </div>
            ) : null}
            {handoffHealth ? (
              <div className="mt-3 border-t border-white/[0.06] pt-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="font-bold text-zinc-100">{t("onboarding.appleRemoteIcloudHealthTitle")}</span>
                  <span className={`rounded-full px-2 py-0.5 text-[10px] font-bold ${handoffHealthTone}`}>
                    {t(handoffHealthStatusKeys[handoffHealth.status])}
                  </span>
                </div>
                <div className="mt-2 grid gap-1 text-[11px] text-zinc-500">
                  <div>{t("onboarding.appleRemoteIcloudDesktop")}: {icloud?.desktopName || "-"}</div>
                  <div>{t("onboarding.appleRemoteIcloudChooseFile")}: {icloud?.indexFilePath || "-"}</div>
                  <div>{t("onboarding.appleRemoteIcloudLastExported")}: {lastExportedAt || t("onboarding.appleRemoteIcloudNeverExported")}</div>
                  <div>{t("onboarding.appleRemoteIcloudRefreshAfter")}: {refreshAfter || "-"}</div>
                  <div>{t("onboarding.appleRemoteIcloudReason")}: {t(handoffHealthReasonKeys[handoffHealth.status])}</div>
                </div>
              </div>
            ) : null}
            {indexConsistency ? (
              <div className="mt-3 border-t border-white/[0.06] pt-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="font-bold text-zinc-100">{t("onboarding.appleRemoteIcloudIndexTitle")}</span>
                  <span className={`rounded-full px-2 py-0.5 text-[10px] font-bold ${icloudIndexTone}`}>
                    {t(icloudIndexConsistencyKeys[indexConsistency.status])}
                  </span>
                </div>
                <div className="mt-2 grid gap-1 text-[11px] text-zinc-500">
                  <div>{t("onboarding.appleRemoteIcloudIndexEntries")}: {indexConsistency.entryCount} / {indexConsistency.expectedEntryCount}</div>
                  <div>{t("onboarding.appleRemoteIcloudIndexGenerated")}: {formatHandoffTime(indexConsistency.generatedAt) || "-"}</div>
                  <div>{t("onboarding.appleRemoteIcloudIndexLatestEntry")}: {formatHandoffTime(indexConsistency.expectedLatestEntryGeneratedAt) || "-"}</div>
                </div>
                {!indexConsistency.ok ? (
                  <div className="mt-2 rounded-lg border border-amber-400/20 bg-amber-500/10 p-2 text-[11px] leading-relaxed text-amber-50">
                    {t("onboarding.appleRemoteIcloudIndexRefreshBody")}
                  </div>
                ) : null}
              </div>
            ) : null}
            {icloudMonitor ? (
              <div className="mt-3 border-t border-white/[0.06] pt-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="font-bold text-zinc-100">{t("onboarding.appleRemoteIcloudMonitorTitle")}</span>
                  <span className={`rounded-full px-2 py-0.5 text-[10px] font-bold ${icloudMonitor.running ? "bg-emerald-500/15 text-emerald-100" : icloudMonitor.enabled ? "bg-amber-500/15 text-amber-100" : "bg-zinc-500/15 text-zinc-200"}`}>
                    {icloudMonitor.running ? t("onboarding.appleRemoteIcloudMonitorRunning") : icloudMonitor.enabled ? t("onboarding.appleRemoteIcloudMonitorIdle") : t("onboarding.appleRemoteIcloudMonitorDisabled")}
                  </span>
                </div>
                <div className="mt-2 grid gap-1 text-[11px] text-zinc-500">
                  <div>{t("onboarding.appleRemoteIcloudMonitorInterval")}: {icloudMonitorIntervalSeconds}s</div>
                  <div>{t("onboarding.appleRemoteIcloudMonitorStartedAt")}: {icloudMonitorStartedAt || t("onboarding.appleRemoteIcloudNeverExported")}</div>
                  <div>{t("onboarding.appleRemoteIcloudMonitorStartupRun")}: {icloudMonitorStartupRunAt || t("onboarding.appleRemoteIcloudNeverExported")}</div>
                  {icloudMonitor.startupResult ? (
                    <>
                      <div>
                        {t("onboarding.appleRemoteIcloudMonitorStartupResult")}:{" "}
                        {icloudMonitor.startupResult.error
                          ? t("onboarding.appleRemoteIcloudMonitorResultFailed")
                          : icloudMonitor.startupResult.refreshed
                            ? t("onboarding.appleRemoteIcloudMonitorResultRefreshed")
                            : t("onboarding.appleRemoteIcloudMonitorResultFresh")}{" "}
                        ({icloudMonitor.startupResult.refreshReason} / {icloudMonitor.startupResult.status})
                      </div>
                      <div>
                        {t("onboarding.appleRemoteIcloudMonitorTrigger")}: {t(monitorTriggerKey(icloudMonitor.startupResult.trigger))}
                      </div>
                      {icloudMonitor.startupResult.changeType ? (
                        <div>
                          {t("onboarding.appleRemoteIcloudMonitorChange")}: {t(historyChangeTypeKeys[icloudMonitor.startupResult.changeType] || "onboarding.appleRemoteIcloudHistoryUnknown")}
                        </div>
                      ) : null}
                    </>
                  ) : null}
                  <div>{t("onboarding.appleRemoteIcloudMonitorLastRun")}: {icloudMonitorLastRunAt || t("onboarding.appleRemoteIcloudNeverExported")}</div>
                  <div>{t("onboarding.appleRemoteIcloudMonitorNextRun")}: {icloudMonitorNextRunAt || "-"}</div>
                  {icloudMonitor.lastResult ? (
                    <>
                      <div>
                        {t("onboarding.appleRemoteIcloudMonitorLastResult")}:{" "}
                        {icloudMonitor.lastResult.error
                          ? t("onboarding.appleRemoteIcloudMonitorResultFailed")
                          : icloudMonitor.lastResult.refreshed
                            ? t("onboarding.appleRemoteIcloudMonitorResultRefreshed")
                            : t("onboarding.appleRemoteIcloudMonitorResultFresh")}{" "}
                        ({icloudMonitor.lastResult.refreshReason} / {icloudMonitor.lastResult.status})
                      </div>
                      <div>
                        {t("onboarding.appleRemoteIcloudMonitorTrigger")}: {t(monitorTriggerKey(icloudMonitor.lastResult.trigger))}
                      </div>
                      {icloudMonitor.lastResult.changeType ? (
                        <div>
                          {t("onboarding.appleRemoteIcloudMonitorChange")}: {t(historyChangeTypeKeys[icloudMonitor.lastResult.changeType] || "onboarding.appleRemoteIcloudHistoryUnknown")}
                        </div>
                      ) : null}
                    </>
                  ) : null}
                  {icloudMonitor.lastResult?.phoneConfirmationStatus || icloudMonitor.lastResult?.previousPhoneConfirmationStatus ? (
                    <div>
                      {t("onboarding.appleRemoteIcloudMonitorPhoneConfirmation")}: {icloudMonitor.lastResult.previousPhoneConfirmationStatus || icloudMonitor.lastResult.phoneConfirmationStatus} / {icloudMonitor.lastResult.phoneConfirmationAction || "-"}
                    </div>
                  ) : null}
                  {icloudMonitor.lastResult?.pairingSessionStatus || icloudMonitor.lastResult?.previousPairingSessionStatus ? (
                    <div>
                      {t("onboarding.appleRemoteIcloudMonitorPairingSession")}: {icloudMonitor.lastResult.previousPairingSessionStatus || icloudMonitor.lastResult.pairingSessionStatus} / {icloudMonitor.lastResult.pairingSessionAction || "-"}
                    </div>
                  ) : null}
                  {icloudMonitor.lastResult?.indexConsistencyStatus || icloudMonitor.lastResult?.previousIndexConsistencyStatus ? (
                    <div>
                      {t("onboarding.appleRemoteIcloudMonitorIndexConsistency")}: {icloudMonitor.lastResult.previousIndexConsistencyStatus || "-"} / {icloudMonitor.lastResult.indexConsistencyStatus || "-"}
                    </div>
                  ) : null}
                  {icloudMonitor.lastResult?.syncReadinessStatus ? (
                    <div>
                      {t("onboarding.appleRemoteIcloudMonitorSyncReadiness")}: {icloudMonitor.lastResult.syncReadinessStatus} / {icloudMonitor.lastResult.syncReadinessAction || "-"}
                    </div>
                  ) : null}
                  {icloudMonitor.lastResult?.recommendedBaseUrl ? (
                    <div className="break-all">
                      {t("onboarding.appleRemoteIcloudMonitorLastEntry")}: {icloudMonitor.lastResult.recommendedBaseUrl}
                    </div>
                  ) : null}
                  {icloudMonitor.lastResult?.error ? (
                    <div className="text-red-200">{t("onboarding.appleRemoteIcloudMonitorError")}: {icloudMonitor.lastResult.error}</div>
                  ) : null}
                </div>
              </div>
            ) : null}
            {icloudLifecycle ? (
              <div className="mt-3 border-t border-white/[0.06] pt-3">
                <div className="font-bold text-zinc-200">{t("onboarding.appleRemoteIcloudLifecycleTitle")}</div>
                <div className="mt-2 grid gap-1 text-[11px] text-zinc-500">
                  <div>{t("onboarding.appleRemoteIcloudLifecycleEntryCount")}: {icloudLifecycle.entryCount}</div>
                  <div>{t("onboarding.appleRemoteIcloudLifecycleExpiredCount")}: {icloudLifecycle.expiredEntryCount}</div>
                  <div>{t("onboarding.appleRemoteIcloudLifecyclePrunableCount")}: {icloudLifecycle.prunableEntryCount}</div>
                  <div>{t("onboarding.appleRemoteIcloudLifecycleOrphanedCount")}: {icloudLifecycle.orphanedFileCount}</div>
                </div>
                {icloudLifecycle.prunableEntryCount > 0 ? (
                  <div className="mt-2 rounded-lg border border-amber-400/20 bg-amber-500/10 p-2 text-[11px] leading-relaxed text-amber-50">
                    {t("onboarding.appleRemoteIcloudLifecycleCleanupHint")}
                  </div>
                ) : null}
                {icloudLifecycle.prunableEntryCount > 0 || icloudLifecycle.orphanedFileCount > 0 ? (
                  <button
                    type="button"
                    onClick={onCleanupIcloud}
                    disabled={isBusy}
                    className="mt-3 inline-flex w-full items-center justify-center gap-2 rounded-xl border border-amber-300/20 bg-amber-500/10 px-3 py-2 text-xs font-bold text-amber-50 disabled:opacity-50"
                  >
                    {isIcloudCleanupBusy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}
                    {isIcloudCleanupBusy ? t("onboarding.appleRemoteIcloudCleanupCleaning") : t("onboarding.appleRemoteIcloudCleanupButton")}
                  </button>
                ) : null}
              </div>
            ) : null}
            {availableEntries.length ? (
              <div className="mt-3 border-t border-white/[0.06] pt-3">
                <div className="font-bold text-zinc-200">{t("onboarding.appleRemoteIcloudEntriesTitle")}</div>
                <div className="mt-2 grid gap-2">
                  {availableEntries.map((entry) => {
                    const state = icloudEntryState(entry);
                    const isCurrentDesktop = entry.desktopId === icloud?.desktopId;
                    return (
                      <div key={`${entry.desktopId}-${entry.generatedAt}`} className="rounded-lg border border-white/[0.05] bg-white/[0.03] p-2">
                        <div className="flex flex-wrap items-center justify-between gap-2">
                          <div className="font-bold text-zinc-200">
                            {entry.desktopName}
                            {isCurrentDesktop ? <span className="ml-2 text-[10px] text-sky-200">{t("onboarding.appleRemoteIcloudEntryCurrent")}</span> : null}
                          </div>
                          <span className={`rounded-full px-2 py-0.5 text-[10px] font-bold ${state.className}`}>
                            {t(state.key)}
                          </span>
                        </div>
                        <div className="mt-1 break-all font-mono text-[10px] text-zinc-400">{entry.baseUrl}</div>
                        <div className="mt-1 flex flex-wrap gap-x-3 gap-y-1 text-[10px] text-zinc-500">
                          <span>{t("onboarding.appleRemoteIcloudEntryGenerated")}: {formatHandoffTime(entry.generatedAt) || "-"}</span>
                          <span>{t("onboarding.appleRemoteIcloudEntryRefreshAfter")}: {formatHandoffTime(entry.refreshAfter) || "-"}</span>
                          <span>{t("onboarding.appleRemoteIcloudEntryExpires")}: {formatHandoffTime(entry.expiresAt) || "-"}</span>
                        </div>
                        <div className="mt-1 text-[10px] text-zinc-500">
                          {entry.mode || "-"} · {entry.stability || "-"} · {entry.secure ? "HTTPS" : "HTTP/LAN"}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            ) : null}
            {latestHistory.length ? (
              <div className="mt-3 border-t border-white/[0.06] pt-3">
                <div className="font-bold text-zinc-200">{t("onboarding.appleRemoteIcloudHistoryTitle")}</div>
                <div className="mt-2 grid gap-2">
                  {latestHistory.map((item) => (
                    <div key={`${item.desktopId}-${item.generatedAt}`} className="rounded-lg bg-white/[0.03] p-2">
                      <div className="font-bold text-zinc-200">{item.desktopName}</div>
                      <div className="break-all font-mono text-[10px]">{item.baseUrl}</div>
                      <div className="text-[10px] text-zinc-500">
                        {t("onboarding.appleRemoteIcloudHistoryCurrentVersion", {
                          mode: item.mode || "-",
                          stability: item.stability || "-",
                          count: item.fallbackCandidateCount || 0,
                        })}
                      </div>
                      {item.previousBaseUrl && item.previousBaseUrl !== item.baseUrl ? (
                        <div className="break-all font-mono text-[10px] text-zinc-500">{t("onboarding.appleRemoteIcloudHistoryPrevious")}: {item.previousBaseUrl}</div>
                      ) : null}
                      {item.previousGeneratedAt ? (
                        <div className="text-[10px] text-zinc-500">
                          {t("onboarding.appleRemoteIcloudHistoryPreviousVersion", {
                            mode: item.previousMode || "-",
                            stability: item.previousStability || "-",
                            count: item.previousFallbackCandidateCount || 0,
                            time: formatHandoffTime(item.previousGeneratedAt),
                          })}
                        </div>
                      ) : null}
                      <div>{formatHandoffTime(item.generatedAt)} · {t(historyChangeTypeKeys[item.changeType] || "onboarding.appleRemoteIcloudHistoryUnknown")} · {item.reason}</div>
                    </div>
                  ))}
                </div>
              </div>
            ) : null}
          </details>
          <details className="mt-3 rounded-xl border border-white/[0.06] bg-[#060a10]/30 p-3 text-[11px] text-zinc-500">
            <summary className="cursor-pointer font-bold text-zinc-200">{t("onboarding.appleRemoteIcloudRepairTitle")}</summary>
            <p className="mt-2 leading-relaxed">{t("onboarding.appleRemoteIcloudRepairBody")}</p>
            <textarea
              value={repairText}
              onChange={(event) => setRepairText(event.target.value)}
              placeholder={t("onboarding.appleRemoteIcloudRepairPlaceholder")}
              className="mt-3 min-h-28 w-full resize-y rounded-xl border border-white/[0.08] bg-black/20 p-3 font-mono text-[11px] text-zinc-200 outline-none focus:border-sky-300/40"
            />
            <div className="mt-3 grid gap-2 sm:grid-cols-2">
              <button
                type="button"
                onClick={handlePasteAndAnalyzeRepair}
                disabled={repairBusy}
                className="inline-flex w-full items-center justify-center gap-2 rounded-xl border border-sky-400/20 bg-sky-500/10 px-4 py-2.5 text-xs font-bold text-sky-100 disabled:opacity-50"
              >
                {repairBusy ? <Loader2 className="h-4 w-4 animate-spin" /> : <ClipboardPaste className="h-4 w-4" />}
                {repairBusy ? t("onboarding.appleRemoteIcloudRepairAnalyzing") : t("onboarding.appleRemoteIcloudRepairPasteAnalyze")}
              </button>
              <button
                type="button"
                onClick={handleAnalyzeRepair}
                disabled={repairBusy}
                className="inline-flex w-full items-center justify-center gap-2 rounded-xl border border-white/[0.08] bg-white/[0.03] px-4 py-2.5 text-xs font-bold text-zinc-200 disabled:opacity-50"
              >
                {repairBusy ? <Loader2 className="h-4 w-4 animate-spin" /> : <ShieldCheck className="h-4 w-4" />}
                {repairBusy ? t("onboarding.appleRemoteIcloudRepairAnalyzing") : t("onboarding.appleRemoteIcloudRepairAnalyze")}
              </button>
            </div>
            {repairError ? <div className="mt-2 rounded-lg border border-red-400/20 bg-red-500/10 p-2 text-red-100">{repairError}</div> : null}
            {repairRefresh ? (
              <div className={`mt-3 rounded-xl border p-3 text-[11px] leading-relaxed ${
                repairRefresh.refreshed
                  ? "border-emerald-400/20 bg-emerald-500/10 text-emerald-50"
                  : repairRefresh.reason === "not-needed" || repairRefresh.reason === "fresh"
                  ? "border-sky-400/20 bg-sky-500/10 text-sky-50"
                  : "border-amber-400/20 bg-amber-500/10 text-amber-50"
              }`}>
                <div className="flex gap-2">
                  {repairRefresh.refreshed ? <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" /> : <RefreshCw className="mt-0.5 h-4 w-4 shrink-0" />}
                  <div>
                    <div className="font-bold">
                      {repairRefresh.refreshed
                        ? t("onboarding.appleRemoteIcloudRepairAutoRefreshDone")
                        : repairRefresh.reason === "not-needed" || repairRefresh.reason === "fresh"
                        ? t("onboarding.appleRemoteIcloudRepairAutoRefreshSkipped")
                        : t("onboarding.appleRemoteIcloudRepairAutoRefreshBlocked")}
                    </div>
                    <div className="mt-1 opacity-80">
                      {t("onboarding.appleRemoteIcloudRepairAutoRefreshReason", { reason: repairRefresh.reason })}
                    </div>
                  </div>
                </div>
              </div>
            ) : null}
            {repairAnalysis ? (
              <div className={`mt-3 rounded-xl border p-3 ${repairAnalysis.severity === "danger" ? "border-red-400/20 bg-red-500/10 text-red-50" : repairAnalysis.severity === "warning" ? "border-amber-400/20 bg-amber-500/10 text-amber-50" : "border-emerald-400/20 bg-emerald-500/10 text-emerald-50"}`}>
                <div className="font-bold">{t("onboarding.appleRemoteIcloudRepairResult")}: {t(repairReasonKeys[repairAnalysis.reason])}</div>
                <div className="mt-2 grid gap-1 break-all font-mono text-[10px] opacity-80">
                  <div>{t("onboarding.appleRemoteIcloudRepairPhoneEntry")}: {repairAnalysis.parsed.entryBaseUrl || "-"}</div>
                  <div>{t("onboarding.appleRemoteIcloudRepairDesktopEntry")}: {repairAnalysis.desktop.recommendedBaseUrl || "-"}</div>
                </div>
                <div className="mt-3 text-[11px] font-bold opacity-80">{t("onboarding.appleRemoteIcloudRepairActions")}</div>
                <div className="mt-2 grid gap-2 sm:grid-cols-2">
                  {repairAnalysis.recommendations.map((item) => (
                    renderRepairRecommendationAction(item)
                  ))}
                </div>
              </div>
            ) : null}
          </details>
        </div>
      </div>

      <div className="mt-5 grid gap-3">
        <button
          type="button"
          onClick={onExportIcloud}
          disabled={!canExportIcloud || isBusy}
          className="inline-flex w-full items-center justify-center gap-2 rounded-xl bg-sky-400 px-4 py-3 text-sm font-bold text-[#061016] disabled:opacity-50"
        >
          {isIcloudBusy ? <Loader2 className="h-4 w-4 animate-spin" /> : handoffHealth?.needsRefresh ? <RefreshCw className="h-4 w-4" /> : <Cloud className="h-4 w-4" />}
          {isIcloudBusy ? t("onboarding.appleRemoteIcloudSyncing") : canExportIcloud ? (handoffHealth?.needsRefresh ? t("onboarding.appleRemoteRefreshIcloud") : t("onboarding.appleRemoteExportIcloud")) : t("onboarding.appleRemoteIcloudDisabled")}
        </button>

        <div className="grid gap-3 sm:grid-cols-2">
          <button
            type="button"
            onClick={() => candidate && onSaveCandidate(candidate)}
            disabled={isBusy || !candidateReady}
            className="inline-flex items-center justify-center gap-2 rounded-xl border border-emerald-400/20 bg-emerald-500/10 px-4 py-3 text-sm font-bold text-emerald-200 disabled:opacity-50"
          >
            {busy === "remote-save" ? <Loader2 className="h-4 w-4 animate-spin" /> : <ShieldCheck className="h-4 w-4" />}
            {t("onboarding.appleRemoteSaveDefault")}
          </button>
          <button
            type="button"
            onClick={() => candidate && onTestCandidate(candidate)}
            disabled={isBusy || !candidateReady}
            className="inline-flex items-center justify-center gap-2 rounded-xl border border-white/[0.08] bg-white/[0.03] px-4 py-3 text-sm font-bold text-zinc-200 disabled:opacity-50"
          >
            {busy === "remote-test" ? <Loader2 className="h-4 w-4 animate-spin" /> : <CheckCircle2 className="h-4 w-4" />}
            {t("onboarding.appleRemoteTestDefault")}
          </button>
        </div>

        <details className="rounded-2xl border border-white/[0.08] bg-white/[0.03] p-3">
          <summary className="cursor-pointer text-xs font-bold text-zinc-300">{t("onboarding.appleRemoteFallbackSummary")}</summary>
          <div className="mt-3 grid gap-3">
            <p className="text-xs leading-relaxed text-zinc-500">{t("onboarding.appleRemoteFallbackBody")}</p>
            {tailscaleInstalled ? (
              <button
                type="button"
                onClick={onStartTailscale}
                disabled={isBusy}
                className="inline-flex w-full items-center justify-center gap-2 rounded-xl border border-blue-300/20 bg-blue-500/10 px-4 py-3 text-sm font-bold text-blue-100 disabled:opacity-50"
              >
                {busy === "remote-tailscale" ? <Loader2 className="h-4 w-4 animate-spin" /> : <Wifi className="h-4 w-4" />}
                {t("onboarding.appleRemoteStartTailscale")}
              </button>
            ) : (
              <a
                href={tailscaleInstallUrl}
                target="_blank"
                rel="noreferrer"
                className="inline-flex w-full items-center justify-center gap-2 rounded-xl border border-blue-300/20 bg-blue-500/10 px-4 py-3 text-sm font-bold text-blue-100"
              >
                <ExternalLink className="h-4 w-4" />
                {t("onboarding.appleRemoteInstallTailscale")}
              </a>
            )}
            <button
              type="button"
              onClick={onStartCloudflare}
              disabled={isBusy}
              className="inline-flex w-full items-center justify-center gap-2 rounded-xl border border-white/[0.08] bg-white/[0.03] px-4 py-3 text-sm font-bold text-zinc-200 disabled:opacity-50"
            >
              {busy === "remote-cloudflare" ? <Loader2 className="h-4 w-4 animate-spin" /> : <Cloud className="h-4 w-4" />}
              {t("onboarding.appleRemoteStartCloudflare")}
            </button>
          </div>
        </details>

        <div className="grid gap-3 sm:grid-cols-2">
          <a
            href="/admin/devices/pair"
            className="inline-flex items-center justify-center gap-2 rounded-xl border border-sky-400/20 bg-sky-500/10 px-4 py-3 text-sm font-bold text-sky-200"
          >
            <QrCode className="h-4 w-4" />
            {t("onboarding.appleRemoteOpenQr")}
          </a>
          <a
            href="/admin/settings#mobile-connect"
            className="inline-flex items-center justify-center gap-2 rounded-xl border border-white/[0.08] bg-white/[0.03] px-4 py-3 text-sm font-bold text-zinc-200"
          >
            <ArrowRight className="h-4 w-4" />
            {t("onboarding.appleRemoteAdvanced")}
          </a>
        </div>
        <div className="flex items-center gap-2 text-[11px] leading-relaxed text-zinc-500">
          <Smartphone className="h-3.5 w-3.5 shrink-0" />
          <span>{t("onboarding.appleRemotePairAfterSave")}</span>
        </div>
      </div>
    </section>
  );
}
