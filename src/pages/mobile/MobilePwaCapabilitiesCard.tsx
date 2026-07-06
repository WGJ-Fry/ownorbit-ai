import { Download } from "lucide-react";
import { useI18n } from "../../i18n/I18nProvider";
import type { PwaCapabilityStatus } from "../../services/pwaCapabilities";
import type { PwaServiceWorkerLifecycleStatus } from "../../services/pwaServiceWorkerLifecycle";
import { CapabilityRow } from "./MobileDeviceStatusCards";

function pwaRecommendationKey(recommendation: string) {
  if (recommendation.includes("add LifeOS to the home screen")) return "mobileDevice.pwaRecommendation.addToHome";
  if (recommendation.includes("does not support the offline shell")) return "mobileDevice.pwaRecommendation.offlineShellUnsupported";
  if (recommendation.includes("offline shell is taking control")) return "mobileDevice.pwaRecommendation.refreshForShell";
  if (recommendation.includes("background sync is unavailable")) return "mobileDevice.pwaRecommendation.openChatToSync";
  if (recommendation.includes("IndexedDB is unavailable")) return "mobileDevice.pwaRecommendation.indexedDbUnavailable";
  if (recommendation.includes("You are offline")) return "mobileDevice.pwaRecommendation.offlineQueue";
  return "";
}

export default function MobilePwaCapabilitiesCard({
  pwaCapabilities,
  swLifecycle,
}: {
  pwaCapabilities: PwaCapabilityStatus;
  swLifecycle: PwaServiceWorkerLifecycleStatus | null;
}) {
  const { t } = useI18n();

  return (
    <section className="mt-4 rounded-[28px] border border-white/[0.08] bg-[#101722] p-5">
      <div className="mb-4 flex items-start gap-3">
        <div className="flex h-11 w-11 items-center justify-center rounded-2xl border border-cyan-400/20 bg-cyan-500/10">
          <Download className="h-5 w-5 text-cyan-300" />
        </div>
        <div>
          <h2 className="text-base font-bold">{t("mobileDevice.pwaTitle")}</h2>
          <p className="mt-1 text-sm leading-relaxed text-zinc-400">
            {t("mobileDevice.pwaBody")}
          </p>
        </div>
      </div>
      <div className="grid gap-2 text-sm">
        <CapabilityRow label={t("mobileDevice.standaloneMode")} ok={pwaCapabilities.standalone} value={pwaCapabilities.standalone ? t("mobileDevice.startedFromIcon") : t("mobileDevice.browserTab")} />
        <CapabilityRow label="Service Worker" ok={pwaCapabilities.serviceWorkerSupported && pwaCapabilities.serviceWorkerControlled} value={pwaCapabilities.serviceWorkerControlled ? t("mobileDevice.offlineShellControlled") : pwaCapabilities.serviceWorkerSupported ? t("mobileDevice.supportedWaiting") : t("mobileDevice.unsupported")} />
        <CapabilityRow label="Background Sync" ok={pwaCapabilities.backgroundSyncSupported} value={pwaCapabilities.backgroundSyncSupported ? t("mobileDevice.backgroundSyncOk") : t("mobileDevice.openChatToSync")} />
        <CapabilityRow label="IndexedDB" ok={pwaCapabilities.indexedDbSupported} value={pwaCapabilities.indexedDbSupported ? t("mobileDevice.indexedDbCredentialOk") : t("mobileDevice.unavailable")} />
        {swLifecycle ? (
          <CapabilityRow label={t("mobileDevice.swLifecycle")} ok={swLifecycle.tone === "ok"} value={t(swLifecycle.titleKey as any)} />
        ) : null}
      </div>
      {swLifecycle ? (
        <div className={`mt-4 rounded-2xl border p-3 text-xs leading-relaxed ${swLifecycle.tone === "ok" ? "border-emerald-400/20 bg-emerald-500/10 text-emerald-100" : swLifecycle.tone === "warn" ? "border-amber-400/20 bg-amber-500/10 text-amber-100" : "border-red-400/20 bg-red-500/10 text-red-100"}`}>
          <div className="font-bold">{t(swLifecycle.titleKey as any)}</div>
          <div className="mt-1 opacity-80">{t(swLifecycle.bodyKey as any)}</div>
        </div>
      ) : null}
      {pwaCapabilities.recommendations.length ? (
        <div className="mt-4 rounded-2xl border border-amber-400/20 bg-amber-500/10 p-3 text-xs leading-relaxed text-amber-100">
          {pwaCapabilities.recommendations.map((recommendation) => {
            const key = pwaRecommendationKey(recommendation);
            return <div key={recommendation}>{key ? t(key as any) : recommendation}</div>;
          })}
        </div>
      ) : (
        <div className="mt-4 rounded-2xl border border-emerald-400/20 bg-emerald-500/10 p-3 text-xs leading-relaxed text-emerald-100">
          {t("mobileDevice.capabilityComplete")}
        </div>
      )}
    </section>
  );
}
