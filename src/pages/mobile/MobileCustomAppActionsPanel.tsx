import { useEffect, useMemo, useState } from "react";
import { Clock3, RefreshCw, ShieldAlert, ShieldCheck, Wrench, XCircle } from "lucide-react";
import { useI18n } from "../../i18n/I18nProvider";
import {
  decideCustomAppActionRequest,
  getCustomAppCapabilityManifest,
  getCustomAppActionPolicy,
  listCustomAppActionRequests,
  listCustomApps,
  updateCustomAppCapabilityManifest,
  updateCustomAppActionPolicy,
  type CustomAppActionPolicyTemplate,
  type CustomAppCapabilityId,
  type StoredCustomApp,
  type StoredCustomAppCapabilityManifest,
  type StoredCustomAppActionPolicy,
  type StoredCustomAppActionRequest,
} from "../../services/lifeosApi";
import type { TranslationKey } from "../../i18n/translations";

type ActionRequestWithApp = StoredCustomAppActionRequest & {
  appName: string;
};

const policyTemplates: CustomAppActionPolicyTemplate[] = ["global", "web", "navigation", "communication", "shortcuts", "locked"];
const capabilityIds: CustomAppCapabilityId[] = ["storage", "openExternal", "navigation", "communication", "shortcuts", "network", "clipboard", "fileImport", "backgroundSync"];
const defaultCapabilityIds: CustomAppCapabilityId[] = ["storage", "openExternal", "navigation", "communication", "shortcuts"];

function statusLabel(status: StoredCustomAppActionRequest["status"], t: (key: TranslationKey, values?: Record<string, string | number>) => string) {
  return t(`customAppActions.status.${status}` as TranslationKey);
}

function riskLabel(risk: StoredCustomAppActionRequest["risk"], t: (key: TranslationKey, values?: Record<string, string | number>) => string) {
  return t(`customApp.actionRisk.${risk}` as TranslationKey);
}

function statusClass(status: StoredCustomAppActionRequest["status"]) {
  if (status === "approved") return "border-emerald-300/20 bg-emerald-500/10 text-emerald-100";
  if (status === "blocked") return "border-red-300/20 bg-red-500/10 text-red-100";
  if (status === "pending") return "border-amber-300/20 bg-amber-500/10 text-amber-100";
  return "border-zinc-300/10 bg-zinc-500/10 text-zinc-300";
}

function policyTemplateLabel(template: CustomAppActionPolicyTemplate, t: (key: TranslationKey, values?: Record<string, string | number>) => string) {
  return t(`customAppActions.policyTemplate.${template}` as TranslationKey);
}

function capabilityLabel(capability: CustomAppCapabilityId, t: (key: TranslationKey, values?: Record<string, string | number>) => string) {
  return t(`customAppActions.capability.${capability}` as TranslationKey);
}

export default function MobileCustomAppActionsPanel() {
  const { t } = useI18n();
  const [apps, setApps] = useState<StoredCustomApp[]>([]);
  const [policies, setPolicies] = useState<Record<string, StoredCustomAppActionPolicy>>({});
  const [capabilityManifests, setCapabilityManifests] = useState<Record<string, StoredCustomAppCapabilityManifest>>({});
  const [requests, setRequests] = useState<ActionRequestWithApp[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [cancellingId, setCancellingId] = useState<string | null>(null);
  const [savingPolicyAppId, setSavingPolicyAppId] = useState<string | null>(null);
  const [savingCapabilityAppId, setSavingCapabilityAppId] = useState<string | null>(null);

  const summary = useMemo(() => ({
    pending: requests.filter((request) => request.status === "pending").length,
    blocked: requests.filter((request) => request.status === "blocked").length,
    highRisk: requests.filter((request) => request.risk === "high").length,
  }), [requests]);

  const policyApps = useMemo(() => apps.slice(0, 6), [apps]);

  const loadRequests = async (silent = false) => {
    if (!silent) setIsLoading(true);
    setError(null);
    try {
      const appData = await listCustomApps(24);
      setApps(appData.apps);
      const requestGroups = await Promise.all(appData.apps.map(async (app) => {
        try {
          const data = await listCustomAppActionRequests(app.id, 6);
          return data.requests.map((request) => ({ ...request, appName: app.name }));
        } catch {
          return [];
        }
      }));
      const policyEntries = await Promise.all(appData.apps.map(async (app) => {
        try {
          const data = await getCustomAppActionPolicy(app.id);
          return [app.id, data.policy] as const;
        } catch {
          return null;
        }
      }));
      const capabilityEntries = await Promise.all(appData.apps.map(async (app) => {
        try {
          const data = await getCustomAppCapabilityManifest(app.id);
          return [app.id, data.manifest] as const;
        } catch {
          return null;
        }
      }));
      setPolicies(Object.fromEntries(policyEntries.filter((entry): entry is readonly [string, StoredCustomAppActionPolicy] => Boolean(entry))));
      setCapabilityManifests(Object.fromEntries(capabilityEntries.filter((entry): entry is readonly [string, StoredCustomAppCapabilityManifest] => Boolean(entry))));
      setRequests(requestGroups.flat().sort((a, b) => b.createdAt - a.createdAt).slice(0, 24));
    } catch (loadError: any) {
      setError(loadError?.message || t("customAppActions.loadFailed"));
    } finally {
      if (!silent) setIsLoading(false);
    }
  };

  const changePolicyTemplate = async (appId: string, template: CustomAppActionPolicyTemplate) => {
    setSavingPolicyAppId(appId);
    try {
      const data = await updateCustomAppActionPolicy(appId, { template });
      setPolicies((items) => ({ ...items, [appId]: data.policy }));
    } catch (policyError: any) {
      alert(policyError?.message || t("customAppActions.policyUpdateFailed"));
      await loadRequests(true);
    } finally {
      setSavingPolicyAppId(null);
    }
  };

  const toggleCapability = async (appId: string, capability: CustomAppCapabilityId) => {
    const currentCapabilities = capabilityManifests[appId]?.allowedCapabilities || defaultCapabilityIds;
    const nextCapabilities = currentCapabilities.includes(capability)
      ? currentCapabilities.filter((item) => item !== capability)
      : [...currentCapabilities, capability];
    setSavingCapabilityAppId(appId);
    try {
      const data = await updateCustomAppCapabilityManifest(appId, { allowedCapabilities: nextCapabilities });
      setCapabilityManifests((items) => ({ ...items, [appId]: data.manifest }));
    } catch (capabilityError: any) {
      alert(capabilityError?.message || t("customAppActions.capabilityUpdateFailed"));
      await loadRequests(true);
    } finally {
      setSavingCapabilityAppId(null);
    }
  };

  const cancelRequest = async (request: ActionRequestWithApp) => {
    if (!window.confirm(t("customAppActions.confirmCancel", { label: request.label }))) return;
    setCancellingId(request.id);
    try {
      const data = await decideCustomAppActionRequest(request.appId, request.id, "cancelled", t("customAppActions.cancelNote"));
      setRequests((items) => items.map((item) => item.id === request.id ? { ...item, ...data.request } : item));
    } catch (cancelError: any) {
      alert(cancelError?.message || t("customAppActions.cancelFailed"));
      await loadRequests(true);
    } finally {
      setCancellingId(null);
    }
  };

  useEffect(() => {
    void loadRequests();
    const refresh = () => void loadRequests(true);
    window.addEventListener("focus", refresh);
    document.addEventListener("visibilitychange", refresh);
    return () => {
      window.removeEventListener("focus", refresh);
      document.removeEventListener("visibilitychange", refresh);
    };
  }, []);

  return (
    <section className="rounded-[28px] border border-white/[0.08] bg-[#101722] p-4">
      <div className="mb-4 flex items-start justify-between gap-3">
        <div className="flex min-w-0 items-start gap-3">
          <div className="flex h-11 w-11 flex-shrink-0 items-center justify-center rounded-2xl border border-cyan-400/20 bg-cyan-500/10">
            <ShieldCheck className="h-5 w-5 text-cyan-200" />
          </div>
          <div className="min-w-0">
            <h2 className="text-base font-bold">{t("customAppActions.title")}</h2>
            <p className="mt-1 text-xs leading-relaxed text-zinc-400">{t("customAppActions.body")}</p>
          </div>
        </div>
        <button
          onClick={() => void loadRequests()}
          disabled={isLoading}
          className="inline-flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-xl border border-white/[0.08] bg-white/[0.03] text-zinc-300 disabled:opacity-50"
          aria-label={t("common.refresh")}
        >
          <RefreshCw className={`h-4 w-4 ${isLoading ? "animate-spin" : ""}`} />
        </button>
      </div>

      <div className="mb-3 grid grid-cols-3 gap-2 text-center text-[10px]">
        <SummaryMetric label={t("customAppActions.pending")} value={summary.pending} tone="text-amber-100" />
        <SummaryMetric label={t("customAppActions.blocked")} value={summary.blocked} tone="text-red-100" />
        <SummaryMetric label={t("customAppActions.highRisk")} value={summary.highRisk} tone="text-cyan-100" />
      </div>

      <div className="mb-3 rounded-2xl border border-white/[0.06] bg-black/15 p-3">
        <div className="mb-3">
          <div className="text-xs font-black text-zinc-100">{t("customAppActions.policyTitle")}</div>
          <p className="mt-1 text-[10px] leading-relaxed text-zinc-500">{t("customAppActions.policyBody")}</p>
        </div>
        {policyApps.length === 0 ? (
          <div className="rounded-xl border border-white/[0.06] bg-white/[0.03] p-3 text-[10px] leading-relaxed text-zinc-500">
            {isLoading ? t("common.reading") : t("customAppActions.policyEmpty")}
          </div>
        ) : (
          <div className="space-y-2">
            {policyApps.map((app) => {
              const policy = policies[app.id];
              const manifest = capabilityManifests[app.id];
              const template = policy?.template || "global";
              const allowedSchemes = policy?.allowedSchemes || [];
              const allowedCapabilities = manifest?.allowedCapabilities || defaultCapabilityIds;
              const riskLevel = manifest?.riskLevel || "high";
              return (
                <article key={app.id} className="rounded-xl border border-white/[0.06] bg-white/[0.03] p-3">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <div className="truncate text-xs font-bold text-zinc-100">{app.name}</div>
                      <div className="mt-1 text-[10px] text-zinc-500">
                        {t("customAppActions.policyTemplateLine", { template: policyTemplateLabel(template, t) })}
                      </div>
                    </div>
                    {savingPolicyAppId === app.id ? <RefreshCw className="mt-1 h-3.5 w-3.5 flex-shrink-0 animate-spin text-cyan-200" /> : null}
                  </div>
                  <label className="mt-3 block text-[10px] font-bold text-zinc-500">
                    {t("customAppActions.policyTemplateLabel")}
                    <select
                      value={template}
                      disabled={savingPolicyAppId === app.id}
                      onChange={(event) => void changePolicyTemplate(app.id, event.target.value as CustomAppActionPolicyTemplate)}
                      className="mt-1 w-full rounded-xl border border-white/[0.08] bg-[#0b111a] px-3 py-2 text-xs font-bold text-zinc-100 outline-none focus:border-cyan-300/40 disabled:opacity-60"
                    >
                      {policyTemplates.map((item) => (
                        <option key={item} value={item}>{policyTemplateLabel(item, t)}</option>
                      ))}
                    </select>
                  </label>
                  <div className="mt-2 flex flex-wrap gap-1.5">
                    {allowedSchemes.length > 0 ? allowedSchemes.slice(0, 10).map((scheme) => (
                      <span key={scheme} className="rounded-full border border-cyan-300/15 bg-cyan-500/10 px-2 py-0.5 text-[10px] font-bold text-cyan-100">
                        {scheme}
                      </span>
                    )) : (
                      <span className="rounded-full border border-red-300/15 bg-red-500/10 px-2 py-0.5 text-[10px] font-bold text-red-100">
                        {t("customAppActions.policyNoSchemes")}
                      </span>
                    )}
                  </div>
                  <div className="mt-3 border-t border-white/[0.06] pt-3">
                    <div className="mb-2 flex items-center justify-between gap-2 text-[10px]">
                      <span className="font-black text-zinc-100">{t("customAppActions.capabilityTitle")}</span>
                      <span className="font-bold text-zinc-500">
                        {t("customAppActions.capabilityRiskLine", { risk: t(`customApp.actionRisk.${riskLevel}` as TranslationKey) })}
                      </span>
                    </div>
                    <div className="flex flex-wrap gap-1.5">
                      {capabilityIds.map((capability) => {
                        const enabled = allowedCapabilities.includes(capability);
                        return (
                          <button
                            key={capability}
                            type="button"
                            disabled={savingCapabilityAppId === app.id}
                            onClick={() => void toggleCapability(app.id, capability)}
                            className={`rounded-full border px-2 py-1 text-[10px] font-bold disabled:opacity-60 ${
                              enabled
                                ? "border-emerald-300/20 bg-emerald-500/10 text-emerald-100"
                                : "border-white/[0.06] bg-black/20 text-zinc-500"
                            }`}
                          >
                            {capabilityLabel(capability, t)}
                          </button>
                        );
                      })}
                    </div>
                  </div>
                </article>
              );
            })}
          </div>
        )}
      </div>

      {error ? (
        <div className="rounded-2xl border border-amber-400/20 bg-amber-500/10 p-3 text-xs leading-relaxed text-amber-100">{error}</div>
      ) : null}

      {!error && requests.length === 0 ? (
        <div className="rounded-2xl border border-white/[0.06] bg-white/[0.03] p-4 text-xs leading-relaxed text-zinc-400">
          {isLoading ? t("common.reading") : t("customAppActions.empty")}
        </div>
      ) : null}

      {requests.length > 0 ? (
        <div className="space-y-2">
          {requests.slice(0, 8).map((request) => (
            <article key={request.id} className="rounded-2xl border border-white/[0.06] bg-white/[0.03] p-3">
              <div className="mb-2 flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <div className="flex min-w-0 items-center gap-2">
                    <Wrench className="h-3.5 w-3.5 flex-shrink-0 text-cyan-200" />
                    <div className="truncate text-xs font-bold text-zinc-100">{request.appName}</div>
                  </div>
                  <div className="mt-1 line-clamp-2 text-xs text-zinc-400">{request.label}</div>
                </div>
                <span className={`shrink-0 rounded-full border px-2 py-0.5 text-[10px] font-bold ${statusClass(request.status)}`}>
                  {statusLabel(request.status, t)}
                </span>
              </div>
              <div className="grid gap-1 text-[10px] leading-relaxed text-zinc-500">
                <div className="truncate">{t("customAppActions.targetLine", { scheme: request.targetScheme, target: request.targetUrl })}</div>
                <div className="truncate">
                  {t("customAppActions.riskLine", {
                    risk: riskLabel(request.risk, t),
                    params: request.paramsSummary || "-",
                  })}
                </div>
                <div className="flex items-center gap-1 truncate">
                  <Clock3 className="h-3 w-3 flex-shrink-0" />
                  <span className="truncate">{new Date(request.createdAt).toLocaleString()}</span>
                </div>
                {request.reason ? <div className="line-clamp-2">{t("customAppActions.reasonLine", { reason: request.reason })}</div> : null}
              </div>
              {request.status === "pending" ? (
                <button
                  onClick={() => void cancelRequest(request)}
                  disabled={cancellingId === request.id}
                  className="mt-3 inline-flex w-full items-center justify-center gap-2 rounded-xl border border-red-300/20 bg-red-500/10 px-3 py-2 text-xs font-bold text-red-100 disabled:opacity-50"
                >
                  {cancellingId === request.id ? <RefreshCw className="h-3.5 w-3.5 animate-spin" /> : <XCircle className="h-3.5 w-3.5" />}
                  {t("customAppActions.cancelPending")}
                </button>
              ) : request.status === "blocked" ? (
                <div className="mt-3 inline-flex w-full items-center gap-2 rounded-xl border border-red-300/15 bg-red-500/10 px-3 py-2 text-xs font-bold text-red-100">
                  <ShieldAlert className="h-3.5 w-3.5 flex-shrink-0" />
                  <span className="min-w-0 truncate">{t("customAppActions.blockedHint")}</span>
                </div>
              ) : null}
            </article>
          ))}
        </div>
      ) : null}
    </section>
  );
}

function SummaryMetric({ label, value, tone }: { label: string; value: number; tone: string }) {
  return (
    <div className="rounded-2xl border border-white/[0.06] bg-black/15 px-2 py-2">
      <div className={`text-base font-black ${tone}`}>{value}</div>
      <div className="mt-0.5 font-bold text-zinc-500">{label}</div>
    </div>
  );
}
