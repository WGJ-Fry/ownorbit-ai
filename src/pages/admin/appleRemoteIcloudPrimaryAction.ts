import type { TranslationKey } from "../../i18n/translations";
import type { NetworkDiagnostics } from "../../services/lifeosApi";

type IcloudLatestEntryRepair = NonNullable<NetworkDiagnostics["icloud"]["latestEntryRepair"]>;

export type IcloudPrimaryAction = {
  tone: string;
  icon: "ready" | "refresh" | "qr" | "sync" | "warning" | "phone";
  titleKey: TranslationKey;
  bodyKey: TranslationKey;
  actionKey: TranslationKey;
  cta: "export" | "qr" | "none";
};

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
      cta: "none",
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
      cta: "none",
    };
  }

  if (input.syncReadiness?.action === "wait-for-sync") {
    return {
      tone: syncTone,
      icon: "sync",
      titleKey: "onboarding.appleRemoteIcloudNextStepWaitTitle",
      bodyKey: "onboarding.appleRemoteIcloudNextStepWaitBody",
      actionKey: "onboarding.appleRemoteIcloudActionWaitSync",
      cta: "none",
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
