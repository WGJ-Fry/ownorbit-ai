import type { TranslationKey } from "../../i18n/translations";
import type { NetworkDiagnostics } from "../../services/lifeosApi";

type IcloudLatestEntryRepair = NonNullable<NetworkDiagnostics["icloud"]["latestEntryRepair"]>;

export type IcloudPrimaryStepId =
  | "use-qr-or-tunnel"
  | "enable-icloud-drive"
  | "refresh-entry"
  | "refresh-entry-and-qr"
  | "generate-qr"
  | "create-entry"
  | "fix-icloud-sync"
  | "wait-for-icloud-sync"
  | "open-files-app"
  | "open-files-app-same-wifi"
  | "review";

export type IcloudPrimaryDesktopAction =
  | "none"
  | "open-connection-guide"
  | "open-icloud-settings"
  | "open-icloud-folder"
  | "export-icloud-entry"
  | "refresh-icloud-entry"
  | "regenerate-qr";

export type IcloudPrimaryPhoneAction =
  | "none"
  | "open-files-app"
  | "open-files-app-after-sync"
  | "open-latest-entry"
  | "scan-qr"
  | "same-wifi-only";

export type IcloudPrimaryAction = {
  tone: string;
  icon: "ready" | "refresh" | "qr" | "sync" | "warning" | "phone";
  titleKey: TranslationKey;
  bodyKey: TranslationKey;
  actionKey: TranslationKey;
  cta: "export" | "qr" | "remote-guide" | "icloud-settings" | "icloud-folder" | "none";
  stepId: IcloudPrimaryStepId;
  desktopAction: IcloudPrimaryDesktopAction;
  phoneAction: IcloudPrimaryPhoneAction;
  remoteRequired: boolean;
  showTechnicalDetails: boolean;
};

export type IcloudPrimaryInstructionKeys = {
  desktopKey: TranslationKey;
  phoneKey: TranslationKey;
  remoteKey: TranslationKey | null;
};

export const primaryIcloudActionFollowupKeys: Partial<Record<TranslationKey, TranslationKey>> = {
  "onboarding.appleRemoteIcloudActionUseQrOrTunnel": "onboarding.appleRemoteIcloudFollowupUseQrOrTunnel",
  "onboarding.appleRemoteIcloudActionEnableDrive": "onboarding.appleRemoteIcloudFollowupEnableDrive",
  "onboarding.appleRemoteIcloudActionRefreshEntry": "onboarding.appleRemoteIcloudFollowupRefreshEntry",
  "onboarding.appleRemoteIcloudActionRefreshAndQr": "onboarding.appleRemoteIcloudFollowupRefreshAndQr",
  "onboarding.appleRemoteIcloudActionGenerateQr": "onboarding.appleRemoteIcloudFollowupGenerateQr",
  "onboarding.appleRemoteIcloudActionCreateEntry": "onboarding.appleRemoteIcloudFollowupCreateEntry",
  "onboarding.appleRemoteIcloudActionFixSync": "onboarding.appleRemoteIcloudFollowupFixSync",
  "onboarding.appleRemoteIcloudActionWaitSync": "onboarding.appleRemoteIcloudFollowupWaitSync",
  "onboarding.appleRemoteIcloudActionOpenFiles": "onboarding.appleRemoteIcloudFollowupOpenFiles",
  "onboarding.appleRemoteIcloudActionOpenFilesSameWifi": "onboarding.appleRemoteIcloudFollowupOpenFilesSameWifi",
  "onboarding.appleRemoteIcloudActionChooseRemoteEntry": "onboarding.appleRemoteIcloudFollowupChooseRemoteEntry",
  "onboarding.appleRemoteIcloudActionReview": "onboarding.appleRemoteIcloudFollowupReview",
};

export function getIcloudActionFollowupKey(actionKey: TranslationKey): TranslationKey {
  return primaryIcloudActionFollowupKeys[actionKey] || "onboarding.appleRemoteIcloudFollowupReview";
}

const desktopInstructionKeys: Record<IcloudPrimaryDesktopAction, TranslationKey> = {
  none: "onboarding.appleRemoteIcloudDesktopInstructionNone",
  "open-connection-guide": "onboarding.appleRemoteIcloudDesktopInstructionConnectionGuide",
  "open-icloud-settings": "onboarding.appleRemoteIcloudDesktopInstructionSettings",
  "open-icloud-folder": "onboarding.appleRemoteIcloudDesktopInstructionFolder",
  "export-icloud-entry": "onboarding.appleRemoteIcloudDesktopInstructionExport",
  "refresh-icloud-entry": "onboarding.appleRemoteIcloudDesktopInstructionRefresh",
  "regenerate-qr": "onboarding.appleRemoteIcloudDesktopInstructionQr",
};

const phoneInstructionKeys: Record<IcloudPrimaryPhoneAction, TranslationKey> = {
  none: "onboarding.appleRemoteIcloudPhoneInstructionNone",
  "open-files-app": "onboarding.appleRemoteIcloudPhoneInstructionOpenFiles",
  "open-files-app-after-sync": "onboarding.appleRemoteIcloudPhoneInstructionAfterSync",
  "open-latest-entry": "onboarding.appleRemoteIcloudPhoneInstructionLatest",
  "scan-qr": "onboarding.appleRemoteIcloudPhoneInstructionScanQr",
  "same-wifi-only": "onboarding.appleRemoteIcloudPhoneInstructionSameWifi",
};

export function getPrimaryIcloudInstructionKeys(action: Pick<IcloudPrimaryAction, "desktopAction" | "phoneAction" | "remoteRequired">): IcloudPrimaryInstructionKeys {
  return {
    desktopKey: desktopInstructionKeys[action.desktopAction],
    phoneKey: phoneInstructionKeys[action.phoneAction],
    remoteKey: action.remoteRequired ? "onboarding.appleRemoteIcloudInstructionRemoteRequired" : null,
  };
}

function isPrivateNetworkHost(hostname: string) {
  const host = String(hostname || "").trim().toLowerCase();
  if (!host || host === "localhost" || host.endsWith(".local")) return true;
  if (/^127\./.test(host)) return true;
  if (/^10\./.test(host)) return true;
  if (/^192\.168\./.test(host)) return true;
  const match = host.match(/^172\.(\d+)\./);
  return Boolean(match && Number(match[1]) >= 16 && Number(match[1]) <= 31);
}

export function isIcloudEntrySameWifiOnly(entry?: Pick<NetworkDiagnostics["icloud"], "recommendedBaseUrl" | "recommendedMode" | "recommendedStability"> | Pick<NetworkDiagnostics["icloud"]["availableEntries"][number], "baseUrl" | "mode" | "stability"> | null) {
  if (!entry) return false;
  const mode = String("recommendedMode" in entry ? entry.recommendedMode : entry.mode || "").toLowerCase();
  const stability = String("recommendedStability" in entry ? entry.recommendedStability : entry.stability || "").toLowerCase();
  const baseUrl = String("recommendedBaseUrl" in entry ? entry.recommendedBaseUrl : entry.baseUrl || "");
  if (mode === "lan" || mode === "local" || stability === "local") return true;
  try {
    const url = new URL(baseUrl);
    return url.protocol === "http:" && isPrivateNetworkHost(url.hostname);
  } catch {
    return /^http:\/\/(localhost|127\.|10\.|192\.168\.|172\.(1[6-9]|2\d|3[0-1])\.)/i.test(baseUrl);
  }
}

export function getPrimaryIcloudAction(input: {
  icloud: NetworkDiagnostics["icloud"] | undefined;
  latestEntryRepair: IcloudLatestEntryRepair | null;
  pairingSession: NetworkDiagnostics["icloud"]["pairingSession"] | undefined;
  syncReadiness: NetworkDiagnostics["icloud"]["syncReadiness"] | undefined;
  handoffHealth: NetworkDiagnostics["icloud"]["handoffHealth"] | undefined;
  canExportIcloud: boolean;
}): IcloudPrimaryAction {
  const warningTone = "border-amber-400/20 bg-amber-500/10 text-amber-50";
  const readyTone = "border-emerald-400/20 bg-emerald-500/10 text-emerald-50";
  const syncTone = "border-sky-400/20 bg-sky-500/10 text-sky-50";
  const dangerTone = "border-red-400/20 bg-red-500/10 text-red-50";

  if (!input.icloud?.platformSupported) {
    return {
      tone: warningTone,
      icon: "warning",
      titleKey: "onboarding.appleRemoteIcloudNextStepUnsupportedTitle",
      bodyKey: "onboarding.appleRemoteIcloudNextStepUnsupportedBody",
      actionKey: "onboarding.appleRemoteIcloudActionUseQrOrTunnel",
      cta: "none",
      stepId: "use-qr-or-tunnel",
      desktopAction: "open-connection-guide",
      phoneAction: "none",
      remoteRequired: true,
      showTechnicalDetails: false,
    };
  }

  if (!input.canExportIcloud) {
    return {
      tone: dangerTone,
      icon: "warning",
      titleKey: "onboarding.appleRemoteIcloudNextStepEnableTitle",
      bodyKey: "onboarding.appleRemoteIcloudNextStepEnableBody",
      actionKey: "onboarding.appleRemoteIcloudActionEnableDrive",
      cta: "icloud-settings",
      stepId: "enable-icloud-drive",
      desktopAction: "open-icloud-settings",
      phoneAction: "none",
      remoteRequired: false,
      showTechnicalDetails: false,
    };
  }

  if (input.latestEntryRepair && input.latestEntryRepair.status !== "none" && input.latestEntryRepair.action !== "none") {
    const needsQr = input.latestEntryRepair.needsQr;
    return {
      tone: input.latestEntryRepair.severity === "danger" ? dangerTone : warningTone,
      icon: needsQr ? "qr" : "refresh",
      titleKey: "onboarding.appleRemoteIcloudNextStepOldEntryTitle",
      bodyKey: needsQr ? "onboarding.appleRemoteIcloudNextStepOldEntryQrBody" : "onboarding.appleRemoteIcloudNextStepOldEntryBody",
      actionKey: needsQr ? "onboarding.appleRemoteIcloudActionRefreshAndQr" : "onboarding.appleRemoteIcloudActionRefreshEntry",
      cta: needsQr ? "qr" : "export",
      stepId: needsQr ? "refresh-entry-and-qr" : "refresh-entry",
      desktopAction: needsQr ? "regenerate-qr" : "refresh-icloud-entry",
      phoneAction: "open-latest-entry",
      remoteRequired: false,
      showTechnicalDetails: false,
    };
  }

  if (input.pairingSession?.action === "create-qr" || input.pairingSession?.action === "regenerate-qr") {
    return {
      tone: warningTone,
      icon: "qr",
      titleKey: "onboarding.appleRemoteIcloudNextStepQrTitle",
      bodyKey: "onboarding.appleRemoteIcloudNextStepQrBody",
      actionKey: "onboarding.appleRemoteIcloudActionGenerateQr",
      cta: "qr",
      stepId: "generate-qr",
      desktopAction: "regenerate-qr",
      phoneAction: "none",
      remoteRequired: false,
      showTechnicalDetails: false,
    };
  }

  if (!input.handoffHealth || input.handoffHealth.status === "missing" || input.syncReadiness?.action === "export-entry") {
    return {
      tone: syncTone,
      icon: "sync",
      titleKey: "onboarding.appleRemoteIcloudNextStepExportTitle",
      bodyKey: "onboarding.appleRemoteIcloudNextStepExportBody",
      actionKey: "onboarding.appleRemoteIcloudActionCreateEntry",
      cta: "export",
      stepId: "create-entry",
      desktopAction: "export-icloud-entry",
      phoneAction: "open-files-app-after-sync",
      remoteRequired: false,
      showTechnicalDetails: false,
    };
  }

  if (input.handoffHealth.needsRefresh || input.syncReadiness?.action === "refresh-entry") {
    return {
      tone: warningTone,
      icon: "refresh",
      titleKey: "onboarding.appleRemoteIcloudNextStepRefreshTitle",
      bodyKey: "onboarding.appleRemoteIcloudNextStepRefreshBody",
      actionKey: "onboarding.appleRemoteIcloudActionRefreshEntry",
      cta: "export",
      stepId: "refresh-entry",
      desktopAction: "refresh-icloud-entry",
      phoneAction: "open-latest-entry",
      remoteRequired: false,
      showTechnicalDetails: false,
    };
  }

  if (input.syncReadiness?.action === "fix-icloud-sync") {
    return {
      tone: warningTone,
      icon: "warning",
      titleKey: "onboarding.appleRemoteIcloudNextStepFixSyncTitle",
      bodyKey: "onboarding.appleRemoteIcloudNextStepFixSyncBody",
      actionKey: "onboarding.appleRemoteIcloudActionFixSync",
      cta: "icloud-settings",
      stepId: "fix-icloud-sync",
      desktopAction: "open-icloud-settings",
      phoneAction: "open-files-app-after-sync",
      remoteRequired: false,
      showTechnicalDetails: true,
    };
  }

  if (input.syncReadiness?.action === "wait-for-sync") {
    return {
      tone: syncTone,
      icon: "sync",
      titleKey: "onboarding.appleRemoteIcloudNextStepWaitTitle",
      bodyKey: "onboarding.appleRemoteIcloudNextStepWaitBody",
      actionKey: "onboarding.appleRemoteIcloudActionWaitSync",
      cta: "icloud-folder",
      stepId: "wait-for-icloud-sync",
      desktopAction: "open-icloud-folder",
      phoneAction: "open-files-app-after-sync",
      remoteRequired: false,
      showTechnicalDetails: false,
    };
  }

  if (input.syncReadiness?.canOpenOnPhone && isIcloudEntrySameWifiOnly(input.icloud)) {
    return {
      tone: warningTone,
      icon: "phone",
      titleKey: "onboarding.appleRemoteIcloudNextStepSameWifiOpenTitle",
      bodyKey: "onboarding.appleRemoteIcloudNextStepSameWifiOpenBody",
      actionKey: "onboarding.appleRemoteIcloudActionOpenFilesSameWifi",
      cta: "none",
      stepId: "open-files-app-same-wifi",
      desktopAction: "none",
      phoneAction: "same-wifi-only",
      remoteRequired: true,
      showTechnicalDetails: false,
    };
  }

  if (input.syncReadiness?.canOpenOnPhone) {
    return {
      tone: readyTone,
      icon: "phone",
      titleKey: "onboarding.appleRemoteIcloudNextStepPhoneTitle",
      bodyKey: "onboarding.appleRemoteIcloudNextStepPhoneBody",
      actionKey: "onboarding.appleRemoteIcloudActionOpenFiles",
      cta: "none",
      stepId: "open-files-app",
      desktopAction: "none",
      phoneAction: "open-files-app",
      remoteRequired: false,
      showTechnicalDetails: false,
    };
  }

  return {
    tone: warningTone,
    icon: "refresh",
    titleKey: "onboarding.appleRemoteIcloudNextStepReviewTitle",
    bodyKey: "onboarding.appleRemoteIcloudNextStepReviewBody",
    actionKey: "onboarding.appleRemoteIcloudActionReview",
    cta: "export",
    stepId: "review",
    desktopAction: "refresh-icloud-entry",
    phoneAction: "none",
    remoteRequired: false,
    showTechnicalDetails: true,
  };
}
