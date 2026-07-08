import type { TranslationKey } from "../../i18n/translations";
import type { NetworkDiagnostics } from "../../services/lifeosApi";

type IcloudLatestEntryRepair = NonNullable<NetworkDiagnostics["icloud"]["latestEntryRepair"]>;

export type IcloudPrimaryAction = {
  tone: string;
  icon: "ready" | "refresh" | "qr" | "sync" | "warning" | "phone";
  titleKey: TranslationKey;
  bodyKey: TranslationKey;
  actionKey: TranslationKey;
  cta: "export" | "qr" | "remote-guide" | "icloud-settings" | "icloud-folder" | "none";
};

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
    };
  }

  if (input.latestEntryRepair && input.latestEntryRepair.status !== "none" && input.latestEntryRepair.action !== "none") {
    return {
      tone: input.latestEntryRepair.severity === "danger" ? dangerTone : warningTone,
      icon: input.latestEntryRepair.needsQr ? "qr" : "refresh",
      titleKey: "onboarding.appleRemoteIcloudNextStepOldEntryTitle",
      bodyKey: input.latestEntryRepair.needsQr ? "onboarding.appleRemoteIcloudNextStepOldEntryQrBody" : "onboarding.appleRemoteIcloudNextStepOldEntryBody",
      actionKey: input.latestEntryRepair.needsQr ? "onboarding.appleRemoteIcloudActionRefreshAndQr" : "onboarding.appleRemoteIcloudActionRefreshEntry",
      cta: input.latestEntryRepair.needsQr ? "qr" : "export",
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
    };
  }

  if (input.syncReadiness?.canOpenOnPhone && isIcloudEntrySameWifiOnly(input.icloud)) {
    return {
      tone: warningTone,
      icon: "warning",
      titleKey: "onboarding.appleRemoteIcloudNextStepSameWifiTitle",
      bodyKey: "onboarding.appleRemoteIcloudNextStepSameWifiBody",
      actionKey: "onboarding.appleRemoteIcloudActionChooseRemoteEntry",
      cta: "remote-guide",
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
    };
  }

  return {
    tone: warningTone,
    icon: "refresh",
    titleKey: "onboarding.appleRemoteIcloudNextStepReviewTitle",
    bodyKey: "onboarding.appleRemoteIcloudNextStepReviewBody",
    actionKey: "onboarding.appleRemoteIcloudActionReview",
    cta: "export",
  };
}
