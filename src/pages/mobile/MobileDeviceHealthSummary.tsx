import { AlertTriangle, CheckCircle2 } from "lucide-react";
import type { DeviceCredentialStorageStatus, StoredDeviceCredential } from "../../services/lifeosApi";
import type { OfflineMessageQueueSummary } from "../../services/offlineMessageQueue";
import type { MobileConnectivityResult, PwaCapabilityStatus, RemoteEntryStatus } from "../../services/pwaCapabilities";
import { useI18n } from "../../i18n/I18nProvider";

type HealthTone = "ok" | "warn" | "risk";

function toneClass(tone: HealthTone) {
  if (tone === "ok") return "border-emerald-400/20 bg-emerald-500/10 text-emerald-100";
  if (tone === "warn") return "border-amber-400/20 bg-amber-500/10 text-amber-100";
  return "border-red-400/20 bg-red-500/10 text-red-100";
}

export default function MobileDeviceHealthSummary({
  credential,
  credentialStorage,
  pwaCapabilities,
  queueSummary,
  currentEntry,
  lastConnectivityResult,
}: {
  credential: StoredDeviceCredential | null;
  credentialStorage: DeviceCredentialStorageStatus | null;
  pwaCapabilities: PwaCapabilityStatus;
  queueSummary: OfflineMessageQueueSummary;
  currentEntry: RemoteEntryStatus;
  lastConnectivityResult: MobileConnectivityResult | null;
}) {
  const { t } = useI18n();
  const checks = [
    {
      tone: credential ? "ok" : "risk",
      label: t("mobileDevice.healthBinding"),
      value: credential ? t("mobileDevice.healthBound") : t("mobileDevice.healthUnbound"),
    },
    {
      tone: credentialStorage?.storage === "indexeddb" && !credentialStorage.legacyLocalStoragePresent ? "ok" : "warn",
      label: t("mobileDevice.healthCredential"),
      value: credentialStorage?.storage === "indexeddb" ? t("mobileDevice.healthCredentialIndexedDb") : t("mobileDevice.healthCredentialNeedsAttention"),
    },
    {
      tone: pwaCapabilities.standalone && pwaCapabilities.serviceWorkerControlled && pwaCapabilities.indexedDbSupported ? "ok" : "warn",
      label: t("mobileDevice.healthPwa"),
      value: pwaCapabilities.standalone ? t("mobileDevice.startedFromIcon") : t("mobileDevice.browserTab"),
    },
    {
      tone: queueSummary.failed ? "risk" : queueSummary.count ? "warn" : "ok",
      label: t("mobileDevice.healthOfflineQueue"),
      value: queueSummary.failed
        ? t("mobileDevice.healthQueueFailed", { count: queueSummary.failed })
        : queueSummary.count
          ? t("mobileDevice.healthQueuePending", { count: queueSummary.count })
          : t("mobileDevice.healthQueueClear"),
    },
    {
      tone: currentEntry.okForRemote ? "ok" : currentEntry.kind === "localhost" ? "risk" : "warn",
      label: t("mobileDevice.healthRemoteEntry"),
      value: t(currentEntry.titleKey as any),
    },
    {
      tone: lastConnectivityResult?.ok ? "ok" : lastConnectivityResult ? "risk" : "warn",
      label: t("mobileDevice.healthConnectivity"),
      value: lastConnectivityResult?.ok
        ? t("mobileDevice.healthConnectivityOk")
        : lastConnectivityResult
          ? t("mobileDevice.healthConnectivityFailed")
          : t("mobileDevice.healthConnectivityUntested"),
    },
  ] as const;
  const riskCount = checks.filter((check) => check.tone === "risk").length;
  const warnCount = checks.filter((check) => check.tone === "warn").length;
  const overallTone: HealthTone = riskCount ? "risk" : warnCount ? "warn" : "ok";

  return (
    <section className={`mb-4 rounded-[28px] border p-5 ${toneClass(overallTone)}`}>
      <div className="flex items-start gap-3">
        <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl border border-white/[0.10] bg-black/15">
          {overallTone === "ok" ? <CheckCircle2 className="h-5 w-5" /> : <AlertTriangle className="h-5 w-5" />}
        </div>
        <div>
          <div className="text-sm font-bold">{t("mobileDevice.healthTitle")}</div>
          <p className="mt-1 text-xs leading-relaxed opacity-80">
            {overallTone === "ok" ? t("mobileDevice.healthOkBody") : t("mobileDevice.healthNeedsAttentionBody", { risk: riskCount, warn: warnCount })}
          </p>
        </div>
      </div>
      <div className="mt-4 grid gap-2">
        {checks.map((check) => (
          <div key={check.label} className="flex items-center justify-between gap-3 rounded-2xl border border-white/[0.08] bg-black/10 px-3 py-2 text-xs">
            <span className="font-bold opacity-90">{check.label}</span>
            <span className="max-w-[56%] truncate text-right opacity-80">{check.value}</span>
          </div>
        ))}
      </div>
    </section>
  );
}
