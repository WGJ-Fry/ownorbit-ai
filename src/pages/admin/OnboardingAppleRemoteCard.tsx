import { useState, type ReactNode } from "react";
import { AlertTriangle, ArrowRight, CheckCircle2, ClipboardCheck, ClipboardPaste, Cloud, ExternalLink, Loader2, QrCode, RefreshCw, ShieldCheck, Smartphone, UploadCloud, Wifi } from "lucide-react";
import { analyzeIcloudHandoffRepairPacket, applyCloudKitSyncQuarantine, getCloudKitSyncBatchPreview, getCloudKitSyncQuarantine, recordIcloudAcceptance, runCloudKitDataSyncHelper, runCloudKitSyncChangesPreview, runCloudKitSyncCycle, runCloudKitSyncExport, runCloudKitSyncImportPreview, runCloudKitSyncImportQuarantine, runCloudKitSyncNow, runCloudKitSyncUploadNow } from "../../services/lifeosApi";
import type { CloudKitNativeHelperResult, CloudKitSyncApplyResult, CloudKitSyncBatchPreview, CloudKitSyncCheckpoint, CloudKitSyncCycleResult, CloudKitSyncExportSummary, CloudKitSyncNowResult, CloudKitSyncQuarantineItem, CloudKitSyncQuarantineSummary, CloudKitSyncUploadNowResult, IcloudAutoRefreshResult, IcloudHandoffRepairAnalysis, NetworkDiagnostics } from "../../services/lifeosApi";
import { useI18n } from "../../i18n/I18nProvider";
import type { TranslationKey } from "../../i18n/translations";
import { getIcloudActionFollowupKey, getPrimaryIcloudAction } from "./appleRemoteIcloudPrimaryAction";

type ConnectionCandidate = NetworkDiagnostics["connectionCandidates"][number];
type IcloudAvailability = NetworkDiagnostics["icloud"]["availability"];
type IcloudFileState = IcloudAvailability["handoffFile"];
type IcloudFileId = "html" | "packet" | "index";
type IcloudAvailableEntry = NetworkDiagnostics["icloud"]["availableEntries"][number];
type CloudKitQuarantineNextAction = "apply" | "load" | "sync-now";

type Props = {
  diagnostics: NetworkDiagnostics | null;
  busy: string | null;
  onExportIcloud: () => void;
  onCleanupIcloud: () => void;
  onStartTailscale: () => void;
  onStartCloudflare: () => void;
  onSaveCandidate: (candidate: ConnectionCandidate) => void;
  onTestCandidate: (candidate: ConnectionCandidate) => void;
  onOpenIcloudSettings?: () => void;
  onOpenIcloudFolder?: () => void;
  onDiagnostics?: (diagnostics: NetworkDiagnostics) => void;
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

const cloudKitSyncNowNextActionKeys: Record<CloudKitSyncNowResult["nextAction"], TranslationKey> = {
  "configure-cloudkit": "onboarding.appleRemoteIcloudDataSyncNowNextConfigure",
  "wait-for-icloud": "onboarding.appleRemoteIcloudDataSyncNowNextWait",
  "review-conflicts": "onboarding.appleRemoteIcloudDataSyncNowNextReview",
  "run-again": "onboarding.appleRemoteIcloudDataSyncNowNextRunAgain",
  retry: "onboarding.appleRemoteIcloudDataSyncNowNextRetry",
  done: "onboarding.appleRemoteIcloudDataSyncNowNextDone",
};

const cloudKitSyncUploadNowNextActionKeys: Record<CloudKitSyncUploadNowResult["nextAction"], TranslationKey> = {
  "configure-cloudkit": "onboarding.appleRemoteIcloudDataSyncUploadNowNextConfigure",
  "add-local-data": "onboarding.appleRemoteIcloudDataSyncUploadNowNextAddLocalData",
  "review-blocked-records": "onboarding.appleRemoteIcloudDataSyncUploadNowNextReview",
  retry: "onboarding.appleRemoteIcloudDataSyncUploadNowNextRetry",
  done: "onboarding.appleRemoteIcloudDataSyncUploadNowNextDone",
};

const cloudKitSyncCycleNextActionKeys: Record<CloudKitSyncCycleResult["nextAction"], TranslationKey> = {
  "configure-cloudkit": "onboarding.appleRemoteIcloudDataSyncCycleNextConfigure",
  "review-conflicts": "onboarding.appleRemoteIcloudDataSyncCycleNextReviewConflicts",
  "review-blocked-records": "onboarding.appleRemoteIcloudDataSyncCycleNextReviewBlocked",
  retry: "onboarding.appleRemoteIcloudDataSyncCycleNextRetry",
  "use-lifeos": "onboarding.appleRemoteIcloudDataSyncCycleNextUseLifeOS",
  done: "onboarding.appleRemoteIcloudDataSyncCycleNextDone",
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

const icloudDataSyncStatusKeys: Record<NetworkDiagnostics["icloud"]["dataSync"]["status"], TranslationKey> = {
  "not-enabled": "onboarding.appleRemoteIcloudDataSyncNotEnabled",
  "missing-apple-platform": "onboarding.appleRemoteIcloudDataSyncMissingApple",
  "missing-container": "onboarding.appleRemoteIcloudDataSyncMissingContainer",
  "missing-apple-identity": "onboarding.appleRemoteIcloudDataSyncMissingIdentity",
  "missing-native-helper": "onboarding.appleRemoteIcloudDataSyncMissingHelper",
  "missing-entitlements": "onboarding.appleRemoteIcloudDataSyncMissingEntitlements",
  "no-data-types": "onboarding.appleRemoteIcloudDataSyncNoDataTypes",
  "ready-to-test": "onboarding.appleRemoteIcloudDataSyncReadyToTest",
};

const icloudHumanSyncStepKeys: Record<NetworkDiagnostics["icloud"]["syncReadiness"]["action"], { title: TranslationKey; body: TranslationKey }> = {
  "use-apple-device": {
    title: "onboarding.appleRemoteIcloudHumanUseAppleTitle",
    body: "onboarding.appleRemoteIcloudHumanUseAppleBody",
  },
  "enable-icloud-drive": {
    title: "onboarding.appleRemoteIcloudHumanEnableTitle",
    body: "onboarding.appleRemoteIcloudHumanEnableBody",
  },
  "fix-permissions": {
    title: "onboarding.appleRemoteIcloudHumanPermissionsTitle",
    body: "onboarding.appleRemoteIcloudHumanPermissionsBody",
  },
  "export-entry": {
    title: "onboarding.appleRemoteIcloudHumanExportTitle",
    body: "onboarding.appleRemoteIcloudHumanExportBody",
  },
  "refresh-entry": {
    title: "onboarding.appleRemoteIcloudHumanRefreshTitle",
    body: "onboarding.appleRemoteIcloudHumanRefreshBody",
  },
  "fix-icloud-sync": {
    title: "onboarding.appleRemoteIcloudHumanFixSyncTitle",
    body: "onboarding.appleRemoteIcloudHumanFixSyncBody",
  },
  "wait-for-sync": {
    title: "onboarding.appleRemoteIcloudHumanWaitTitle",
    body: "onboarding.appleRemoteIcloudHumanWaitBody",
  },
  "open-files-app": {
    title: "onboarding.appleRemoteIcloudHumanOpenTitle",
    body: "onboarding.appleRemoteIcloudHumanOpenBody",
  },
};

function safeIcloudSyncUserStepKey(value: string | undefined, fallback: TranslationKey): TranslationKey {
  return value && value.startsWith("onboarding.appleRemoteIcloudNextStep") ? value as TranslationKey : fallback;
}

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
  "cleanup-old-entry": "onboarding.appleRemoteIcloudRepairRecCleanup",
  ready: "onboarding.appleRemoteIcloudRepairRecReady",
};

const repairRecommendationHintKeys: Record<IcloudHandoffRepairAnalysis["recommendations"][number]["id"], TranslationKey> = {
  "refresh-icloud": "onboarding.appleRemoteIcloudRepairHintRefresh",
  "open-latest-entry": "onboarding.appleRemoteIcloudRepairHintOpenLatest",
  "regenerate-qr": "onboarding.appleRemoteIcloudRepairHintQr",
  "start-tailscale": "onboarding.appleRemoteIcloudRepairHintTailscale",
  "start-cloudflare": "onboarding.appleRemoteIcloudRepairHintCloudflare",
  "save-stable-entry": "onboarding.appleRemoteIcloudRepairHintStable",
  "test-phone-entry": "onboarding.appleRemoteIcloudRepairHintTest",
  "cleanup-old-entry": "onboarding.appleRemoteIcloudRepairHintCleanup",
  ready: "onboarding.appleRemoteIcloudRepairHintReady",
};

const icloudAcceptanceItemKeys: Record<NonNullable<NetworkDiagnostics["icloud"]["acceptance"]>["items"][number]["id"], TranslationKey> = {
  "icloud-entry-synced": "onboarding.appleRemoteIcloudAcceptanceItemSynced",
  "phone-opened-current-entry": "onboarding.appleRemoteIcloudAcceptanceItemPhone",
  "pairing-qr-current": "onboarding.appleRemoteIcloudAcceptanceItemQr",
  "realtime-entry-ready": "onboarding.appleRemoteIcloudAcceptanceItemRealtime",
  "cellular-mobile-chat": "onboarding.appleRemoteIcloudAcceptanceItemCellular",
  "restart-restore": "onboarding.appleRemoteIcloudAcceptanceItemRestart",
  "network-switch": "onboarding.appleRemoteIcloudAcceptanceItemSwitch",
  "network-interruption": "onboarding.appleRemoteIcloudAcceptanceItemInterruption",
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

const icloudAcceptanceEvidenceKeys: Record<NonNullable<NetworkDiagnostics["icloud"]["acceptance"]>["items"][number]["id"], TranslationKey> = {
  "icloud-entry-synced": "onboarding.appleRemoteIcloudAcceptanceEvidenceSynced",
  "phone-opened-current-entry": "onboarding.appleRemoteIcloudAcceptanceEvidencePhone",
  "pairing-qr-current": "onboarding.appleRemoteIcloudAcceptanceEvidenceQr",
  "realtime-entry-ready": "onboarding.appleRemoteIcloudAcceptanceEvidenceRealtime",
  "cellular-mobile-chat": "onboarding.appleRemoteIcloudAcceptanceEvidenceCellular",
  "restart-restore": "onboarding.appleRemoteIcloudAcceptanceEvidenceRestart",
  "network-switch": "onboarding.appleRemoteIcloudAcceptanceEvidenceSwitch",
  "network-interruption": "onboarding.appleRemoteIcloudAcceptanceEvidenceInterruption",
  "old-entry-repair": "onboarding.appleRemoteIcloudAcceptanceEvidenceOldEntry",
};

const icloudManualAcceptanceRequirementKeys: Partial<Record<NonNullable<NetworkDiagnostics["icloud"]["acceptance"]>["items"][number]["id"], TranslationKey>> = {
  "cellular-mobile-chat": "onboarding.appleRemoteIcloudAcceptanceRequirementCellular",
  "restart-restore": "onboarding.appleRemoteIcloudAcceptanceRequirementRestart",
  "network-switch": "onboarding.appleRemoteIcloudAcceptanceRequirementSwitch",
  "network-interruption": "onboarding.appleRemoteIcloudAcceptanceRequirementInterruption",
  "old-entry-repair": "onboarding.appleRemoteIcloudAcceptanceRequirementOldEntry",
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

function icloudDesktopNameKey(value?: string) {
  return String(value || "LifeOS Desktop").trim().toLowerCase() || "lifeos desktop";
}

function getIcloudDesktopShortId(entry: Pick<IcloudAvailableEntry, "desktopSlug" | "desktopId" | "packetFileName" | "htmlFileName" | "fileName">) {
  const source = [
    entry.desktopSlug,
    entry.desktopId,
    entry.packetFileName,
    entry.htmlFileName,
    entry.fileName,
  ].find((value) => String(value || "").trim());
  const normalized = String(source || "")
    .replace(/^lifeos-mobile-entry-?/i, "")
    .replace(/\.(json|html)$/i, "")
    .replace(/[^a-z0-9]+/gi, "")
    .toLowerCase();
  return normalized.slice(0, 8) || "entry";
}

function getDuplicateIcloudDesktopNames(entries: IcloudAvailableEntry[]) {
  const counts = new Map<string, number>();
  for (const entry of entries) {
    const key = icloudDesktopNameKey(entry.desktopName);
    counts.set(key, (counts.get(key) || 0) + 1);
  }
  return new Set([...counts.entries()].filter(([, count]) => count > 1).map(([key]) => key));
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

export default function OnboardingAppleRemoteCard({ diagnostics, busy, onExportIcloud, onCleanupIcloud, onStartTailscale, onStartCloudflare, onSaveCandidate, onTestCandidate, onOpenIcloudSettings, onOpenIcloudFolder, onDiagnostics }: Props) {
  const { t } = useI18n();
  const [repairText, setRepairText] = useState("");
  const [repairBusy, setRepairBusy] = useState(false);
  const [repairError, setRepairError] = useState("");
  const [repairAnalysis, setRepairAnalysis] = useState<IcloudHandoffRepairAnalysis | null>(null);
  const [repairRefresh, setRepairRefresh] = useState<IcloudAutoRefreshResult | null>(null);
  const [acceptingIcloudItem, setAcceptingIcloudItem] = useState<string | null>(null);
  const [icloudAcceptanceNotes, setIcloudAcceptanceNotes] = useState<Record<string, string>>({});
  const [icloudAcceptanceMessage, setIcloudAcceptanceMessage] = useState("");
  const [cloudKitHelperBusy, setCloudKitHelperBusy] = useState<CloudKitNativeHelperResult["operation"] | null>(null);
  const [cloudKitHelperResult, setCloudKitHelperResult] = useState<CloudKitNativeHelperResult | null>(null);
  const [cloudKitHelperMessage, setCloudKitHelperMessage] = useState("");
  const [cloudKitBatchBusy, setCloudKitBatchBusy] = useState(false);
  const [cloudKitBatchPreview, setCloudKitBatchPreview] = useState<CloudKitSyncBatchPreview | null>(null);
  const [cloudKitBatchMessage, setCloudKitBatchMessage] = useState("");
  const [cloudKitExportBusy, setCloudKitExportBusy] = useState(false);
  const [cloudKitExportSummary, setCloudKitExportSummary] = useState<CloudKitSyncExportSummary | null>(null);
  const [cloudKitExportMessage, setCloudKitExportMessage] = useState("");
  const [cloudKitImportBusy, setCloudKitImportBusy] = useState(false);
  const [cloudKitImportMessage, setCloudKitImportMessage] = useState("");
  const [cloudKitChangesBusy, setCloudKitChangesBusy] = useState(false);
  const [cloudKitChangesMessage, setCloudKitChangesMessage] = useState("");
  const [cloudKitCheckpoints, setCloudKitCheckpoints] = useState<CloudKitSyncCheckpoint[]>([]);
  const [cloudKitQuarantineBusy, setCloudKitQuarantineBusy] = useState(false);
  const [cloudKitQuarantineMessage, setCloudKitQuarantineMessage] = useState("");
  const [cloudKitQuarantineSummary, setCloudKitQuarantineSummary] = useState<CloudKitSyncQuarantineSummary | null>(null);
  const [cloudKitQuarantineItems, setCloudKitQuarantineItems] = useState<CloudKitSyncQuarantineItem[]>([]);
  const [cloudKitApplyBusy, setCloudKitApplyBusy] = useState(false);
  const [cloudKitApplyMessage, setCloudKitApplyMessage] = useState("");
  const [cloudKitApplyResult, setCloudKitApplyResult] = useState<CloudKitSyncApplyResult | null>(null);
  const [cloudKitSyncNowBusy, setCloudKitSyncNowBusy] = useState(false);
  const [cloudKitSyncNowMessage, setCloudKitSyncNowMessage] = useState("");
  const [cloudKitSyncNowResult, setCloudKitSyncNowResult] = useState<CloudKitSyncNowResult | null>(null);
  const [cloudKitSyncUploadNowBusy, setCloudKitSyncUploadNowBusy] = useState(false);
  const [cloudKitSyncUploadNowMessage, setCloudKitSyncUploadNowMessage] = useState("");
  const [cloudKitSyncUploadNowResult, setCloudKitSyncUploadNowResult] = useState<CloudKitSyncUploadNowResult | null>(null);
  const [cloudKitSyncCycleBusy, setCloudKitSyncCycleBusy] = useState(false);
  const [cloudKitSyncCycleMessage, setCloudKitSyncCycleMessage] = useState("");
  const [cloudKitSyncCycleResult, setCloudKitSyncCycleResult] = useState<CloudKitSyncCycleResult | null>(null);
  const appleRuntime = isAppleRuntime();
  const candidate = getPreferredCandidate(diagnostics);
  const icloud = diagnostics?.icloud;
  const handoffHealth = icloud?.handoffHealth;
  const icloudAvailability = icloud?.availability;
  const indexConsistency = icloud?.indexConsistency;
  const syncReadiness = icloud?.syncReadiness;
  const syncUserStepTitleKey = safeIcloudSyncUserStepKey(syncReadiness?.userStep?.titleKey, "onboarding.appleRemoteIcloudNextStepReviewTitle");
  const syncUserStepBodyKey = safeIcloudSyncUserStepKey(syncReadiness?.userStep?.bodyKey, "onboarding.appleRemoteIcloudNextStepReviewBody");
  const icloudSyncStuckMinutes = Math.max(1, Math.round((icloudAvailability?.syncStuckAfterMs || 0) / 60000));
  const syncReadinessActionText = syncReadiness
    ? t(icloudSyncActionKeys[syncReadiness.action], { count: syncReadiness.pendingCount, minutes: icloudSyncStuckMinutes })
    : "";
  const syncHumanRecovery = syncReadiness?.userStep?.humanRecovery || null;
  const syncHumanRecoveryTitleKey = (syncHumanRecovery?.titleKey || "") as TranslationKey;
  const syncHumanRecoveryBodyKey = (syncHumanRecovery?.bodyKey || "") as TranslationKey;
  const syncHumanRecoveryCtaKey = (syncHumanRecovery?.primaryCtaKey || "") as TranslationKey;
  const syncHumanRecoveryAfterKey = (syncHumanRecovery?.afterKey || "") as TranslationKey;
  const syncHumanRecoveryTipKey = (syncHumanRecovery?.tipKey || "") as TranslationKey;
  const syncUserStepPendingFiles = syncReadiness?.userStep?.pendingFiles || [];
  const syncUserStepMissingFiles = syncReadiness?.userStep?.missingFiles || [];
  const humanSyncStep = syncReadiness ? icloudHumanSyncStepKeys[syncReadiness.action] : null;
  const phoneConfirmation = icloud?.phoneConfirmation;
  const pairingSession = icloud?.pairingSession;
  const icloudAcceptance = icloud?.acceptance;
  const icloudMonitor = diagnostics?.icloudMonitor;
  const icloudLifecycle = icloud?.lifecycle;
  const dataSync = icloud?.dataSync;
  const dataSyncTone = dataSync?.ready
    ? "border-emerald-300/20 bg-emerald-500/10 text-emerald-50"
    : dataSync?.enabled
    ? "border-amber-300/20 bg-amber-500/10 text-amber-50"
    : "border-white/[0.06] bg-[#060a10]/45 text-zinc-300";
  const dataSyncGateCounts = {
    passed: dataSync?.acceptanceGates.filter((item) => item.status === "passed").length || 0,
    blocked: dataSync?.acceptanceGates.filter((item) => item.status === "blocked").length || 0,
    manual: dataSync?.acceptanceGates.filter((item) => item.status === "manual-required").length || 0,
  };
  const icloudCleanupNeeded = Boolean(icloudLifecycle && (icloudLifecycle.prunableEntryCount > 0 || icloudLifecycle.orphanedFileCount > 0));
  const latestEntryRepair = icloud?.latestEntryRepair || null;
  const latestRepairImport = icloud?.latestRepairImport || null;
  const latestHistory = icloud?.entryHistory?.slice(0, 3) || [];
  const availableEntryCount = icloud?.availableEntries?.length || 0;
  const availableEntries = icloud?.availableEntries?.slice(0, 6) || [];
  const duplicateIcloudDesktopNames = getDuplicateIcloudDesktopNames(availableEntries);
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
  const latestRepairImportNextAction = latestRepairImport?.nextAction || latestRepairImport?.recommendations?.[0] || null;
  const latestRepairImportNextActionLabel = latestRepairImportNextAction
    ? t((repairRecommendationKeys[latestRepairImportNextAction.id as keyof typeof repairRecommendationKeys] || "onboarding.appleRemoteIcloudRepairRecReady") as TranslationKey)
    : "";
  const simpleIcloudStatus = getSimpleIcloudStatus(icloud);
  const primaryIcloudAction = getPrimaryIcloudAction({ icloud, latestEntryRepair, pairingSession, syncReadiness, handoffHealth, canExportIcloud });
  const primaryIcloudActionFollowupKey = getIcloudActionFollowupKey(primaryIcloudAction.actionKey);
  const focusedIcloudAcceptanceItem = icloudAcceptance?.items.find((item) => (
    item.id === icloudAcceptance.nextManualItemId &&
    item.status === "manual-required" &&
    Boolean(icloudManualAcceptanceRequirementKeys[item.id])
  )) || icloudAcceptance?.items.find((item) => (
    item.status === "manual-required" && Boolean(icloudManualAcceptanceRequirementKeys[item.id])
  )) || null;
  const visibleIcloudAcceptanceItems = icloudAcceptance?.items
    .filter((item) => item.status !== "passed" && item.id !== focusedIcloudAcceptanceItem?.id)
    .slice(0, 4) || [];
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

  const handleRecordIcloudAcceptance = async (item: NonNullable<NetworkDiagnostics["icloud"]["acceptance"]>["items"][number]) => {
    const note = (icloudAcceptanceNotes[item.id] || "").trim();
    const requirementKey = icloudManualAcceptanceRequirementKeys[item.id];
    setAcceptingIcloudItem(item.id);
    setIcloudAcceptanceMessage("");
    try {
      const result = await recordIcloudAcceptance(item.id, note, {
        source: "admin-icloud-acceptance-card",
        requirements: [
          item.evidence,
          item.action,
          requirementKey ? t(requirementKey) : "",
        ].filter(Boolean),
      });
      setIcloudAcceptanceNotes((current) => ({ ...current, [item.id]: "" }));
      onDiagnostics?.(result.diagnostics);
      setIcloudAcceptanceMessage(t("onboarding.appleRemoteIcloudAcceptanceRecorded"));
    } catch (error: any) {
      setIcloudAcceptanceMessage(error.message || t("onboarding.appleRemoteIcloudAcceptanceRecordFailed"));
    } finally {
      setAcceptingIcloudItem(null);
    }
  };

  const handleRunCloudKitHelper = async (operation: CloudKitNativeHelperResult["operation"]) => {
    setCloudKitHelperBusy(operation);
    setCloudKitHelperMessage("");
    try {
      const result = await runCloudKitDataSyncHelper(operation);
      setCloudKitHelperResult(result.result);
      onDiagnostics?.(result.diagnostics);
      setCloudKitHelperMessage(t("onboarding.appleRemoteIcloudDataSyncHelperCompleted"));
    } catch (error: any) {
      const payload = error?.payload as { result?: CloudKitNativeHelperResult; diagnostics?: NetworkDiagnostics } | undefined;
      if (payload?.result) setCloudKitHelperResult(payload.result);
      if (payload?.diagnostics) onDiagnostics?.(payload.diagnostics);
      setCloudKitHelperMessage(error?.message || t("onboarding.appleRemoteIcloudDataSyncHelperFailed"));
    } finally {
      setCloudKitHelperBusy(null);
    }
  };

  const handleLoadCloudKitBatchPreview = async () => {
    setCloudKitBatchBusy(true);
    setCloudKitBatchMessage("");
    try {
      const result = await getCloudKitSyncBatchPreview();
      setCloudKitBatchPreview(result.preview);
      onDiagnostics?.(result.diagnostics);
      setCloudKitBatchMessage(t("onboarding.appleRemoteIcloudDataSyncBatchLoaded"));
    } catch (error: any) {
      setCloudKitBatchMessage(error?.message || t("onboarding.appleRemoteIcloudDataSyncBatchFailed"));
    } finally {
      setCloudKitBatchBusy(false);
    }
  };

  const handleRunCloudKitSyncExport = async () => {
    setCloudKitExportBusy(true);
    setCloudKitExportMessage("");
    try {
      const result = await runCloudKitSyncExport({ confirmation: "SYNC_APPROVED_RECORDS" });
      setCloudKitHelperResult(result.result);
      setCloudKitExportSummary(result.export);
      setCloudKitBatchPreview(result.export.preview);
      onDiagnostics?.(result.diagnostics);
      setCloudKitExportMessage(t("onboarding.appleRemoteIcloudDataSyncExportCompleted", {
        records: result.export.exportRecordCount,
        backup: result.backup.file,
      }));
    } catch (error: any) {
      const payload = error?.payload as { result?: CloudKitNativeHelperResult; export?: CloudKitSyncExportSummary; diagnostics?: NetworkDiagnostics } | undefined;
      if (payload?.result) setCloudKitHelperResult(payload.result);
      if (payload?.export) {
        setCloudKitExportSummary(payload.export);
        setCloudKitBatchPreview(payload.export.preview);
      }
      if (payload?.diagnostics) onDiagnostics?.(payload.diagnostics);
      setCloudKitExportMessage(error?.message || t("onboarding.appleRemoteIcloudDataSyncExportFailed"));
    } finally {
      setCloudKitExportBusy(false);
    }
  };

  const handleRunCloudKitSyncImportPreview = async () => {
    setCloudKitImportBusy(true);
    setCloudKitImportMessage("");
    try {
      const result = await runCloudKitSyncImportPreview();
      setCloudKitHelperResult(result.result);
      onDiagnostics?.(result.diagnostics);
      setCloudKitImportMessage(t("onboarding.appleRemoteIcloudDataSyncImportPreviewCompleted", {
        records: result.result.syncImportPreview?.fetched || 0,
      }));
    } catch (error: any) {
      const payload = error?.payload as { result?: CloudKitNativeHelperResult; diagnostics?: NetworkDiagnostics } | undefined;
      if (payload?.result) setCloudKitHelperResult(payload.result);
      if (payload?.diagnostics) onDiagnostics?.(payload.diagnostics);
      setCloudKitImportMessage(error?.message || t("onboarding.appleRemoteIcloudDataSyncImportPreviewFailed"));
    } finally {
      setCloudKitImportBusy(false);
    }
  };

  const handleRunCloudKitSyncChangesPreview = async () => {
    setCloudKitChangesBusy(true);
    setCloudKitChangesMessage("");
    try {
      const result = await runCloudKitSyncChangesPreview();
      setCloudKitHelperResult(result.result);
      setCloudKitCheckpoints(result.checkpoints || []);
      onDiagnostics?.(result.diagnostics);
      setCloudKitChangesMessage(t("onboarding.appleRemoteIcloudDataSyncChangesPreviewCompleted", {
        changed: result.result.syncChangesPreview?.changed || 0,
        deleted: result.result.syncChangesPreview?.deleted || 0,
      }));
    } catch (error: any) {
      const payload = error?.payload as { result?: CloudKitNativeHelperResult; checkpoints?: CloudKitSyncCheckpoint[]; diagnostics?: NetworkDiagnostics } | undefined;
      if (payload?.result) setCloudKitHelperResult(payload.result);
      if (payload?.checkpoints) setCloudKitCheckpoints(payload.checkpoints);
      if (payload?.diagnostics) onDiagnostics?.(payload.diagnostics);
      setCloudKitChangesMessage(error?.message || t("onboarding.appleRemoteIcloudDataSyncChangesPreviewFailed"));
    } finally {
      setCloudKitChangesBusy(false);
    }
  };

  const handleRunCloudKitSyncImportQuarantine = async () => {
    setCloudKitQuarantineBusy(true);
    setCloudKitQuarantineMessage("");
    try {
      const result = await runCloudKitSyncImportQuarantine({ confirmation: "IMPORT_CLOUDKIT_CHANGES" });
      setCloudKitHelperResult(result.result);
      setCloudKitCheckpoints(result.checkpoints || []);
      setCloudKitQuarantineSummary(result.quarantine);
      await handleLoadCloudKitSyncQuarantine();
      onDiagnostics?.(result.diagnostics);
      setCloudKitQuarantineMessage(t("onboarding.appleRemoteIcloudDataSyncImportQuarantineCompleted", {
        changed: result.quarantine.importedChanged,
        deleted: result.quarantine.importedDeleted,
      }));
    } catch (error: any) {
      const payload = error?.payload as { result?: CloudKitNativeHelperResult; quarantine?: CloudKitSyncQuarantineSummary; checkpoints?: CloudKitSyncCheckpoint[]; diagnostics?: NetworkDiagnostics } | undefined;
      if (payload?.result) setCloudKitHelperResult(payload.result);
      if (payload?.quarantine) setCloudKitQuarantineSummary(payload.quarantine);
      if (payload?.checkpoints) setCloudKitCheckpoints(payload.checkpoints);
      if (payload?.diagnostics) onDiagnostics?.(payload.diagnostics);
      setCloudKitQuarantineMessage(error?.message || t("onboarding.appleRemoteIcloudDataSyncImportQuarantineFailed"));
    } finally {
      setCloudKitQuarantineBusy(false);
    }
  };

  const handleLoadCloudKitSyncQuarantine = async () => {
    setCloudKitApplyMessage("");
    try {
      const result = await getCloudKitSyncQuarantine(100);
      setCloudKitQuarantineItems(result.quarantine.items);
      setCloudKitQuarantineSummary(result.quarantine.summary);
      setCloudKitCheckpoints(result.quarantine.checkpoints || []);
      onDiagnostics?.(result.diagnostics);
    } catch (error: any) {
      setCloudKitApplyMessage(error?.message || t("onboarding.appleRemoteIcloudDataSyncApplyQuarantineLoadFailed"));
    }
  };

  const handleApplyCloudKitSyncQuarantine = async () => {
    setCloudKitApplyBusy(true);
    setCloudKitApplyMessage("");
    try {
      const result = await applyCloudKitSyncQuarantine({ confirmation: "APPLY_CLOUDKIT_QUARANTINE" });
      setCloudKitApplyResult(result.apply);
      setCloudKitQuarantineSummary(result.apply.summary);
      setCloudKitCheckpoints(result.apply.checkpoints || []);
      await handleLoadCloudKitSyncQuarantine();
      onDiagnostics?.(result.diagnostics);
      setCloudKitApplyMessage(t("onboarding.appleRemoteIcloudDataSyncApplyQuarantineCompleted", {
        applied: result.apply.applied,
        conflicts: result.apply.conflicts,
      }));
    } catch (error: any) {
      const payload = error?.payload as { apply?: CloudKitSyncApplyResult; quarantine?: { items?: CloudKitSyncQuarantineItem[]; summary?: CloudKitSyncQuarantineSummary; checkpoints?: CloudKitSyncCheckpoint[] }; diagnostics?: NetworkDiagnostics } | undefined;
      if (payload?.apply) setCloudKitApplyResult(payload.apply);
      if (payload?.quarantine?.items) setCloudKitQuarantineItems(payload.quarantine.items);
      if (payload?.quarantine?.summary) setCloudKitQuarantineSummary(payload.quarantine.summary);
      if (payload?.quarantine?.checkpoints) setCloudKitCheckpoints(payload.quarantine.checkpoints);
      if (payload?.diagnostics) onDiagnostics?.(payload.diagnostics);
      setCloudKitApplyMessage(error?.message || t("onboarding.appleRemoteIcloudDataSyncApplyQuarantineFailed"));
    } finally {
      setCloudKitApplyBusy(false);
    }
  };

  const handleRunCloudKitSyncUploadNow = async () => {
    setCloudKitSyncUploadNowBusy(true);
    setCloudKitSyncUploadNowMessage("");
    try {
      const result = await runCloudKitSyncUploadNow({ confirmation: "UPLOAD_CLOUDKIT_NOW" });
      setCloudKitSyncUploadNowResult(result.upload);
      setCloudKitExportSummary(result.upload.export);
      setCloudKitBatchPreview(result.upload.export.preview);
      if (result.upload.result) setCloudKitHelperResult(result.upload.result);
      onDiagnostics?.(result.diagnostics);
      setCloudKitSyncUploadNowMessage(t("onboarding.appleRemoteIcloudDataSyncUploadNowCompleted", {
        records: result.upload.export.exportRecordCount,
        saved: result.upload.result?.syncExport?.saved || 0,
      }));
    } catch (error: any) {
      const payload = error?.payload as { upload?: CloudKitSyncUploadNowResult; diagnostics?: NetworkDiagnostics } | undefined;
      if (payload?.upload) {
        setCloudKitSyncUploadNowResult(payload.upload);
        setCloudKitExportSummary(payload.upload.export);
        setCloudKitBatchPreview(payload.upload.export.preview);
        if (payload.upload.result) setCloudKitHelperResult(payload.upload.result);
      }
      if (payload?.diagnostics) onDiagnostics?.(payload.diagnostics);
      setCloudKitSyncUploadNowMessage(error?.message || t("onboarding.appleRemoteIcloudDataSyncUploadNowFailed"));
    } finally {
      setCloudKitSyncUploadNowBusy(false);
    }
  };

  const handleRunCloudKitSyncCycle = async () => {
    setCloudKitSyncCycleBusy(true);
    setCloudKitSyncCycleMessage("");
    try {
      const result = await runCloudKitSyncCycle({ confirmation: "SYNC_CLOUDKIT_CYCLE" });
      setCloudKitSyncCycleResult(result.cycle);
      setCloudKitSyncNowResult(result.cycle.pull);
      setCloudKitApplyResult(result.cycle.pull.apply);
      setCloudKitQuarantineSummary(result.cycle.pull.quarantine.summary);
      setCloudKitCheckpoints(result.cycle.pull.quarantine.checkpoints || result.cycle.pull.changes.checkpoints || []);
      setCloudKitHelperResult(result.cycle.upload?.result || result.cycle.pull.import?.result || result.cycle.pull.changes.result);
      if (result.cycle.upload) {
        setCloudKitSyncUploadNowResult(result.cycle.upload);
        setCloudKitExportSummary(result.cycle.upload.export);
        setCloudKitBatchPreview(result.cycle.upload.export.preview);
      }
      await handleLoadCloudKitSyncQuarantine();
      onDiagnostics?.(result.diagnostics);
      setCloudKitSyncCycleMessage(t("onboarding.appleRemoteIcloudDataSyncCycleCompleted", {
        applied: result.cycle.pull.apply.applied,
        uploaded: result.cycle.upload?.result?.syncExport?.saved || 0,
      }));
    } catch (error: any) {
      const payload = error?.payload as { cycle?: CloudKitSyncCycleResult; diagnostics?: NetworkDiagnostics } | undefined;
      if (payload?.cycle) {
        setCloudKitSyncCycleResult(payload.cycle);
        setCloudKitSyncNowResult(payload.cycle.pull);
        setCloudKitApplyResult(payload.cycle.pull.apply);
        setCloudKitQuarantineSummary(payload.cycle.pull.quarantine.summary);
        setCloudKitCheckpoints(payload.cycle.pull.quarantine.checkpoints || payload.cycle.pull.changes.checkpoints || []);
        setCloudKitHelperResult(payload.cycle.upload?.result || payload.cycle.pull.import?.result || payload.cycle.pull.changes.result);
        if (payload.cycle.upload) {
          setCloudKitSyncUploadNowResult(payload.cycle.upload);
          setCloudKitExportSummary(payload.cycle.upload.export);
          setCloudKitBatchPreview(payload.cycle.upload.export.preview);
        }
      }
      if (payload?.diagnostics) onDiagnostics?.(payload.diagnostics);
      setCloudKitSyncCycleMessage(error?.message || t("onboarding.appleRemoteIcloudDataSyncCycleFailed"));
    } finally {
      setCloudKitSyncCycleBusy(false);
    }
  };

  const handleRunCloudKitSyncNow = async () => {
    setCloudKitSyncNowBusy(true);
    setCloudKitSyncNowMessage("");
    try {
      const result = await runCloudKitSyncNow({ confirmation: "SYNC_CLOUDKIT_NOW" });
      setCloudKitSyncNowResult(result.sync);
      setCloudKitHelperResult(result.sync.import?.result || result.sync.changes.result);
      setCloudKitApplyResult(result.sync.apply);
      setCloudKitQuarantineSummary(result.sync.quarantine.summary);
      setCloudKitCheckpoints(result.sync.quarantine.checkpoints || result.sync.changes.checkpoints || []);
      await handleLoadCloudKitSyncQuarantine();
      onDiagnostics?.(result.diagnostics);
      setCloudKitSyncNowMessage(t("onboarding.appleRemoteIcloudDataSyncNowCompleted", {
        applied: result.sync.apply.applied,
        conflicts: result.sync.apply.conflicts,
      }));
    } catch (error: any) {
      const payload = error?.payload as { sync?: CloudKitSyncNowResult; diagnostics?: NetworkDiagnostics } | undefined;
      if (payload?.sync) {
        setCloudKitSyncNowResult(payload.sync);
        setCloudKitHelperResult(payload.sync.import?.result || payload.sync.changes.result);
        setCloudKitApplyResult(payload.sync.apply);
        setCloudKitQuarantineSummary(payload.sync.quarantine.summary);
        setCloudKitCheckpoints(payload.sync.quarantine.checkpoints || payload.sync.changes.checkpoints || []);
      }
      if (payload?.diagnostics) onDiagnostics?.(payload.diagnostics);
      setCloudKitSyncNowMessage(error?.message || t("onboarding.appleRemoteIcloudDataSyncNowFailed"));
    } finally {
      setCloudKitSyncNowBusy(false);
    }
  };

  const cloudKitQuarantineAutoReady = cloudKitQuarantineSummary?.autoReady || 0;
  const cloudKitQuarantineReviewCount = (cloudKitQuarantineSummary?.pendingReview || 0) + (cloudKitQuarantineSummary?.conflicts || 0) + (cloudKitQuarantineSummary?.failed || 0);
  const cloudKitQuarantineAppliedCount = cloudKitQuarantineSummary?.applied || 0;
  let cloudKitQuarantineNextAction: CloudKitQuarantineNextAction = "sync-now";
  let cloudKitQuarantineNextTitleKey: TranslationKey = "onboarding.appleRemoteIcloudDataSyncQuarantineNextSyncTitle";
  let cloudKitQuarantineNextBodyKey: TranslationKey = "onboarding.appleRemoteIcloudDataSyncQuarantineNextSyncBody";
  let cloudKitQuarantineNextCtaKey: TranslationKey = "onboarding.appleRemoteIcloudDataSyncQuarantineNextSyncCta";
  if (cloudKitQuarantineAutoReady > 0) {
    cloudKitQuarantineNextAction = "apply";
    cloudKitQuarantineNextTitleKey = "onboarding.appleRemoteIcloudDataSyncQuarantineNextApplyTitle";
    cloudKitQuarantineNextBodyKey = "onboarding.appleRemoteIcloudDataSyncQuarantineNextApplyBody";
    cloudKitQuarantineNextCtaKey = "onboarding.appleRemoteIcloudDataSyncQuarantineNextApplyCta";
  } else if (cloudKitQuarantineReviewCount > 0) {
    cloudKitQuarantineNextAction = "load";
    cloudKitQuarantineNextTitleKey = "onboarding.appleRemoteIcloudDataSyncQuarantineNextReviewTitle";
    cloudKitQuarantineNextBodyKey = "onboarding.appleRemoteIcloudDataSyncQuarantineNextReviewBody";
    cloudKitQuarantineNextCtaKey = "onboarding.appleRemoteIcloudDataSyncQuarantineNextReviewCta";
  } else if (cloudKitQuarantineAppliedCount > 0) {
    cloudKitQuarantineNextTitleKey = "onboarding.appleRemoteIcloudDataSyncQuarantineNextDoneTitle";
    cloudKitQuarantineNextBodyKey = "onboarding.appleRemoteIcloudDataSyncQuarantineNextDoneBody";
    cloudKitQuarantineNextCtaKey = "onboarding.appleRemoteIcloudDataSyncQuarantineNextDoneCta";
  }
  const cloudKitQuarantineNextBusy =
    (cloudKitQuarantineNextAction === "apply" && cloudKitApplyBusy) ||
    (cloudKitQuarantineNextAction === "sync-now" && cloudKitSyncNowBusy);
  const cloudKitQuarantineNextDisabled =
    cloudKitQuarantineNextBusy ||
    (cloudKitQuarantineNextAction === "apply" && cloudKitQuarantineAutoReady <= 0) ||
    (cloudKitQuarantineNextAction === "sync-now" && !dataSync?.ready);
  const handleCloudKitQuarantineNextAction =
    cloudKitQuarantineNextAction === "apply"
      ? handleApplyCloudKitSyncQuarantine
      : cloudKitQuarantineNextAction === "load"
      ? handleLoadCloudKitSyncQuarantine
      : handleRunCloudKitSyncNow;

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

  const renderLatestEntryRepairPrimaryAction = (repair: IcloudLatestEntryRepair) => {
    if (repair.action === "refresh-icloud") {
      return (
        <button
          type="button"
          onClick={onExportIcloud}
          disabled={!canExportIcloud || isBusy}
          className="mt-3 inline-flex w-full items-center justify-center gap-2 rounded-xl border border-sky-300/20 bg-sky-500/10 px-3 py-2 text-xs font-bold text-sky-50 disabled:opacity-50"
        >
          {isIcloudBusy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}
          {t("onboarding.appleRemoteIcloudRepairButtonRefresh")}
        </button>
      );
    }
    if (repair.action === "refresh-and-regenerate-qr") {
      return (
        <a
          href="/admin/devices/pair"
          className="mt-3 inline-flex w-full items-center justify-center gap-2 rounded-xl border border-amber-200/20 bg-black/15 px-3 py-2 text-xs font-bold text-amber-50"
        >
          <QrCode className="h-3.5 w-3.5" />
          {t("onboarding.appleRemoteIcloudRepairButtonQr")}
        </a>
      );
    }
    return null;
  };

  const renderPrimaryIcloudActionButton = (testId?: string) => {
    if (primaryIcloudAction.cta === "export") {
      return (
        <button
          type="button"
          data-testid={testId}
          onClick={onExportIcloud}
          disabled={!canExportIcloud || isBusy}
          className="mt-3 inline-flex items-center justify-center gap-2 rounded-xl border border-current/15 bg-black/15 px-3 py-2 text-xs font-bold disabled:opacity-50"
        >
          {isIcloudBusy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}
          {t("onboarding.appleRemoteRefreshIcloud")}
        </button>
      );
    }
    if (primaryIcloudAction.cta === "qr") {
      return (
        <a
          data-testid={testId}
          href="/admin/devices/pair"
          className="mt-3 inline-flex items-center justify-center gap-2 rounded-xl border border-current/15 bg-black/15 px-3 py-2 text-xs font-bold"
        >
          <QrCode className="h-3.5 w-3.5" />
          {t("onboarding.appleRemoteOpenQr")}
        </a>
      );
    }
    if (primaryIcloudAction.cta === "remote-guide") {
      return (
        <a
          data-testid={testId}
          href="/admin/settings#mobile-connect"
          className="mt-3 inline-flex items-center justify-center gap-2 rounded-xl border border-current/15 bg-black/15 px-3 py-2 text-xs font-bold"
        >
          <Wifi className="h-3.5 w-3.5" />
          {t("onboarding.appleRemoteIcloudActionOpenConnectionGuide")}
        </a>
      );
    }
    if (primaryIcloudAction.cta === "icloud-settings" && onOpenIcloudSettings) {
      return (
        <button
          type="button"
          data-testid={testId || "onboarding-icloud-primary-open-settings"}
          onClick={onOpenIcloudSettings}
          disabled={busy === "desktop-icloudSettings"}
          className="mt-3 inline-flex items-center justify-center gap-2 rounded-xl border border-current/15 bg-black/15 px-3 py-2 text-xs font-bold disabled:opacity-50"
        >
          {busy === "desktop-icloudSettings" ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Cloud className="h-3.5 w-3.5" />}
          {t("onboarding.simpleIcloudOpenSettings")}
        </button>
      );
    }
    if (primaryIcloudAction.cta === "icloud-folder" && onOpenIcloudFolder) {
      return (
        <button
          type="button"
          data-testid={testId || "onboarding-icloud-primary-open-folder"}
          onClick={onOpenIcloudFolder}
          disabled={busy === "desktop-icloudFolder"}
          className="mt-3 inline-flex items-center justify-center gap-2 rounded-xl border border-current/15 bg-black/15 px-3 py-2 text-xs font-bold disabled:opacity-50"
        >
          {busy === "desktop-icloudFolder" ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Cloud className="h-3.5 w-3.5" />}
          {t("onboarding.simpleIcloudOpenFolder")}
        </button>
      );
    }
    return null;
  };

  const renderRepairRecommendationAction = (item: IcloudHandoffRepairAnalysis["recommendations"][number]) => {
    const label = t(repairRecommendationKeys[item.id]);
    const hint = t(repairRecommendationHintKeys[item.id]);
    const actionClass = "inline-flex w-full items-center justify-center gap-2 rounded-xl border px-3 py-2 text-left text-[11px] font-bold disabled:opacity-50";
    const wrapAction = (action: ReactNode) => (
      <div key={item.id} className="rounded-xl border border-current/10 bg-black/10 p-2">
        {action}
        <div className="mt-2 text-[10px] leading-relaxed opacity-75">{hint}</div>
      </div>
    );

    if (item.id === "refresh-icloud" || item.id === "open-latest-entry") {
      return wrapAction(
        <button
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
      return wrapAction(
        <a
          href="/admin/devices/pair"
          className={`${actionClass} border-amber-200/20 bg-black/15 text-amber-50`}
        >
          <QrCode className="h-3.5 w-3.5 shrink-0" />
          <span>{label}</span>
        </a>
      );
    }

    if (item.id === "start-tailscale") {
      return wrapAction(tailscaleInstalled ? (
        <button
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
          href={tailscaleInstallUrl}
          target="_blank"
          rel="noreferrer"
          className={`${actionClass} border-blue-300/20 bg-blue-500/10 text-blue-100`}
        >
          <ExternalLink className="h-3.5 w-3.5 shrink-0" />
          <span>{label}</span>
        </a>
      ));
    }

    if (item.id === "start-cloudflare") {
      return wrapAction(
        <button
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
      return wrapAction(
        <button
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
      return wrapAction(
        <button
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

    if (item.id === "cleanup-old-entry") {
      return wrapAction(
        <button
          type="button"
          data-testid="onboarding-icloud-repair-cleanup-action"
          onClick={onCleanupIcloud}
          disabled={isBusy}
          className={`${actionClass} border-amber-300/20 bg-amber-500/10 text-amber-100`}
        >
          {isIcloudCleanupBusy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5 shrink-0" />}
          <span>{isIcloudCleanupBusy ? t("onboarding.appleRemoteIcloudCleanupCleaning") : label}</span>
        </button>
      );
    }

    return wrapAction(
      <div className="flex items-center gap-2 rounded-xl bg-black/15 p-2 text-[11px] font-bold">
        <CheckCircle2 className="h-3.5 w-3.5 shrink-0" />
        <span>{label}</span>
      </div>
    );
  };

  const renderDesktopIcloudOneNextAction = () => {
    if (desktopIcloudOneNextSource === "repair-import" && latestRepairImportNextAction) return renderRepairRecommendationAction(latestRepairImportNextAction);
    if (desktopIcloudOneNextSource === "phone-issue" && latestEntryRepair && latestEntryRepair.status !== "none" && latestEntryRepair.action !== "none") return renderLatestEntryRepairPrimaryAction(latestEntryRepair);
    if (desktopIcloudOneNextSource === "cleanup") {
      return (
        <button
          type="button"
          data-testid="onboarding-icloud-desktop-one-next-cleanup"
          onClick={onCleanupIcloud}
          disabled={isBusy}
          className="mt-3 inline-flex w-full items-center justify-center gap-2 rounded-xl bg-amber-300 px-3 py-2 text-xs font-bold text-zinc-950 shadow-lg shadow-amber-950/20 transition hover:bg-amber-200 disabled:opacity-50"
        >
          {isIcloudCleanupBusy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}
          {isIcloudCleanupBusy ? t("onboarding.appleRemoteIcloudCleanupCleaning") : t("onboarding.appleRemoteIcloudCleanupButton")}
        </button>
      );
    }
    return renderPrimaryIcloudActionButton("onboarding-icloud-desktop-one-next-primary-action");
  };

  const shouldDoPrimaryIcloudActionBeforeCleanup = primaryIcloudAction.cta !== "none" || primaryIcloudAction.actionKey !== "onboarding.appleRemoteIcloudActionOpenFiles";
  const desktopIcloudOneNextSource = latestRepairImportNextAction
    ? "repair-import"
    : latestEntryRepair && latestEntryRepair.status !== "none" && latestEntryRepair.action !== "none"
    ? "phone-issue"
    : shouldDoPrimaryIcloudActionBeforeCleanup
    ? "primary"
    : icloudCleanupNeeded
    ? "cleanup"
    : "primary";
  const desktopIcloudOneNextTitleKey: TranslationKey = desktopIcloudOneNextSource === "repair-import"
    ? "onboarding.appleRemoteIcloudDesktopOneNextRepairImportTitle"
    : desktopIcloudOneNextSource === "phone-issue"
    ? "onboarding.appleRemoteIcloudDesktopOneNextPhoneIssueTitle"
    : desktopIcloudOneNextSource === "cleanup"
    ? "onboarding.appleRemoteIcloudDesktopOneNextCleanupTitle"
    : primaryIcloudAction.titleKey;
  const desktopIcloudOneNextBodyKey: TranslationKey = desktopIcloudOneNextSource === "repair-import"
    ? "onboarding.appleRemoteIcloudDesktopOneNextRepairImportBody"
    : desktopIcloudOneNextSource === "phone-issue"
    ? "onboarding.appleRemoteIcloudDesktopOneNextPhoneIssueBody"
    : desktopIcloudOneNextSource === "cleanup"
    ? "onboarding.appleRemoteIcloudDesktopOneNextCleanupBody"
    : primaryIcloudAction.bodyKey;
  const desktopIcloudOneNextActionKey: TranslationKey = desktopIcloudOneNextSource === "repair-import"
    ? (repairRecommendationKeys[latestRepairImportNextAction?.id as keyof typeof repairRecommendationKeys] || "onboarding.appleRemoteIcloudRepairRecReady") as TranslationKey
    : desktopIcloudOneNextSource === "phone-issue"
    ? latestEntryRepairActionKeys[latestEntryRepair?.action || "none"]
    : desktopIcloudOneNextSource === "cleanup"
    ? "onboarding.appleRemoteIcloudCleanupButton"
    : primaryIcloudAction.actionKey;

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
        {dataSync ? (
          <div data-testid="onboarding-icloud-data-sync-readiness" className={`mt-3 rounded-xl border p-3 text-[11px] leading-relaxed ${dataSyncTone}`}>
            <div className="flex gap-2">
              {dataSync.ready ? <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" /> : <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0" />}
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="font-bold">{t("onboarding.appleRemoteIcloudDataSyncTitle")}</span>
                  <span className="rounded-full border border-current/15 bg-black/15 px-2 py-0.5 text-[10px] font-bold">
                    {t(icloudDataSyncStatusKeys[dataSync.status])}
                  </span>
                </div>
                <div className="mt-1 opacity-85">{t("onboarding.appleRemoteIcloudDataSyncBody")}</div>
                <div className="mt-2 rounded-lg border border-current/10 bg-black/15 p-2 font-bold">
                  {t("onboarding.appleRemoteIcloudDataSyncNext", { action: dataSync.nextAction })}
                </div>
                <div data-testid="onboarding-icloud-data-sync-cycle" className="mt-2 rounded-lg border border-emerald-300/20 bg-emerald-500/10 p-3 text-emerald-50">
                  <div className="flex items-start gap-2">
                    <RefreshCw className="mt-0.5 h-4 w-4 shrink-0 text-emerald-200" />
                    <div className="min-w-0 flex-1">
                      <div className="font-bold">{t("onboarding.appleRemoteIcloudDataSyncCycleTitle")}</div>
                      <div className="mt-1 opacity-85">{t("onboarding.appleRemoteIcloudDataSyncCycleBody")}</div>
                      <button
                        type="button"
                        data-testid="onboarding-icloud-data-sync-cycle-run"
                        onClick={handleRunCloudKitSyncCycle}
                        disabled={cloudKitSyncCycleBusy}
                        className="mt-3 inline-flex w-full items-center justify-center gap-2 rounded-lg bg-emerald-300 px-3 py-2 text-[11px] font-bold text-slate-950 disabled:opacity-50 sm:w-auto"
                      >
                        {cloudKitSyncCycleBusy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <ArrowRight className="h-3.5 w-3.5" />}
                        {t("onboarding.appleRemoteIcloudDataSyncCycleRun")}
                      </button>
                      {cloudKitSyncCycleMessage ? (
                        <div className="mt-2 rounded-lg border border-current/10 bg-black/10 px-2 py-1 font-bold">
                          {cloudKitSyncCycleMessage}
                        </div>
                      ) : null}
                      {cloudKitSyncCycleResult ? (
                        <div data-testid="onboarding-icloud-data-sync-cycle-result" className="mt-2 grid gap-1 rounded-lg border border-current/10 bg-black/10 p-2 font-mono text-[10px] opacity-85">
                          <div className="font-sans text-[11px] font-bold">{t("onboarding.appleRemoteIcloudDataSyncCycleResultTitle")}</div>
                          <div>{t("onboarding.appleRemoteIcloudDataSyncCycleStatus", { value: cloudKitSyncCycleResult.status })}</div>
                          <div>{t("onboarding.appleRemoteIcloudDataSyncCyclePull", {
                            changed: cloudKitSyncCycleResult.pull.changes.result.syncChangesPreview?.changed || 0,
                            applied: cloudKitSyncCycleResult.pull.apply.applied,
                            conflicts: cloudKitSyncCycleResult.pull.apply.conflicts,
                          })}</div>
                          <div>{t("onboarding.appleRemoteIcloudDataSyncCycleUpload", {
                            exported: cloudKitSyncCycleResult.upload?.export.exportRecordCount || 0,
                            saved: cloudKitSyncCycleResult.upload?.result?.syncExport?.saved || 0,
                            blocked: cloudKitSyncCycleResult.upload?.export.preview.blockedRecordCount || 0,
                          })}</div>
                          <div>{t("onboarding.appleRemoteIcloudDataSyncCycleNext", {
                            action: t(cloudKitSyncCycleNextActionKeys[cloudKitSyncCycleResult.nextAction]),
                          })}</div>
                        </div>
                      ) : null}
                    </div>
                  </div>
                </div>
                <div data-testid="onboarding-icloud-data-sync-upload-now" className="mt-2 rounded-lg border border-sky-300/20 bg-sky-500/10 p-3 text-sky-50">
                  <div className="flex items-start gap-2">
                    <Cloud className="mt-0.5 h-4 w-4 shrink-0 text-sky-200" />
                    <div className="min-w-0 flex-1">
                      <div className="font-bold">{t("onboarding.appleRemoteIcloudDataSyncUploadNowTitle")}</div>
                      <div className="mt-1 opacity-85">{t("onboarding.appleRemoteIcloudDataSyncUploadNowBody")}</div>
                      <button
                        type="button"
                        data-testid="onboarding-icloud-data-sync-upload-now-run"
                        onClick={handleRunCloudKitSyncUploadNow}
                        disabled={cloudKitSyncUploadNowBusy}
                        className="mt-3 inline-flex w-full items-center justify-center gap-2 rounded-lg bg-sky-300 px-3 py-2 text-[11px] font-bold text-slate-950 disabled:opacity-50 sm:w-auto"
                      >
                        {cloudKitSyncUploadNowBusy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <UploadCloud className="h-3.5 w-3.5" />}
                        {t("onboarding.appleRemoteIcloudDataSyncUploadNowRun")}
                      </button>
                      {cloudKitSyncUploadNowMessage ? (
                        <div className="mt-2 rounded-lg border border-current/10 bg-black/10 px-2 py-1 font-bold">
                          {cloudKitSyncUploadNowMessage}
                        </div>
                      ) : null}
                      {cloudKitSyncUploadNowResult ? (
                        <div data-testid="onboarding-icloud-data-sync-upload-now-result" className="mt-2 grid gap-1 rounded-lg border border-current/10 bg-black/10 p-2 font-mono text-[10px] opacity-85">
                          <div className="font-sans text-[11px] font-bold">{t("onboarding.appleRemoteIcloudDataSyncUploadNowResultTitle")}</div>
                          <div>{t("onboarding.appleRemoteIcloudDataSyncUploadNowStatus", { value: cloudKitSyncUploadNowResult.status })}</div>
                          <div>{t("onboarding.appleRemoteIcloudDataSyncUploadNowRecords", {
                            ready: cloudKitSyncUploadNowResult.export.preview.readyRecordCount,
                            blocked: cloudKitSyncUploadNowResult.export.preview.blockedRecordCount,
                            exported: cloudKitSyncUploadNowResult.export.exportRecordCount,
                          })}</div>
                          <div>{t("onboarding.appleRemoteIcloudDataSyncUploadNowSaved", {
                            saved: cloudKitSyncUploadNowResult.result?.syncExport?.saved || 0,
                            attempted: cloudKitSyncUploadNowResult.result?.syncExport?.attempted || 0,
                            failed: cloudKitSyncUploadNowResult.result?.syncExport?.failed || 0,
                          })}</div>
                          <div>{t("onboarding.appleRemoteIcloudDataSyncUploadNowBackup", {
                            value: cloudKitSyncUploadNowResult.backup ? t("onboarding.appleRemoteIcloudDataSyncReadyValue") : t("onboarding.appleRemoteIcloudDataSyncNotConfigured"),
                          })}</div>
                          <div>{t("onboarding.appleRemoteIcloudDataSyncUploadNowNext", {
                            action: t(cloudKitSyncUploadNowNextActionKeys[cloudKitSyncUploadNowResult.nextAction]),
                          })}</div>
                        </div>
                      ) : null}
                    </div>
                  </div>
                </div>
                <div data-testid="onboarding-icloud-data-sync-one-step" className="mt-2 rounded-lg border border-cyan-300/20 bg-cyan-500/10 p-3 text-cyan-50">
                  <div className="flex items-start gap-2">
                    <RefreshCw className="mt-0.5 h-4 w-4 shrink-0 text-cyan-200" />
                    <div className="min-w-0 flex-1">
                      <div className="font-bold">{t("onboarding.appleRemoteIcloudDataSyncNowTitle")}</div>
                      <div className="mt-1 opacity-85">{t("onboarding.appleRemoteIcloudDataSyncNowBody")}</div>
                      <button
                        type="button"
                        data-testid="onboarding-icloud-data-sync-one-step-run"
                        onClick={handleRunCloudKitSyncNow}
                        disabled={cloudKitSyncNowBusy}
                        className="mt-3 inline-flex w-full items-center justify-center gap-2 rounded-lg bg-cyan-400 px-3 py-2 text-[11px] font-bold text-slate-950 disabled:opacity-50 sm:w-auto"
                      >
                        {cloudKitSyncNowBusy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <ArrowRight className="h-3.5 w-3.5" />}
                        {t("onboarding.appleRemoteIcloudDataSyncNowRun")}
                      </button>
                      {cloudKitSyncNowMessage ? (
                        <div className="mt-2 rounded-lg border border-current/10 bg-black/10 px-2 py-1 font-bold">
                          {cloudKitSyncNowMessage}
                        </div>
                      ) : null}
                      {cloudKitSyncNowResult ? (
                        <div data-testid="onboarding-icloud-data-sync-one-step-result" className="mt-2 grid gap-1 rounded-lg border border-current/10 bg-black/10 p-2 font-mono text-[10px] opacity-85">
                          <div className="font-sans text-[11px] font-bold">{t("onboarding.appleRemoteIcloudDataSyncNowResultTitle")}</div>
                          <div>{t("onboarding.appleRemoteIcloudDataSyncNowStatus", { value: cloudKitSyncNowResult.status })}</div>
                          <div>{t("onboarding.appleRemoteIcloudDataSyncNowChanges", {
                            changed: cloudKitSyncNowResult.changes.result.syncChangesPreview?.changed || 0,
                            deleted: cloudKitSyncNowResult.changes.result.syncChangesPreview?.deleted || 0,
                            saved: cloudKitSyncNowResult.changes.savedCheckpointCount,
                          })}</div>
                          <div>{t("onboarding.appleRemoteIcloudDataSyncNowApply", {
                            attempted: cloudKitSyncNowResult.apply.attempted,
                            applied: cloudKitSyncNowResult.apply.applied,
                            review: cloudKitSyncNowResult.apply.manualReviewRequired,
                            conflicts: cloudKitSyncNowResult.apply.conflicts,
                          })}</div>
                          <div>{t("onboarding.appleRemoteIcloudDataSyncNowQuarantine", {
                            auto: cloudKitSyncNowResult.quarantine.summary.autoReady,
                            pending: cloudKitSyncNowResult.quarantine.summary.pendingReview,
                            conflicts: cloudKitSyncNowResult.quarantine.summary.conflicts,
                          })}</div>
                          <div>{t("onboarding.appleRemoteIcloudDataSyncNowNext", {
                            action: t(cloudKitSyncNowNextActionKeys[cloudKitSyncNowResult.nextAction]),
                          })}</div>
                        </div>
                      ) : null}
                    </div>
                  </div>
                </div>
                <div className="mt-2 grid gap-1 opacity-80">
                  <div>{t("onboarding.appleRemoteIcloudDataSyncContainer", { value: dataSync.containerId || t("onboarding.appleRemoteIcloudDataSyncNotConfigured") })}</div>
                  <div>{t("onboarding.appleRemoteIcloudDataSyncHelper", { value: dataSync.nativeHelper.executable ? t("onboarding.appleRemoteIcloudDataSyncReadyValue") : t("onboarding.appleRemoteIcloudDataSyncNotConfigured") })}</div>
                  <div>{t("onboarding.appleRemoteIcloudDataSyncTypes", { value: dataSync.selectedDataTypes.length ? dataSync.selectedDataTypes.join(", ") : t("onboarding.appleRemoteIcloudDataSyncNotConfigured") })}</div>
                </div>
                <div data-testid="onboarding-icloud-data-sync-acceptance-gates" className="mt-2 rounded-lg border border-current/10 bg-black/10 p-2">
                  <div className="font-bold">{t("onboarding.appleRemoteIcloudDataSyncAcceptanceGates")}</div>
                  <div className="mt-1 opacity-80">
                    {t("onboarding.appleRemoteIcloudDataSyncAcceptanceGateCounts", {
                      passed: dataSyncGateCounts.passed,
                      blocked: dataSyncGateCounts.blocked,
                      manual: dataSyncGateCounts.manual,
                    })}
                  </div>
                </div>
                {dataSync.recordPlan.length ? (
                  <div data-testid="onboarding-icloud-data-sync-record-plan" className="mt-2 rounded-lg border border-current/10 bg-black/10 p-2">
                    <div className="font-bold">{t("onboarding.appleRemoteIcloudDataSyncRecordPlan")}</div>
                    <div className="mt-1 grid gap-1 opacity-80">
                      {dataSync.recordPlan.slice(0, 3).map((item) => (
                        <div key={item.dataType}>
                          {t("onboarding.appleRemoteIcloudDataSyncRecordPlanItem", {
                            type: item.dataType,
                            zone: item.zone,
                            records: item.recordTypes.slice(0, 2).join(", "),
                          })}
                        </div>
                      ))}
                    </div>
                  </div>
                ) : null}
                <div data-testid="onboarding-icloud-data-sync-helper-run" className="mt-2 rounded-lg border border-current/10 bg-black/10 p-2">
                  <div className="font-bold">{t("onboarding.appleRemoteIcloudDataSyncHelperRunTitle")}</div>
                  <div className="mt-1 opacity-80">{t("onboarding.appleRemoteIcloudDataSyncHelperRunBody")}</div>
                  <div className="mt-2 flex flex-wrap gap-2">
                    <button
                      type="button"
                      data-testid="onboarding-icloud-data-sync-helper-probe"
                      onClick={() => handleRunCloudKitHelper("probe")}
                      disabled={Boolean(cloudKitHelperBusy)}
                      className="inline-flex items-center justify-center gap-2 rounded-lg border border-current/15 bg-black/15 px-3 py-2 text-[11px] font-bold disabled:opacity-50"
                    >
                      {cloudKitHelperBusy === "probe" ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <ShieldCheck className="h-3.5 w-3.5" />}
                      {t("onboarding.appleRemoteIcloudDataSyncHelperProbe")}
                    </button>
                    <button
                      type="button"
                      data-testid="onboarding-icloud-data-sync-helper-roundtrip"
                      onClick={() => handleRunCloudKitHelper("roundtrip")}
                      disabled={!dataSync.ready || Boolean(cloudKitHelperBusy)}
                      className="inline-flex items-center justify-center gap-2 rounded-lg border border-current/15 bg-black/15 px-3 py-2 text-[11px] font-bold disabled:opacity-50"
                    >
                      {cloudKitHelperBusy === "roundtrip" ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <ClipboardCheck className="h-3.5 w-3.5" />}
                      {t("onboarding.appleRemoteIcloudDataSyncHelperRoundtrip")}
                    </button>
                  </div>
                  <div className="mt-2 opacity-75">{t("onboarding.appleRemoteIcloudDataSyncHelperBoundary")}</div>
                  {cloudKitHelperMessage ? (
                    <div className="mt-2 rounded-lg border border-current/10 bg-black/10 px-2 py-1 font-bold">
                      {cloudKitHelperMessage}
                    </div>
                  ) : null}
                  {cloudKitHelperResult ? (
                    <div data-testid="onboarding-icloud-data-sync-helper-result" className="mt-2 grid gap-1 rounded-lg border border-current/10 bg-black/10 p-2 font-mono text-[10px] opacity-85">
                      <div className="font-sans text-[11px] font-bold">{t("onboarding.appleRemoteIcloudDataSyncHelperResultTitle")}</div>
                      <div>{t("onboarding.appleRemoteIcloudDataSyncHelperStatus", { value: `${cloudKitHelperResult.status} / ${cloudKitHelperResult.operation}` })}</div>
                      <div>{t("onboarding.appleRemoteIcloudDataSyncHelperAccount", { value: cloudKitHelperResult.accountStatus || cloudKitHelperResult.reason || t("onboarding.appleRemoteIcloudDataSyncNotConfigured") })}</div>
                      <div>{t("onboarding.appleRemoteIcloudDataSyncHelperEvidence", { value: cloudKitHelperResult.evidenceId || cloudKitHelperResult.requestHash || t("onboarding.appleRemoteIcloudDataSyncNotConfigured") })}</div>
                      <div>{t("onboarding.appleRemoteIcloudDataSyncHelperCapabilities", { value: String(cloudKitHelperResult.capabilitiesVerified?.length || 0) })}</div>
                      <div>{t("onboarding.appleRemoteIcloudDataSyncHelperRoundtripResult", {
                        value: cloudKitHelperResult.roundtrip
                          ? `${cloudKitHelperResult.roundtrip.created}/${cloudKitHelperResult.roundtrip.fetched}/${cloudKitHelperResult.roundtrip.deleted}`
                          : t("onboarding.appleRemoteIcloudDataSyncNotConfigured"),
                      })}</div>
                      <div>{t("onboarding.appleRemoteIcloudDataSyncHelperWarnings", { value: String(cloudKitHelperResult.warnings?.length || 0) })}</div>
                      <div>{t("onboarding.appleRemoteIcloudDataSyncHelperErrors", { value: String(cloudKitHelperResult.errors?.length || 0) })}</div>
                    </div>
                  ) : null}
                </div>
                <div data-testid="onboarding-icloud-data-sync-batch-preview" className="mt-2 rounded-lg border border-current/10 bg-black/10 p-2">
                  <div className="font-bold">{t("onboarding.appleRemoteIcloudDataSyncBatchTitle")}</div>
                  <div className="mt-1 opacity-80">{t("onboarding.appleRemoteIcloudDataSyncBatchBody")}</div>
                  <button
                    type="button"
                    data-testid="onboarding-icloud-data-sync-batch-load"
                    onClick={handleLoadCloudKitBatchPreview}
                    disabled={cloudKitBatchBusy}
                    className="mt-2 inline-flex items-center justify-center gap-2 rounded-lg border border-current/15 bg-black/15 px-3 py-2 text-[11px] font-bold disabled:opacity-50"
                  >
                    {cloudKitBatchBusy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <ClipboardCheck className="h-3.5 w-3.5" />}
                    {t("onboarding.appleRemoteIcloudDataSyncBatchLoad")}
                  </button>
                  {cloudKitBatchMessage ? (
                    <div className="mt-2 rounded-lg border border-current/10 bg-black/10 px-2 py-1 font-bold">
                      {cloudKitBatchMessage}
                    </div>
                  ) : null}
                  {cloudKitBatchPreview ? (
                    <div data-testid="onboarding-icloud-data-sync-batch-result" className="mt-2 grid gap-1 rounded-lg border border-current/10 bg-black/10 p-2 font-mono text-[10px] opacity-85">
                      <div className="font-sans text-[11px] font-bold">{t("onboarding.appleRemoteIcloudDataSyncBatchResultTitle")}</div>
                      <div>{t("onboarding.appleRemoteIcloudDataSyncBatchStatus", { value: cloudKitBatchPreview.status })}</div>
                      <div>{t("onboarding.appleRemoteIcloudDataSyncBatchCounts", {
                        ready: cloudKitBatchPreview.readyRecordCount,
                        blocked: cloudKitBatchPreview.blockedRecordCount,
                        total: cloudKitBatchPreview.totalCandidateCount,
                      })}</div>
                      <div>{t("onboarding.appleRemoteIcloudDataSyncBatchTypes", { value: cloudKitBatchPreview.selectedDataTypes.join(", ") || t("onboarding.appleRemoteIcloudDataSyncNotConfigured") })}</div>
                      <div>{t("onboarding.appleRemoteIcloudDataSyncBatchPayload", { value: cloudKitBatchPreview.safety.rawPayloadIncluded ? t("onboarding.appleRemoteIcloudDataSyncBatchYes") : t("onboarding.appleRemoteIcloudDataSyncBatchNo") })}</div>
                      <div>{t("onboarding.appleRemoteIcloudDataSyncBatchNext", { action: cloudKitBatchPreview.nextAction })}</div>
                      {cloudKitBatchPreview.zones.length ? (
                        <div>{t("onboarding.appleRemoteIcloudDataSyncBatchZones", { value: cloudKitBatchPreview.zones.map((item) => `${item.zone}:${item.records}`).join(", ") })}</div>
                      ) : null}
                    </div>
                  ) : null}
                  <div data-testid="onboarding-icloud-data-sync-export" className="mt-2 rounded-lg border border-current/10 bg-black/10 p-2">
                    <div className="font-bold">{t("onboarding.appleRemoteIcloudDataSyncExportTitle")}</div>
                    <div className="mt-1 opacity-80">{t("onboarding.appleRemoteIcloudDataSyncExportBody")}</div>
                    <button
                      type="button"
                      data-testid="onboarding-icloud-data-sync-export-run"
                      onClick={handleRunCloudKitSyncExport}
                      disabled={cloudKitExportBusy || cloudKitBatchPreview?.status !== "ready"}
                      className="mt-2 inline-flex items-center justify-center gap-2 rounded-lg border border-current/15 bg-black/15 px-3 py-2 text-[11px] font-bold disabled:opacity-50"
                    >
                      {cloudKitExportBusy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Cloud className="h-3.5 w-3.5" />}
                      {t("onboarding.appleRemoteIcloudDataSyncExportRun")}
                    </button>
                    {cloudKitExportMessage ? (
                      <div className="mt-2 rounded-lg border border-current/10 bg-black/10 px-2 py-1 font-bold">
                        {cloudKitExportMessage}
                      </div>
                    ) : null}
                    {cloudKitExportSummary ? (
                      <div data-testid="onboarding-icloud-data-sync-export-result" className="mt-2 grid gap-1 rounded-lg border border-current/10 bg-black/10 p-2 font-mono text-[10px] opacity-85">
                        <div className="font-sans text-[11px] font-bold">{t("onboarding.appleRemoteIcloudDataSyncExportResultTitle")}</div>
                        <div>{t("onboarding.appleRemoteIcloudDataSyncExportStatus", { value: cloudKitExportSummary.status })}</div>
                        <div>{t("onboarding.appleRemoteIcloudDataSyncExportRecords", { count: cloudKitExportSummary.exportRecordCount })}</div>
                        <div>{t("onboarding.appleRemoteIcloudDataSyncExportHash", { value: cloudKitExportSummary.recordPlanHash || t("onboarding.appleRemoteIcloudDataSyncNotConfigured") })}</div>
                        <div>{t("onboarding.appleRemoteIcloudDataSyncExportPayload", { value: cloudKitExportSummary.safety.rawPayloadReturnedToAdmin ? t("onboarding.appleRemoteIcloudDataSyncBatchYes") : t("onboarding.appleRemoteIcloudDataSyncBatchNo") })}</div>
                        {cloudKitHelperResult?.syncExport ? (
                          <div>{t("onboarding.appleRemoteIcloudDataSyncExportSaved", {
                            saved: cloudKitHelperResult.syncExport.saved,
                            attempted: cloudKitHelperResult.syncExport.attempted,
                            failed: cloudKitHelperResult.syncExport.failed,
                          })}</div>
                        ) : null}
                      </div>
                    ) : null}
                    <div data-testid="onboarding-icloud-data-sync-import-preview" className="mt-2 rounded-lg border border-current/10 bg-black/10 p-2">
                      <div className="font-bold">{t("onboarding.appleRemoteIcloudDataSyncImportPreviewTitle")}</div>
                      <div className="mt-1 opacity-80">{t("onboarding.appleRemoteIcloudDataSyncImportPreviewBody")}</div>
                      <button
                        type="button"
                        data-testid="onboarding-icloud-data-sync-import-preview-run"
                        onClick={handleRunCloudKitSyncImportPreview}
                        disabled={cloudKitImportBusy || !dataSync.ready}
                        className="mt-2 inline-flex items-center justify-center gap-2 rounded-lg border border-current/15 bg-black/15 px-3 py-2 text-[11px] font-bold disabled:opacity-50"
                      >
                        {cloudKitImportBusy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}
                        {t("onboarding.appleRemoteIcloudDataSyncImportPreviewRun")}
                      </button>
                      {cloudKitImportMessage ? (
                        <div className="mt-2 rounded-lg border border-current/10 bg-black/10 px-2 py-1 font-bold">
                          {cloudKitImportMessage}
                        </div>
                      ) : null}
                      {cloudKitHelperResult?.syncImportPreview ? (
                        <div data-testid="onboarding-icloud-data-sync-import-preview-result" className="mt-2 grid gap-1 rounded-lg border border-current/10 bg-black/10 p-2 font-mono text-[10px] opacity-85">
                          <div className="font-sans text-[11px] font-bold">{t("onboarding.appleRemoteIcloudDataSyncImportPreviewResultTitle")}</div>
                          <div>{t("onboarding.appleRemoteIcloudDataSyncImportPreviewFetched", {
                            fetched: cloudKitHelperResult.syncImportPreview.fetched,
                            failed: cloudKitHelperResult.syncImportPreview.failed,
                          })}</div>
                          <div>{t("onboarding.appleRemoteIcloudDataSyncImportPreviewTypes", {
                            value: cloudKitHelperResult.syncImportPreview.scannedRecordTypes.join(", ") || t("onboarding.appleRemoteIcloudDataSyncNotConfigured"),
                          })}</div>
                          <div>{t("onboarding.appleRemoteIcloudDataSyncImportPreviewTruncated", {
                            value: cloudKitHelperResult.syncImportPreview.truncated ? t("onboarding.appleRemoteIcloudDataSyncBatchYes") : t("onboarding.appleRemoteIcloudDataSyncBatchNo"),
                          })}</div>
                        </div>
                      ) : null}
                    </div>
                    <div data-testid="onboarding-icloud-data-sync-changes-preview" className="mt-2 rounded-lg border border-current/10 bg-black/10 p-2">
                      <div className="font-bold">{t("onboarding.appleRemoteIcloudDataSyncChangesPreviewTitle")}</div>
                      <div className="mt-1 opacity-80">{t("onboarding.appleRemoteIcloudDataSyncChangesPreviewBody")}</div>
                      <button
                        type="button"
                        data-testid="onboarding-icloud-data-sync-changes-preview-run"
                        onClick={handleRunCloudKitSyncChangesPreview}
                        disabled={cloudKitChangesBusy || !dataSync.ready}
                        className="mt-2 inline-flex items-center justify-center gap-2 rounded-lg border border-current/15 bg-black/15 px-3 py-2 text-[11px] font-bold disabled:opacity-50"
                      >
                        {cloudKitChangesBusy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}
                        {t("onboarding.appleRemoteIcloudDataSyncChangesPreviewRun")}
                      </button>
                      {cloudKitChangesMessage ? (
                        <div className="mt-2 rounded-lg border border-current/10 bg-black/10 px-2 py-1 font-bold">
                          {cloudKitChangesMessage}
                        </div>
                      ) : null}
                      {cloudKitHelperResult?.syncChangesPreview ? (
                        <div data-testid="onboarding-icloud-data-sync-changes-preview-result" className="mt-2 grid gap-1 rounded-lg border border-current/10 bg-black/10 p-2 font-mono text-[10px] opacity-85">
                          <div className="font-sans text-[11px] font-bold">{t("onboarding.appleRemoteIcloudDataSyncChangesPreviewResultTitle")}</div>
                          <div>{t("onboarding.appleRemoteIcloudDataSyncChangesPreviewCounts", {
                            changed: cloudKitHelperResult.syncChangesPreview.changed,
                            deleted: cloudKitHelperResult.syncChangesPreview.deleted,
                            failed: cloudKitHelperResult.syncChangesPreview.failed,
                          })}</div>
                          <div>{t("onboarding.appleRemoteIcloudDataSyncChangesPreviewZones", {
                            value: cloudKitHelperResult.syncChangesPreview.scannedZones.join(", ") || t("onboarding.appleRemoteIcloudDataSyncNotConfigured"),
                          })}</div>
                          <div>{t("onboarding.appleRemoteIcloudDataSyncChangesPreviewCheckpoint", {
                            count: cloudKitCheckpoints.filter((item) => item.pendingServerChangeTokenPresent).length,
                          })}</div>
                          <div>{t("onboarding.appleRemoteIcloudDataSyncChangesPreviewMoreComing", {
                            value: cloudKitHelperResult.syncChangesPreview.moreComing ? t("onboarding.appleRemoteIcloudDataSyncBatchYes") : t("onboarding.appleRemoteIcloudDataSyncBatchNo"),
                          })}</div>
                        </div>
                      ) : null}
                    </div>
                    <div data-testid="onboarding-icloud-data-sync-import-quarantine" className="mt-2 rounded-lg border border-current/10 bg-black/10 p-2">
                      <div className="font-bold">{t("onboarding.appleRemoteIcloudDataSyncImportQuarantineTitle")}</div>
                      <div className="mt-1 opacity-80">{t("onboarding.appleRemoteIcloudDataSyncImportQuarantineBody")}</div>
                      <button
                        type="button"
                        data-testid="onboarding-icloud-data-sync-import-quarantine-run"
                        onClick={handleRunCloudKitSyncImportQuarantine}
                        disabled={cloudKitQuarantineBusy || !dataSync.ready}
                        className="mt-2 inline-flex items-center justify-center gap-2 rounded-lg border border-current/15 bg-black/15 px-3 py-2 text-[11px] font-bold disabled:opacity-50"
                      >
                        {cloudKitQuarantineBusy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <ClipboardPaste className="h-3.5 w-3.5" />}
                        {t("onboarding.appleRemoteIcloudDataSyncImportQuarantineRun")}
                      </button>
                      {cloudKitQuarantineMessage ? (
                        <div className="mt-2 rounded-lg border border-current/10 bg-black/10 px-2 py-1 font-bold">
                          {cloudKitQuarantineMessage}
                        </div>
                      ) : null}
                      {cloudKitHelperResult?.syncImportQuarantine || cloudKitQuarantineSummary ? (
                        <div data-testid="onboarding-icloud-data-sync-import-quarantine-result" className="mt-2 grid gap-1 rounded-lg border border-current/10 bg-black/10 p-2 font-mono text-[10px] opacity-85">
                          <div className="font-sans text-[11px] font-bold">{t("onboarding.appleRemoteIcloudDataSyncImportQuarantineResultTitle")}</div>
                          {cloudKitHelperResult?.syncImportQuarantine ? (
                            <div>{t("onboarding.appleRemoteIcloudDataSyncImportQuarantineCounts", {
                              changed: cloudKitHelperResult.syncImportQuarantine.changed,
                              deleted: cloudKitHelperResult.syncImportQuarantine.deleted,
                              failed: cloudKitHelperResult.syncImportQuarantine.failed,
                            })}</div>
                          ) : null}
                          {cloudKitQuarantineSummary ? (
                            <>
                              <div>{t("onboarding.appleRemoteIcloudDataSyncImportQuarantineStored", {
                                changed: cloudKitQuarantineSummary.importedChanged,
                                deleted: cloudKitQuarantineSummary.importedDeleted,
                                skipped: cloudKitQuarantineSummary.skipped,
                              })}</div>
                              <div>{t("onboarding.appleRemoteIcloudDataSyncImportQuarantinePending", {
                                auto: cloudKitQuarantineSummary.autoReady,
                                count: cloudKitQuarantineSummary.pendingReview,
                              })}</div>
                              <div>{t("onboarding.appleRemoteIcloudDataSyncImportQuarantinePayload", {
                                value: cloudKitQuarantineSummary.payloadStored ? t("onboarding.appleRemoteIcloudDataSyncBatchYes") : t("onboarding.appleRemoteIcloudDataSyncBatchNo"),
                              })}</div>
                            </>
                          ) : null}
                        </div>
                      ) : null}
                    </div>
                    <div data-testid="onboarding-icloud-data-sync-apply-quarantine" className="mt-2 rounded-lg border border-current/10 bg-black/10 p-2">
                      <div className="font-bold">{t("onboarding.appleRemoteIcloudDataSyncApplyQuarantineTitle")}</div>
                      <div className="mt-1 opacity-80">{t("onboarding.appleRemoteIcloudDataSyncApplyQuarantineBody")}</div>
                      <div
                        data-testid="onboarding-icloud-data-sync-quarantine-next"
                        data-cloudkit-quarantine-next={cloudKitQuarantineNextAction}
                        className="mt-2 rounded-lg border border-cyan-300/20 bg-cyan-500/10 p-2 text-cyan-50"
                      >
                        <div className="text-[10px] font-bold uppercase tracking-normal text-cyan-100/70">
                          {t("onboarding.appleRemoteIcloudDataSyncQuarantineNextLabel")}
                        </div>
                        <div className="mt-1 font-bold">{t(cloudKitQuarantineNextTitleKey)}</div>
                        <div className="mt-1 text-[11px] leading-relaxed text-cyan-50/80">
                          {t(cloudKitQuarantineNextBodyKey, {
                            count: cloudKitQuarantineAutoReady || cloudKitQuarantineAppliedCount,
                            review: cloudKitQuarantineReviewCount,
                          })}
                        </div>
                        <button
                          type="button"
                          data-testid="onboarding-icloud-data-sync-quarantine-next-action"
                          onClick={handleCloudKitQuarantineNextAction}
                          disabled={cloudKitQuarantineNextDisabled}
                          className="mt-2 inline-flex w-full items-center justify-center gap-2 rounded-lg bg-cyan-300 px-3 py-2 text-[11px] font-bold text-[#061016] disabled:opacity-50"
                        >
                          {cloudKitQuarantineNextBusy ? (
                            <Loader2 className="h-3.5 w-3.5 animate-spin" />
                          ) : cloudKitQuarantineNextAction === "apply" ? (
                            <ShieldCheck className="h-3.5 w-3.5" />
                          ) : cloudKitQuarantineNextAction === "load" ? (
                            <ClipboardCheck className="h-3.5 w-3.5" />
                          ) : (
                            <ArrowRight className="h-3.5 w-3.5" />
                          )}
                          {t(cloudKitQuarantineNextCtaKey, {
                            count: cloudKitQuarantineAutoReady || cloudKitQuarantineAppliedCount,
                            review: cloudKitQuarantineReviewCount,
                          })}
                        </button>
                      </div>
                      <div className="mt-2 flex flex-wrap gap-2">
                        <button
                          type="button"
                          data-testid="onboarding-icloud-data-sync-quarantine-load"
                          onClick={handleLoadCloudKitSyncQuarantine}
                          className="inline-flex items-center justify-center gap-2 rounded-lg border border-current/15 bg-black/15 px-3 py-2 text-[11px] font-bold disabled:opacity-50"
                        >
                          <ClipboardCheck className="h-3.5 w-3.5" />
                          {t("onboarding.appleRemoteIcloudDataSyncApplyQuarantineLoad")}
                        </button>
                        <button
                          type="button"
                          data-testid="onboarding-icloud-data-sync-apply-quarantine-run"
                          onClick={handleApplyCloudKitSyncQuarantine}
                          disabled={cloudKitApplyBusy || !((cloudKitQuarantineSummary?.autoReady || 0) + (cloudKitQuarantineSummary?.pendingReview || 0))}
                          className="inline-flex items-center justify-center gap-2 rounded-lg border border-current/15 bg-black/15 px-3 py-2 text-[11px] font-bold disabled:opacity-50"
                        >
                          {cloudKitApplyBusy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <ShieldCheck className="h-3.5 w-3.5" />}
                          {t("onboarding.appleRemoteIcloudDataSyncApplyQuarantineRun")}
                        </button>
                      </div>
                      {cloudKitApplyMessage ? (
                        <div className="mt-2 rounded-lg border border-current/10 bg-black/10 px-2 py-1 font-bold">
                          {cloudKitApplyMessage}
                        </div>
                      ) : null}
                      {cloudKitQuarantineSummary ? (
                        <div data-testid="onboarding-icloud-data-sync-apply-quarantine-summary" className="mt-2 grid gap-1 rounded-lg border border-current/10 bg-black/10 p-2 font-mono text-[10px] opacity-85">
                          <div className="font-sans text-[11px] font-bold">{t("onboarding.appleRemoteIcloudDataSyncApplyQuarantineResultTitle")}</div>
                          <div>{t("onboarding.appleRemoteIcloudDataSyncApplyQuarantineSummary", {
                            auto: cloudKitQuarantineSummary.autoReady,
                            pending: cloudKitQuarantineSummary.pendingReview,
                            applied: cloudKitQuarantineSummary.applied,
                            conflicts: cloudKitQuarantineSummary.conflicts,
                          })}</div>
                          <div>{t("onboarding.appleRemoteIcloudDataSyncApplyQuarantineFailedCount", {
                            failed: cloudKitQuarantineSummary.failed,
                            skipped: cloudKitQuarantineSummary.skipped,
                          })}</div>
                          {cloudKitApplyResult ? (
                            <>
                              <div>{t("onboarding.appleRemoteIcloudDataSyncApplyQuarantineCounts", {
                                attempted: cloudKitApplyResult.attempted,
                                applied: cloudKitApplyResult.applied,
                                review: cloudKitApplyResult.manualReviewRequired,
                                conflicts: cloudKitApplyResult.conflicts,
                                failed: cloudKitApplyResult.failed,
                              })}</div>
                              <div>{t("onboarding.appleRemoteIcloudDataSyncApplyQuarantinePromotedZones", {
                                value: cloudKitApplyResult.promotedZones.join(", ") || t("onboarding.appleRemoteIcloudDataSyncNotConfigured"),
                              })}</div>
                              <div>{t("onboarding.appleRemoteIcloudDataSyncApplyQuarantineBlockedZones", {
                                value: cloudKitApplyResult.blockedZones.join(", ") || t("onboarding.appleRemoteIcloudDataSyncNotConfigured"),
                              })}</div>
                            </>
                          ) : null}
                          {cloudKitQuarantineItems.length ? (
                            <div className="mt-1 grid gap-1">
                              {cloudKitQuarantineItems.slice(0, 6).map((item) => (
                                <div key={item.id} className="rounded-md bg-black/15 px-2 py-1">
                                  {t("onboarding.appleRemoteIcloudDataSyncApplyQuarantineItem", {
                                    recordType: item.recordType,
                                    status: item.status,
                                    recordName: item.recordName,
                                  })}
                                  {item.error ? <span className="ml-1 opacity-70">{item.error}</span> : null}
                                </div>
                              ))}
                            </div>
                          ) : (
                            <div>{t("onboarding.appleRemoteIcloudDataSyncApplyQuarantineEmpty")}</div>
                          )}
                        </div>
                      ) : null}
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        ) : null}
        <div className="mt-3 rounded-xl border border-white/[0.06] bg-[#060a10]/45 p-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <span className="font-bold text-zinc-100">{t("onboarding.appleRemoteIcloudStatus")}</span>
            <span className={`rounded-full px-2 py-0.5 text-[10px] font-bold ${canExportIcloud ? "bg-emerald-500/15 text-emerald-100" : "bg-amber-500/15 text-amber-100"}`}>
              {canExportIcloud ? t("onboarding.appleRemoteIcloudReady") : t("onboarding.appleRemoteIcloudUnavailable")}
            </span>
          </div>
          <div data-testid="onboarding-icloud-desktop-one-next" className="mt-3 rounded-xl border border-cyan-300/20 bg-cyan-500/10 p-3 text-cyan-50">
            <div className="text-[10px] font-bold uppercase tracking-normal text-cyan-100/70">
              {t("onboarding.appleRemoteIcloudRepairNextActionLabel")}
            </div>
            <div className="mt-1 font-bold">{t(desktopIcloudOneNextTitleKey)}</div>
            <div className="mt-1 text-[11px] leading-relaxed text-cyan-50/80">{t(desktopIcloudOneNextBodyKey)}</div>
            <div className="mt-2 rounded-lg border border-cyan-100/10 bg-black/15 p-2 text-[11px] font-bold">
              {t("onboarding.appleRemoteIcloudOneNextAction", {
                action: t(desktopIcloudOneNextActionKey),
              })}
            </div>
            <div data-testid="onboarding-icloud-desktop-one-next-action">
              {renderDesktopIcloudOneNextAction()}
            </div>
          </div>
          <details data-testid="onboarding-icloud-status-recovery-details" className="mt-3 rounded-xl border border-white/[0.06] bg-[#060a10]/30 p-3 text-[11px] text-zinc-300">
            <summary className="cursor-pointer font-bold text-zinc-100">{t("onboarding.appleRemoteIcloudStatusAndRecoveryDetails")}</summary>
            <div className="mt-3 grid gap-3">
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
                <div data-testid="onboarding-icloud-one-step-guide" className="mt-3 rounded-xl border border-current/10 bg-black/15 p-3 text-[11px] leading-relaxed">
                  <div className="flex items-start gap-2 font-bold">
                    <ArrowRight className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                    <span>
                      {t("onboarding.appleRemoteIcloudOneNextAction", {
                        action: t(primaryIcloudAction.actionKey),
                      })}
                    </span>
                  </div>
                  <div className="mt-2 border-t border-current/10 pt-2 opacity-85">
                    <span className="font-bold">{t("onboarding.appleRemoteIcloudThenLabel")}</span>{" "}
                    {t(primaryIcloudActionFollowupKey)}
                  </div>
                </div>
                {renderPrimaryIcloudActionButton()}
              </div>
            </div>
          </div>
          {syncReadiness ? (
            <div data-testid="onboarding-icloud-human-sync-step" className={`mt-3 rounded-xl border p-3 ${syncReadinessTone}`}>
              <div className="flex gap-2">
                {syncReadiness.canOpenOnPhone ? <Smartphone className="mt-0.5 h-4 w-4 shrink-0" /> : syncReadiness.action === "wait-for-sync" ? <Loader2 className="mt-0.5 h-4 w-4 shrink-0 animate-spin" /> : syncReadiness.action === "fix-icloud-sync" || syncReadiness.severity === "danger" ? <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" /> : <Cloud className="mt-0.5 h-4 w-4 shrink-0" />}
                <div className="min-w-0 flex-1">
                  <div className="text-[10px] font-bold uppercase tracking-normal opacity-70">{t("onboarding.appleRemoteIcloudHumanLabel")}</div>
                  <div className="mt-1 font-bold">{syncHumanRecovery ? t(syncHumanRecoveryTitleKey) : humanSyncStep ? t(humanSyncStep.title) : t(syncUserStepTitleKey)}</div>
                  <div className="mt-1 text-[11px] leading-relaxed opacity-80">
                    {syncHumanRecovery ? t(syncHumanRecoveryBodyKey, { count: syncReadiness.pendingCount, minutes: icloudSyncStuckMinutes }) : humanSyncStep ? t(humanSyncStep.body, { count: syncReadiness.pendingCount, minutes: icloudSyncStuckMinutes }) : t(syncUserStepBodyKey, { count: syncReadiness.userStep.pendingCount, minutes: icloudSyncStuckMinutes })}
                  </div>
                  <div className="mt-3 flex items-start gap-2 rounded-lg border border-current/10 bg-black/15 p-2 text-[11px] font-bold">
                    <ArrowRight className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                    <span>{t("onboarding.appleRemoteIcloudOneNextAction", { action: syncHumanRecovery ? t(syncHumanRecoveryCtaKey) : syncReadinessActionText })}</span>
                  </div>
                  {syncHumanRecovery ? (
                    <div data-testid="onboarding-icloud-human-recovery-after" className="mt-2 rounded-lg border border-current/10 bg-black/15 p-2 text-[11px] leading-relaxed opacity-85">
                      <span className="font-bold">{t("onboarding.appleRemoteIcloudThenLabel")}</span>{" "}
                      {t(syncHumanRecoveryAfterKey, { count: syncReadiness.pendingCount, minutes: icloudSyncStuckMinutes })}
                    </div>
                  ) : null}
                  {syncHumanRecovery?.tipKey ? (
                    <div data-testid="onboarding-icloud-human-recovery-tip" className="mt-2 rounded-lg border border-current/10 bg-black/15 p-2 text-[11px] leading-relaxed opacity-85">
                      {t(syncHumanRecoveryTipKey, { count: syncReadiness.pendingCount, minutes: icloudSyncStuckMinutes })}
                    </div>
                  ) : null}
                  {(syncHumanRecovery?.showTechnicalDetails || !syncHumanRecovery) && (syncUserStepPendingFiles.length || syncUserStepMissingFiles.length) ? (
                    <div data-testid="onboarding-icloud-human-sync-files" className="mt-2 rounded-lg border border-current/10 bg-black/15 p-2 text-[10px] leading-relaxed">
                      {syncUserStepPendingFiles.length ? (
                        <div>
                          <span className="font-bold">{t("onboarding.appleRemoteIcloudWaitingForFiles")}</span>{" "}
                          {syncUserStepPendingFiles.map((file) => t(icloudFileLabelKeys[file])).join(t("onboarding.appleRemoteIcloudFileListSeparator"))}
                        </div>
                      ) : null}
                      {syncUserStepMissingFiles.length ? (
                        <div className={syncUserStepPendingFiles.length ? "mt-1" : ""}>
                          <span className="font-bold">{t("onboarding.appleRemoteIcloudMissingFiles")}</span>{" "}
                          {syncUserStepMissingFiles.map((file) => t(icloudFileLabelKeys[file])).join(t("onboarding.appleRemoteIcloudFileListSeparator"))}
                        </div>
                      ) : null}
                    </div>
                  ) : null}
                  {["export-entry", "refresh-entry"].includes(syncReadiness.action) ? (
                    <button
                      type="button"
                      data-testid="onboarding-icloud-human-sync-export"
                      onClick={onExportIcloud}
                      disabled={!canExportIcloud || isBusy}
                      className="mt-3 inline-flex items-center justify-center gap-2 rounded-xl border border-current/15 bg-black/15 px-3 py-2 text-xs font-bold disabled:opacity-50"
                    >
                      {isIcloudBusy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}
                      {t("onboarding.appleRemoteRefreshIcloud")}
                    </button>
                  ) : null}
                  {["enable-icloud-drive", "fix-permissions", "fix-icloud-sync"].includes(syncReadiness.action) && onOpenIcloudSettings ? (
                    <button
                      type="button"
                      data-testid="onboarding-icloud-human-sync-settings"
                      onClick={onOpenIcloudSettings}
                      disabled={busy === "desktop-icloudSettings"}
                      className="mt-3 inline-flex items-center justify-center gap-2 rounded-xl border border-current/15 bg-black/15 px-3 py-2 text-xs font-bold disabled:opacity-50"
                    >
                      {busy === "desktop-icloudSettings" ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Cloud className="h-3.5 w-3.5" />}
                      {t("onboarding.simpleIcloudOpenSettings")}
                    </button>
                  ) : null}
                  {["wait-for-sync", "open-files-app"].includes(syncReadiness.action) && onOpenIcloudFolder ? (
                    <button
                      type="button"
                      data-testid="onboarding-icloud-human-sync-folder"
                      onClick={onOpenIcloudFolder}
                      disabled={busy === "desktop-icloudFolder"}
                      className="mt-3 inline-flex items-center justify-center gap-2 rounded-xl border border-current/15 bg-black/15 px-3 py-2 text-xs font-bold disabled:opacity-50"
                    >
                      {busy === "desktop-icloudFolder" ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Cloud className="h-3.5 w-3.5" />}
                      {t("onboarding.simpleIcloudOpenFolder")}
                    </button>
                  ) : null}
                </div>
              </div>
            </div>
          ) : null}
          {syncReadiness ? (
            <details data-testid="onboarding-icloud-sync-details" className={`mt-3 rounded-xl border p-3 ${syncReadinessTone}`}>
              <summary className="cursor-pointer font-bold">{t("onboarding.appleRemoteIcloudSyncDetailsSummary")}</summary>
              <div className="mt-3 flex gap-2">
                {syncReadiness.canOpenOnPhone ? <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" /> : syncReadiness.status === "syncing" ? <Loader2 className="mt-0.5 h-4 w-4 shrink-0 animate-spin" /> : <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />}
                <div>
                  <div className="font-bold">{t(icloudSyncReadinessKeys[syncReadiness.status])}</div>
                  <div className="mt-1 text-[11px] leading-relaxed opacity-80">
                    <div className="font-bold">{t(syncUserStepTitleKey)}</div>
                    <div className="mt-0.5">{t(syncUserStepBodyKey, { count: syncReadiness.userStep.pendingCount, minutes: icloudSyncStuckMinutes })}</div>
                    <div className="mt-2 flex items-start gap-2 rounded-lg border border-current/10 bg-black/15 p-2 font-bold">
                      <ArrowRight className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                      <span>
                        {t("onboarding.appleRemoteIcloudOneNextAction", { action: syncReadinessActionText })}
                      </span>
                    </div>
                  </div>
                </div>
              </div>
            </details>
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
                  {focusedIcloudAcceptanceItem ? (
                    <div data-testid="onboarding-icloud-acceptance-focused-real-device" className="mt-3 rounded-xl border border-cyan-200/20 bg-cyan-400/10 p-3 text-[11px] leading-relaxed">
                      <div className="flex items-start gap-2">
                        <Smartphone className="mt-0.5 h-4 w-4 shrink-0" />
                        <div className="min-w-0 flex-1">
                          <div className="text-[10px] font-bold uppercase tracking-normal opacity-70">{t("onboarding.appleRemoteIcloudAcceptanceFocusTitle")}</div>
                          <div className="mt-1 font-bold">{t(icloudAcceptanceItemKeys[focusedIcloudAcceptanceItem.id])}</div>
                          <div className="mt-1 opacity-85">{t(icloudAcceptanceEvidenceKeys[focusedIcloudAcceptanceItem.id])}</div>
                          <div className="mt-2 rounded-lg border border-current/10 bg-black/15 p-2 font-bold">
                            {t(icloudManualAcceptanceRequirementKeys[focusedIcloudAcceptanceItem.id] as TranslationKey)}
                          </div>
                          <label className="mt-3 block font-bold">{t("onboarding.appleRemoteIcloudAcceptanceNoteLabel")}</label>
                          <textarea
                            value={icloudAcceptanceNotes[focusedIcloudAcceptanceItem.id] || ""}
                            onChange={(event) => setIcloudAcceptanceNotes((current) => ({ ...current, [focusedIcloudAcceptanceItem.id]: event.target.value }))}
                            placeholder={t(`onboarding.appleRemoteIcloudAcceptancePlaceholder.${focusedIcloudAcceptanceItem.id}` as any)}
                            className="mt-1 min-h-20 w-full resize-y rounded-lg border border-current/10 bg-black/20 px-2 py-2 text-[11px] outline-none placeholder:opacity-45"
                          />
                          <div className="mt-1 text-[10px] opacity-70">
                            {t("onboarding.appleRemoteIcloudAcceptanceNoteHint", { count: (icloudAcceptanceNotes[focusedIcloudAcceptanceItem.id] || "").trim().length })}
                          </div>
                          <button
                            type="button"
                            data-testid="onboarding-icloud-acceptance-focused-record"
                            onClick={() => handleRecordIcloudAcceptance(focusedIcloudAcceptanceItem)}
                            disabled={acceptingIcloudItem === focusedIcloudAcceptanceItem.id || (icloudAcceptanceNotes[focusedIcloudAcceptanceItem.id] || "").trim().length < 24}
                            className="mt-2 inline-flex w-full items-center justify-center gap-2 rounded-lg border border-current/15 bg-black/20 px-2.5 py-2 text-[11px] font-bold disabled:opacity-50"
                          >
                            {acceptingIcloudItem === focusedIcloudAcceptanceItem.id ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <ClipboardCheck className="h-3.5 w-3.5" />}
                            {acceptingIcloudItem === focusedIcloudAcceptanceItem.id ? t("onboarding.appleRemoteIcloudAcceptanceRecording") : t("onboarding.appleRemoteIcloudAcceptanceRecord")}
                          </button>
                        </div>
                      </div>
                    </div>
                  ) : null}
                  <div className="mt-2 grid gap-1.5">
                    {visibleIcloudAcceptanceItems
                      .map((item) => {
                        const manualRequirementKey = icloudManualAcceptanceRequirementKeys[item.id];
                        const note = icloudAcceptanceNotes[item.id] || "";
                        const canRecord = item.status === "manual-required" && Boolean(manualRequirementKey);
                        return (
                          <div key={item.id} className={`rounded-lg border px-2 py-1.5 text-[11px] ${icloudAcceptanceStatusTone(item.status)}`}>
                            <div className="flex flex-wrap items-center justify-between gap-2">
                              <span className="font-bold">{t(icloudAcceptanceItemKeys[item.id])}</span>
                              <span className="text-[10px] font-bold opacity-75">{t(`onboarding.appleRemoteIcloudAcceptanceStatus.${item.status}` as any)}</span>
                            </div>
                            <div className="mt-1 opacity-80">{t(icloudAcceptanceEvidenceKeys[item.id])}</div>
                            <details className="mt-1 text-[10px] opacity-60">
                              <summary className="cursor-pointer font-bold">{t("onboarding.appleRemoteIcloudAcceptanceEvidenceDetail")}</summary>
                              <div className="mt-1 break-words">{item.evidence}</div>
                            </details>
                            {canRecord ? (
                              <div data-testid="onboarding-icloud-acceptance-manual" className="mt-2 rounded-lg border border-current/10 bg-black/15 p-2">
                                <div className="font-bold">{t("onboarding.appleRemoteIcloudAcceptanceManualTitle")}</div>
                                <div className="mt-1 opacity-80">{t(manualRequirementKey as TranslationKey)}</div>
                                <label className="mt-2 block font-bold">{t("onboarding.appleRemoteIcloudAcceptanceNoteLabel")}</label>
                                <textarea
                                  value={note}
                                  onChange={(event) => setIcloudAcceptanceNotes((current) => ({ ...current, [item.id]: event.target.value }))}
                                  placeholder={t(`onboarding.appleRemoteIcloudAcceptancePlaceholder.${item.id}` as any)}
                                  className="mt-1 min-h-16 w-full resize-y rounded-lg border border-current/10 bg-black/20 px-2 py-2 text-[11px] outline-none placeholder:opacity-45"
                                />
                                <div className="mt-1 text-[10px] opacity-70">{t("onboarding.appleRemoteIcloudAcceptanceNoteHint", { count: note.trim().length })}</div>
                                <button
                                  type="button"
                                  onClick={() => handleRecordIcloudAcceptance(item)}
                                  disabled={acceptingIcloudItem === item.id || note.trim().length < 24}
                                  className="mt-2 inline-flex w-full items-center justify-center gap-2 rounded-lg border border-current/15 bg-black/20 px-2.5 py-2 text-[11px] font-bold disabled:opacity-50"
                                >
                                  {acceptingIcloudItem === item.id ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <ClipboardCheck className="h-3.5 w-3.5" />}
                                  {acceptingIcloudItem === item.id ? t("onboarding.appleRemoteIcloudAcceptanceRecording") : t("onboarding.appleRemoteIcloudAcceptanceRecord")}
                                </button>
                              </div>
                            ) : null}
                          </div>
                        );
                      })}
                  </div>
                  {icloudAcceptanceMessage ? (
                    <div className="mt-2 rounded-lg border border-current/10 bg-black/10 p-2 text-[11px] font-bold opacity-90">
                      {icloudAcceptanceMessage}
                    </div>
                  ) : null}
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
                  {renderLatestEntryRepairPrimaryAction(latestEntryRepair)}
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
                  {latestRepairImportNextActionLabel ? (
                    <div className="mt-2 rounded-lg border border-current/10 bg-black/10 p-2 text-[11px] font-bold">
                      {t("onboarding.appleRemoteIcloudRepairNextAction", { action: latestRepairImportNextActionLabel })}
                    </div>
                  ) : null}
                  {latestRepairImportNextAction ? (
                    <div data-testid="onboarding-icloud-latest-repair-primary-action" className="mt-3">
                      <div className="mb-2 text-[11px] font-bold opacity-80">{t("onboarding.appleRemoteIcloudRepairNextActionLabel")}</div>
                      {renderRepairRecommendationAction(latestRepairImportNextAction)}
                    </div>
                  ) : null}
                  {latestRepairImportNextAction && latestRepairImport.recommendations.some((item) => item.id !== latestRepairImportNextAction.id) ? (
                    <details data-testid="onboarding-icloud-latest-repair-secondary-actions" className="mt-3 rounded-xl border border-current/10 bg-black/10 p-3 text-[11px]">
                      <summary className="cursor-pointer font-bold opacity-80">{t("onboarding.appleRemoteIcloudRepairActions")}</summary>
                      <div className="mt-2 grid gap-2 sm:grid-cols-2">
                        {latestRepairImport.recommendations.filter((item) => item.id !== latestRepairImportNextAction.id).map((item) => (
                          renderRepairRecommendationAction(item)
                        ))}
                      </div>
                    </details>
                  ) : null}
                </div>
              </div>
            </div>
          ) : null}
          {icloudCleanupNeeded && icloudLifecycle ? (
            <div data-testid="onboarding-icloud-cleanup-next-step" className="mt-3 rounded-xl border border-amber-300/20 bg-amber-500/10 p-3 text-amber-50">
              <div className="flex gap-2">
                <RefreshCw className="mt-0.5 h-4 w-4 shrink-0" />
                <div className="min-w-0 flex-1">
                  <div className="font-bold">{t("onboarding.appleRemoteIcloudCleanupNextTitle")}</div>
                  <div className="mt-1 text-[11px] leading-relaxed text-amber-50/80">
                    {t("onboarding.appleRemoteIcloudCleanupNextBody", {
                      entries: icloudLifecycle.prunableEntryCount,
                      files: icloudLifecycle.orphanedFileCount,
                    })}
                  </div>
                  <div className="mt-2 rounded-lg border border-current/10 bg-black/10 p-2 text-[11px] font-bold">
                    {t("onboarding.appleRemoteIcloudOneNextAction", { action: t("onboarding.appleRemoteIcloudCleanupButton") })}
                  </div>
                  <button
                    type="button"
                    onClick={onCleanupIcloud}
                    disabled={isBusy}
                    className="mt-3 inline-flex w-full items-center justify-center gap-2 rounded-xl bg-amber-300 px-3 py-2 text-xs font-bold text-zinc-950 shadow-lg shadow-amber-950/20 transition hover:bg-amber-200 disabled:opacity-50"
                  >
                    {isIcloudCleanupBusy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}
                    {isIcloudCleanupBusy ? t("onboarding.appleRemoteIcloudCleanupCleaning") : t("onboarding.appleRemoteIcloudCleanupButton")}
                  </button>
                </div>
              </div>
            </div>
          ) : null}
            </div>
          </details>
          <details className="mt-3 rounded-xl border border-white/[0.06] bg-[#060a10]/30 p-3 text-[11px] text-zinc-500">
            <summary className="cursor-pointer font-bold text-zinc-200">{t("onboarding.appleRemoteIcloudAdvancedDiagnostics")}</summary>
            <div className="mt-3 break-all font-mono text-[11px] text-zinc-500">
              {icloud?.handoffFilePath || icloud?.openInstruction || t("onboarding.appleRemoteIcloudNoPath")}
            </div>
            {latestEntryRepair && latestEntryRepair.status !== "none" ? (
              <div className="mt-3 border-t border-white/[0.06] pt-3">
                <div className="font-bold text-zinc-200">{t("onboarding.appleRemoteIcloudRepairUrlDiagnostics")}</div>
                {renderLatestEntryRepairUrls(latestEntryRepair)}
              </div>
            ) : null}
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
                <details className="mt-3 rounded-xl border border-white/[0.06] bg-black/10 p-2">
                  <summary className="cursor-pointer font-bold text-zinc-200">{t("onboarding.appleRemoteIcloudFileTitle")}</summary>
                  <div className="mt-2 grid gap-1.5">
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
                </details>
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
                {duplicateIcloudDesktopNames.size ? (
                  <div className="mt-2 rounded-lg border border-sky-400/20 bg-sky-500/10 p-2 text-[11px] leading-relaxed text-sky-50">
                    {t("onboarding.appleRemoteIcloudDuplicateDesktopHint")}
                  </div>
                ) : null}
                <div className="mt-2 grid gap-2">
                  {availableEntries.map((entry) => {
                    const state = icloudEntryState(entry);
                    const isCurrentDesktop = entry.desktopId === icloud?.desktopId;
                    const shortDesktopId = getIcloudDesktopShortId(entry);
                    const hasDuplicateName = duplicateIcloudDesktopNames.has(icloudDesktopNameKey(entry.desktopName));
                    return (
                      <div key={`${entry.desktopId}-${entry.generatedAt}`} className="rounded-lg border border-white/[0.05] bg-white/[0.03] p-2">
                        <div className="flex flex-wrap items-center justify-between gap-2">
                          <div className="font-bold text-zinc-200">
                            {entry.desktopName}
                            {hasDuplicateName ? <span className="ml-2 text-[10px] text-zinc-400">{t("onboarding.appleRemoteIcloudEntryShortId", { id: shortDesktopId })}</span> : null}
                            {isCurrentDesktop ? <span className="ml-2 text-[10px] text-sky-200">{t("onboarding.appleRemoteIcloudEntryCurrent")}</span> : null}
                          </div>
                          <span className={`rounded-full px-2 py-0.5 text-[10px] font-bold ${state.className}`}>
                            {t(state.key)}
                          </span>
                        </div>
                        <div className="mt-1 break-all font-mono text-[10px] text-zinc-400">{entry.baseUrl}</div>
                        <div className="mt-1 flex flex-wrap gap-x-3 gap-y-1 text-[10px] text-zinc-500">
                          <span>{t("onboarding.appleRemoteIcloudEntryShortId", { id: shortDesktopId })}</span>
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
                <div className="mt-3 text-[11px] font-bold opacity-80">{t("onboarding.appleRemoteIcloudRepairNextActionLabel")}</div>
                <div className="mt-2">
                  {renderRepairRecommendationAction(repairAnalysis.nextAction)}
                </div>
                {repairAnalysis.recommendations.some((item) => item.id !== repairAnalysis.nextAction.id) ? (
                  <details className="mt-3 rounded-xl border border-current/10 bg-black/10 p-3 text-[11px]">
                    <summary className="cursor-pointer font-bold opacity-80">{t("onboarding.appleRemoteIcloudRepairActions")}</summary>
                    <div className="mt-2 grid gap-2 sm:grid-cols-2">
                      {repairAnalysis.recommendations.filter((item) => item.id !== repairAnalysis.nextAction.id).map((item) => (
                        renderRepairRecommendationAction(item)
                      ))}
                    </div>
                  </details>
                ) : null}
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
