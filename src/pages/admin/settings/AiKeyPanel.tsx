import { useEffect, useState } from "react";
import { KeyRound, PlugZap, Save, Trash2 } from "lucide-react";
import { deleteAiProviderKey, isLifeosRequestTimeout, listAiProviders, saveAiProviderKey, testAiProvider, updateActiveAiProvider, updateAiProviderModel } from "../../../services/lifeosApi";
import type { AiProviderId, AiProviderStatus, ConfigDiagnostics } from "../../../services/lifeosApi";
import { useI18n } from "../../../i18n/I18nProvider";
import type { TranslationKey } from "../../../i18n/translations";
import AiProviderSecuritySummary from "./AiProviderSecuritySummary";

function formatAiKeyApiError(error: any, t: (key: any, params?: Record<string, any>) => string, fallbackKey: TranslationKey) {
  if (isLifeosRequestTimeout(error)) return t("api.requestTimeout");
  return error?.message || t(fallbackKey);
}

export default function AiKeyPanel({ diagnostics, onChanged }: { diagnostics: ConfigDiagnostics; onChanged: () => Promise<void> }) {
  const { t } = useI18n();
  const [apiKey, setApiKey] = useState("");
  const [providers, setProviders] = useState<AiProviderStatus[]>([]);
  const [selectedProvider, setSelectedProvider] = useState<AiProviderId>("gemini");
  const [selectedModel, setSelectedModel] = useState("");
  const [status, setStatus] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const activeProvider = providers.find((provider) => provider.id === selectedProvider) || providers[0] || {
    id: "gemini" as const,
    provider: diagnostics.ai.provider,
    envVar: diagnostics.ai.envVar,
    source: diagnostics.ai.source,
    configured: diagnostics.ai.configured,
    enabled: true,
    models: diagnostics.ai.models || [],
    defaultModel: diagnostics.ai.defaultModel,
    selectedModel: diagnostics.ai.selectedModel,
    restartRequired: diagnostics.ai.restartRequired,
    secureStorage: diagnostics.ai.secureStorage,
    recommendations: diagnostics.ai.recommendations,
  };
  const envManaged = activeProvider.source === "environment";
  const localManaged = activeProvider.source === "encrypted_store" || activeProvider.source === "system_secure_store";
  const storageLabel = activeProvider.source === "system_secure_store"
    ? t("aiKey.storage.system")
    : activeProvider.source === "encrypted_store"
      ? t("aiKey.storage.encrypted")
      : activeProvider.source === "environment"
        ? t("aiKey.storage.env", { envVar: activeProvider.envVar })
        : t("aiKey.storage.unconfigured");
  const modelOptions = activeProvider.models || [];
  const modelValue = selectedModel || activeProvider.selectedModel || activeProvider.defaultModel || modelOptions[0] || "";
  const secureStorage = activeProvider.secureStorage;
  const storageHealthLabel = secureStorage?.systemAvailable
    ? t("aiKey.systemAvailable", { name: secureStorage.systemName || t("aiKey.storage.system") })
    : t("aiKey.systemUnavailable");
  const storageHealthTone = secureStorage?.migrationRecommended
    ? "border-amber-400/20 bg-amber-500/10 text-amber-100"
    : secureStorage?.systemAvailable && !secureStorage?.fallbackActive
      ? "border-emerald-400/20 bg-emerald-500/10 text-emerald-100"
      : "border-white/[0.08] bg-white/[0.03] text-zinc-300";

  const refreshProviders = async () => {
    const data = await listAiProviders();
    setProviders(data.providers);
  };

  useEffect(() => {
    refreshProviders().catch((error) => setStatus(error.message || t("aiKey.loadFailed")));
  }, []);

  useEffect(() => {
    setSelectedModel(activeProvider.selectedModel || activeProvider.defaultModel || activeProvider.models?.[0] || "");
  }, [activeProvider.id, activeProvider.selectedModel, activeProvider.defaultModel, activeProvider.models]);

  const handleSave = async () => {
    if (!apiKey.trim() || busy) return;
    setBusy(true);
    setStatus(null);
    try {
      await saveAiProviderKey(selectedProvider, apiKey.trim());
      setApiKey("");
      setStatus(t("aiKey.saved", { provider: activeProvider.provider }));
      await refreshProviders();
      await onChanged();
    } catch (error: any) {
      setStatus(formatAiKeyApiError(error, t, "aiKey.saveFailed"));
    } finally {
      setBusy(false);
    }
  };

  const handleDelete = async () => {
    if (busy || !window.confirm(t("aiKey.deleteConfirm", { provider: activeProvider.provider }))) return;
    setBusy(true);
    setStatus(null);
    try {
      await deleteAiProviderKey(selectedProvider);
      setStatus(t("aiKey.deleted", { provider: activeProvider.provider }));
      await refreshProviders();
      await onChanged();
    } catch (error: any) {
      setStatus(formatAiKeyApiError(error, t, "aiKey.deleteFailed"));
    } finally {
      setBusy(false);
    }
  };

  const handleTest = async () => {
    setBusy(true);
    setStatus(null);
    try {
      const result = await testAiProvider(selectedProvider, "live");
      const testDetails = result.mode === "live" ? t("aiKey.testLiveOk", { count: result.modelCount ?? 0 }) : t("aiKey.testConfigOnly");
      const catalogDetails = result.modelCatalogUpdated ? ` ${t("aiKey.modelCatalogUpdated", { count: result.discoveredModelCount || result.modelCount || 0 })}` : "";
      setStatus(result.ok
        ? `${t("aiKey.testConfigOk", { provider: result.provider.provider, model: result.selectedModel || result.provider.selectedModel || result.provider.defaultModel || "-" })} ${testDetails}${catalogDetails}`
        : result.message);
      await refreshProviders();
    } catch (error: any) {
      setStatus(formatAiKeyApiError(error, t, "aiKey.testFailed"));
    } finally {
      setBusy(false);
    }
  };

  const handleSaveModel = async () => {
    if (!modelValue.trim() || busy) return;
    setBusy(true);
    setStatus(null);
    try {
      const result = await updateAiProviderModel(selectedProvider, modelValue.trim());
      setSelectedModel(result.provider.selectedModel || modelValue.trim());
      setStatus(t("aiKey.modelSaved", { provider: result.provider.provider, model: result.provider.selectedModel || modelValue.trim() }));
      await refreshProviders();
      await onChanged();
    } catch (error: any) {
      setStatus(formatAiKeyApiError(error, t, "aiKey.modelSaveFailed"));
    } finally {
      setBusy(false);
    }
  };

  const handleSetDefaultProvider = async () => {
    if (busy) return;
    setBusy(true);
    setStatus(null);
    try {
      const result = await updateActiveAiProvider(selectedProvider);
      setProviders(result.providers);
      setStatus(t("aiKey.defaultSet", { provider: result.provider.provider }));
      await onChanged();
    } catch (error: any) {
      setStatus(formatAiKeyApiError(error, t, "aiKey.defaultFailed"));
    } finally {
      setBusy(false);
    }
  };

  return (
    <section id="ai-provider" className="mb-6 scroll-mt-6 rounded-[28px] border border-white/[0.08] bg-[#101722] p-5">
      <div className="mb-4 flex items-center justify-between gap-3">
        <div className="flex items-center gap-2 font-bold">
          <KeyRound className="h-4 w-4 text-cyan-300" />
          {t("aiKey.title")}
        </div>
        <span className="rounded-full border border-white/[0.08] bg-white/[0.03] px-3 py-1 text-[11px] font-bold text-zinc-300">
          {activeProvider.provider} · {storageLabel}
        </span>
      </div>

      <AiProviderSecuritySummary providers={providers.length ? providers : [activeProvider as AiProviderStatus]} />

      <div className="mb-4 grid gap-2 sm:grid-cols-4">
        {providers.map((provider) => {
          const active = selectedProvider === provider.id;
          return (
            <button
              key={provider.id}
              type="button"
              onClick={() => setSelectedProvider(provider.id)}
              className={`rounded-2xl border p-3 text-left transition-colors ${active ? "border-cyan-400/40 bg-cyan-500/10" : "border-white/[0.06] bg-white/[0.03] hover:bg-white/[0.05]"}`}
            >
              <div className="flex items-center justify-between gap-2">
                <span className="text-sm font-bold text-zinc-100">{provider.provider}</span>
                <span className={`rounded-full px-2 py-0.5 text-[10px] font-bold ${provider.configured ? "bg-emerald-500/10 text-emerald-200" : provider.enabled ? "bg-cyan-500/10 text-cyan-200" : "bg-white/[0.06] text-zinc-400"}`}>
                  {provider.active ? t("aiKey.defaultBadge") : provider.configured ? t("aiKey.configuredBadge") : provider.enabled ? t("aiKey.configurableBadge") : t("aiKey.reservedBadge")}
                </span>
              </div>
              <div className="mt-1 truncate text-[11px] text-zinc-500">{t(`aiKey.details.${provider.id}` as any)}</div>
            </button>
          );
        })}
      </div>

      <div className="grid gap-4 md:grid-cols-[1fr_auto]">
        <div>
          <label className="mb-2 block text-xs font-bold uppercase tracking-wider text-zinc-500">{t("aiKey.configLabel", { provider: activeProvider.provider })}</label>
          <input
            value={apiKey}
            onChange={(event) => setApiKey(event.target.value)}
            type="password"
            disabled={envManaged || busy}
            placeholder={envManaged ? t("aiKey.envManagedPlaceholder", { envVar: activeProvider.envVar }) : activeProvider.id === "local" ? "http://127.0.0.1:11434" : t("aiKey.inputPlaceholder")}
            className="w-full rounded-xl border border-white/[0.08] bg-[#060a10] px-4 py-3 text-sm text-zinc-100 outline-none focus:border-cyan-400/60 disabled:cursor-not-allowed disabled:opacity-55"
          />
          <p className="mt-2 text-xs leading-relaxed text-zinc-500">
            {t("aiKey.secretHint")}
            {secureStorage ? t("aiKey.currentStrategy", { label: secureStorage.label }) : ""}
            {activeProvider.enabled ? t("aiKey.enabledHint") : t("aiKey.disabledHint")}
          </p>
        </div>
        <div className="flex items-end gap-2">
          <button
            onClick={handleSave}
            disabled={envManaged || busy || apiKey.trim().length < 8}
            className="rounded-xl bg-cyan-500 px-4 py-3 text-sm font-bold text-[#061016] disabled:cursor-not-allowed disabled:opacity-50"
          >
            {busy ? t("aiKey.processing") : t("aiKey.save")}
          </button>
          <button
            onClick={handleTest}
            disabled={busy}
            className="inline-flex items-center gap-2 rounded-xl border border-cyan-400/20 bg-cyan-500/10 px-4 py-3 text-sm font-bold text-cyan-200 disabled:cursor-not-allowed disabled:opacity-50"
          >
            <PlugZap className="h-4 w-4" />
            {t("aiKey.test")}
          </button>
          <button
            onClick={handleDelete}
            disabled={envManaged || busy || !localManaged}
            className="inline-flex items-center gap-2 rounded-xl border border-red-400/20 bg-red-500/10 px-4 py-3 text-sm font-bold text-red-200 disabled:cursor-not-allowed disabled:opacity-50"
          >
            <Trash2 className="h-4 w-4" />
            {t("aiKey.delete")}
          </button>
        </div>
      </div>

      {secureStorage ? (
        <div className={`mt-4 rounded-2xl border p-4 text-xs leading-relaxed ${storageHealthTone}`}>
          <div className="font-bold">{storageHealthLabel}</div>
          <div className="mt-1 opacity-80">{t("aiKey.currentLocation", { value: secureStorage.current ? secureStorage.label : t("aiKey.notSaved") })}</div>
          <div className="mt-1 opacity-80">{t("aiKey.priorityStrategy", { value: secureStorage.systemAvailable ? secureStorage.systemName || t("aiKey.storage.system") : secureStorage.fallbackLabel || "Local AES-GCM encrypted file" })}</div>
          {secureStorage.migrationRecommended ? (
            <div className="mt-2 font-semibold text-amber-100">{t("aiKey.migrateHint")}</div>
          ) : null}
          {!secureStorage.systemAvailable ? (
            <div className="mt-2 text-zinc-400">{t("aiKey.desktopFallbackHint")}</div>
          ) : null}
        </div>
      ) : null}

      <div className="mt-4 grid gap-4 md:grid-cols-[1fr_auto]">
        <div>
          <label className="mb-2 block text-xs font-bold uppercase tracking-wider text-zinc-500">{t("aiKey.modelLabel", { provider: activeProvider.provider })}</label>
          <input
            value={modelValue}
            onChange={(event) => setSelectedModel(event.target.value)}
            list="lifeos-ai-provider-models"
            aria-label={t("aiKey.modelLabel", { provider: activeProvider.provider })}
            disabled={busy}
            placeholder={activeProvider.defaultModel || "model-id"}
            className="w-full rounded-xl border border-white/[0.08] bg-[#060a10] px-4 py-3 text-sm text-zinc-100 outline-none focus:border-cyan-400/60 disabled:cursor-not-allowed disabled:opacity-55"
          />
          <datalist id="lifeos-ai-provider-models">
            {modelOptions.map((model) => <option key={model} value={model} />)}
          </datalist>
          <p className="mt-2 text-xs leading-relaxed text-zinc-500">
            {t("aiKey.modelHint")}
          </p>
        </div>
        <div className="flex items-end">
          <button
            onClick={handleSaveModel}
            disabled={busy || !modelValue.trim()}
            className="inline-flex items-center gap-2 rounded-xl border border-cyan-400/20 bg-cyan-500/10 px-4 py-3 text-sm font-bold text-cyan-200 disabled:cursor-not-allowed disabled:opacity-50"
          >
            <Save className="h-4 w-4" />
            {t("aiKey.saveModel")}
          </button>
        </div>
      </div>
      <div className="mt-4 rounded-2xl border border-white/[0.06] bg-white/[0.03] p-4 text-xs text-zinc-400">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <div className="font-bold text-zinc-200">{t("aiKey.defaultProviderTitle")}</div>
            <div className="mt-1 leading-relaxed">
              {t("aiKey.defaultProviderBody", { provider: providers.find((provider) => provider.active)?.provider || "Google Gemini" })}
            </div>
          </div>
          <button
            onClick={handleSetDefaultProvider}
            disabled={busy || activeProvider.active}
            className="inline-flex items-center justify-center gap-2 rounded-xl border border-cyan-400/20 bg-cyan-500/10 px-4 py-3 text-sm font-bold text-cyan-200 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {t("aiKey.setDefault")}
          </button>
        </div>
      </div>

      {status ? <div className="mt-4 rounded-xl border border-white/[0.08] bg-white/[0.03] p-3 text-sm text-zinc-300">{status}</div> : null}
    </section>
  );
}
