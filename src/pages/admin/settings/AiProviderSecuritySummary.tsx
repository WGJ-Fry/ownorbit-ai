import { AlertTriangle, CheckCircle2, KeyRound, RotateCw } from "lucide-react";
import type { AiProviderStatus } from "../../../services/lifeosApi";
import { useI18n } from "../../../i18n/I18nProvider";

function cardClass(ok: boolean) {
  return ok
    ? "border-emerald-400/20 bg-emerald-500/10 text-emerald-100"
    : "border-amber-400/20 bg-amber-500/10 text-amber-100";
}

export default function AiProviderSecuritySummary({ providers }: { providers: AiProviderStatus[] }) {
  const { t } = useI18n();
  const configuredCount = providers.filter((provider) => provider.configured).length;
  const activeProvider = providers.find((provider) => provider.active) || providers[0];
  const selectedProvider = activeProvider?.provider || "-";
  const secureStorage = activeProvider?.secureStorage;
  const storageOk = Boolean(secureStorage?.systemAvailable && !secureStorage?.fallbackActive);
  const restartRequired = providers.some((provider) => provider.restartRequired);
  const modelCount = providers.reduce((total, provider) => total + (provider.models?.length || 0), 0);

  const items = [
    {
      icon: configuredCount ? CheckCircle2 : AlertTriangle,
      ok: configuredCount > 0,
      title: t("aiKey.summaryConfiguredTitle", { count: configuredCount, total: providers.length }),
      body: t("aiKey.summaryConfiguredBody", { provider: selectedProvider }),
    },
    {
      icon: KeyRound,
      ok: storageOk,
      title: storageOk ? t("aiKey.summaryStorageSystem") : t("aiKey.summaryStorageFallback"),
      body: secureStorage?.systemAvailable
        ? t("aiKey.summaryStorageBody", { value: secureStorage.systemName || t("aiKey.storage.system") })
        : t("aiKey.summaryStorageFallbackBody"),
    },
    {
      icon: RotateCw,
      ok: !restartRequired,
      title: restartRequired ? t("aiKey.summaryRestartRequired") : t("aiKey.summaryNoRestart"),
      body: t("aiKey.summaryModelsBody", { count: modelCount }),
    },
  ];

  return (
    <div className="mb-4 grid gap-3 md:grid-cols-3">
      {items.map((item) => {
        const Icon = item.icon;
        return (
          <div key={item.title} className={`rounded-2xl border p-3 text-xs leading-relaxed ${cardClass(item.ok)}`}>
            <div className="flex items-start gap-2">
              <Icon className="mt-0.5 h-4 w-4 shrink-0" />
              <div>
                <div className="font-bold">{item.title}</div>
                <div className="mt-1 opacity-80">{item.body}</div>
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}
