import type { TranslationKey } from "../../i18n/translations";
import type { NetworkDiagnostics } from "../../services/lifeosApi";

type IcloudPhoneConfirmation = NetworkDiagnostics["icloud"]["phoneConfirmation"];
type IcloudLatestEntryRepair = NonNullable<NetworkDiagnostics["icloud"]["latestEntryRepair"]>;

export type IcloudPhonePickupStatus = {
  tone: string;
  icon: "phone" | "ready" | "refresh" | "warning";
  titleKey: TranslationKey;
  bodyKey: TranslationKey;
  actionKey: TranslationKey;
  cta: "none" | "export" | "qr";
  deviceName: string;
  confirmedAt: number;
};

export function getIcloudPhonePickupStatus(input: {
  phoneConfirmation?: IcloudPhoneConfirmation;
  latestEntryRepair?: IcloudLatestEntryRepair | null;
}): IcloudPhonePickupStatus {
  const latestEntryRepair = input.latestEntryRepair || null;
  const phoneConfirmation = input.phoneConfirmation;
  const deviceName = phoneConfirmation?.confirmedDeviceName || phoneConfirmation?.confirmedDeviceId || latestEntryRepair?.deviceName || latestEntryRepair?.deviceId || "";
  const confirmedAt = Number(phoneConfirmation?.confirmedAt || latestEntryRepair?.eventAt || 0);

  if (latestEntryRepair?.status === "old-entry-opened" || latestEntryRepair?.status === "problem-entry-opened") {
    const repairDeviceName = latestEntryRepair.deviceName || latestEntryRepair.deviceId || deviceName;
    const repairAt = Number(latestEntryRepair.eventAt || confirmedAt || 0);
    return {
      tone: latestEntryRepair.severity === "danger" ? "border-red-400/20 bg-red-500/10 text-red-50" : "border-amber-400/20 bg-amber-500/10 text-amber-50",
      icon: latestEntryRepair.needsQr ? "warning" : "refresh",
      titleKey: "onboarding.simpleIcloudPickupOldTitle",
      bodyKey: latestEntryRepair.needsQr ? "onboarding.simpleIcloudPickupOldQrBody" : "onboarding.simpleIcloudPickupOldBody",
      actionKey: latestEntryRepair.needsQr ? "onboarding.appleRemoteIcloudActionRefreshAndQr" : "onboarding.appleRemoteIcloudActionRefreshEntry",
      cta: latestEntryRepair.needsQr ? "qr" : "export",
      deviceName: repairDeviceName,
      confirmedAt: repairAt,
    };
  }

  if (!phoneConfirmation || phoneConfirmation.status === "missing") {
    return {
      tone: "border-sky-400/20 bg-sky-500/10 text-sky-50",
      icon: "phone",
      titleKey: "onboarding.simpleIcloudPickupWaitingTitle",
      bodyKey: "onboarding.simpleIcloudPickupWaitingBody",
      actionKey: "onboarding.appleRemoteIcloudActionOpenFiles",
      cta: "none",
      deviceName,
      confirmedAt: 0,
    };
  }

  if (phoneConfirmation.status === "confirmed") {
    return {
      tone: "border-emerald-400/20 bg-emerald-500/10 text-emerald-50",
      icon: "ready",
      titleKey: "onboarding.simpleIcloudPickupConfirmedTitle",
      bodyKey: "onboarding.simpleIcloudPickupConfirmedBody",
      actionKey: "onboarding.simpleIcloudPickupConfirmedAction",
      cta: "none",
      deviceName,
      confirmedAt,
    };
  }

  return {
    tone: phoneConfirmation.severity === "danger" ? "border-red-400/20 bg-red-500/10 text-red-50" : "border-amber-400/20 bg-amber-500/10 text-amber-50",
    icon: "refresh",
    titleKey: phoneConfirmation.status === "issue-after-confirm" ? "onboarding.simpleIcloudPickupIssueTitle" : "onboarding.simpleIcloudPickupStaleTitle",
    bodyKey: phoneConfirmation.status === "issue-after-confirm" ? "onboarding.simpleIcloudPickupIssueBody" : "onboarding.simpleIcloudPickupStaleBody",
    actionKey: "onboarding.appleRemoteIcloudActionRefreshEntry",
    cta: "export",
    deviceName,
    confirmedAt,
  };
}
