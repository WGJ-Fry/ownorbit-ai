import { useEffect, useState } from "react";
import { Command, ExternalLink, Mail, MessageSquare, Phone, Play, Save, ShieldAlert, Trash2 } from "lucide-react";
import { getClientState, setClientState } from "../../services/lifeosApi";
import {
  DANGEROUS_SCHEMES,
  buildActionLogSourceSummary,
  buildShortcutUrl,
  getNativeSystemActionPlanSummary,
  getSystemActionCapabilitySummary,
  getUrlScheme,
  normalizeAllowedUrlSchemes,
  redactActionUrl,
  riskForScheme,
  summarizeActionParams,
} from "../../services/systemActions";
import {
  ALLOWED_URL_SCHEMES_STORAGE_KEY,
  SYSTEM_ACTIONS_STORAGE_KEY,
  SYSTEM_ACTION_LOGS_STORAGE_KEY,
  loadAllowedUrlSchemes,
  loadSavedSystemActions,
  loadSystemActionLogs,
  normalizeSystemActionLog,
  writeSystemActionStorage,
  type SavedSystemAction,
  type SystemActionLog,
} from "../../services/systemActionStorage";
import { useI18n } from "../../i18n/I18nProvider";
import type { TranslationKey } from "../../i18n/translations";

type SystemActionsAppProps = {
  initialAction?: Record<string, unknown>;
};

function safeString(value: unknown) {
  return typeof value === "string" ? value : "";
}

function riskLabel(risk: SystemActionLog["risk"], t: (key: TranslationKey, values?: Record<string, string | number>) => string) {
  return risk === "high" ? t("actions.risk.high") : risk === "medium" ? t("actions.risk.medium") : t("actions.risk.low");
}

function actionStatusLabel(status: SystemActionLog["status"], t: (key: TranslationKey, values?: Record<string, string | number>) => string) {
  return status === "opened" ? t("actions.status.opened") : status === "blocked" ? t("actions.status.blocked") : t("actions.status.cancelled");
}

function actionStatusClass(status: SystemActionLog["status"]) {
  return status === "opened" ? "bg-emerald-500/15 text-emerald-200" : status === "blocked" ? "bg-red-500/15 text-red-200" : "bg-zinc-500/15 text-zinc-300";
}

function capabilityLabelKey(id: ReturnType<typeof getSystemActionCapabilitySummary>[number]["id"]) {
  return `actions.capability.${id}` as TranslationKey;
}

function capabilityStatusKey(status: ReturnType<typeof getSystemActionCapabilitySummary>[number]["status"]) {
  return `actions.capabilityStatus.${status}` as TranslationKey;
}

function nativeCapabilityLabelKey(id: ReturnType<typeof getNativeSystemActionPlanSummary>[number]["id"]) {
  return `actions.nativeCapability.${id}` as TranslationKey;
}

function nativeRequirementLabelKey(id: ReturnType<typeof getNativeSystemActionPlanSummary>[number]["requirements"][number]) {
  return `actions.nativeRequirement.${id}` as TranslationKey;
}

function openUrl(url: string, allowedSchemes: string[], options?: {
  confirm?: boolean;
  label?: string;
  source?: string;
  target?: string;
  paramsSummary?: string;
  manualSource?: string;
  unknownLabel?: string;
  blockedMessage?: (scheme: string) => string;
  confirmMessage?: (label: string) => string;
  onLog?: (log: Omit<SystemActionLog, "id" | "createdAt">) => void;
}) {
  const trimmed = url.trim();
  if (!trimmed) return;
  const scheme = getUrlScheme(trimmed);
  const baseLog = {
    label: options?.label || trimmed,
    url: trimmed,
    scheme: scheme || "unknown",
    source: options?.source || options?.manualSource || "Manual Action",
    target: options?.target || trimmed,
    paramsSummary: options?.paramsSummary || summarizeActionParams(trimmed),
  };
  if (!scheme || !allowedSchemes.includes(scheme)) {
    options?.onLog?.({ ...baseLog, status: "blocked", risk: "high" });
    alert(options?.blockedMessage?.(scheme || options?.unknownLabel || "Unknown") || `Unauthorized URL Scheme blocked: ${scheme || options?.unknownLabel || "Unknown"}`);
    return;
  }
  if ((options?.confirm || DANGEROUS_SCHEMES.has(scheme)) && !window.confirm(options?.confirmMessage?.(options?.label || trimmed) || `Confirm action: ${options?.label || trimmed}`)) {
    options?.onLog?.({ ...baseLog, scheme, status: "cancelled", risk: riskForScheme(scheme) });
    return;
  }
  options?.onLog?.({ ...baseLog, scheme, status: "opened", risk: riskForScheme(scheme) });
  window.location.href = trimmed;
}

export default function SystemActionsApp({ initialAction }: SystemActionsAppProps) {
  const { t } = useI18n();
  const [phone, setPhone] = useState(() => safeString(initialAction?.phoneNumber));
  const [messageText, setMessageText] = useState(() => safeString(initialAction?.text));
  const [email, setEmail] = useState(() => safeString(initialAction?.email));
  const [subject, setSubject] = useState(() => safeString(initialAction?.subject));
  const [shortcutName, setShortcutName] = useState(() => safeString(initialAction?.shortcutName) || "OwnOrbit Bridge");
  const [shortcutInput, setShortcutInput] = useState(() => safeString(initialAction?.text));
  const [customName, setCustomName] = useState("");
  const [customUrl, setCustomUrl] = useState(() => safeString(initialAction?.targetUrl));
  const [allowedSchemes, setAllowedSchemes] = useState<string[]>(loadAllowedUrlSchemes);
  const [schemeInput, setSchemeInput] = useState(() => allowedSchemes.join(", "));
  const [hydrated, setHydrated] = useState(false);
  const [savedActions, setSavedActions] = useState<SavedSystemAction[]>(loadSavedSystemActions);
  const [actionLogs, setActionLogs] = useState<SystemActionLog[]>(loadSystemActionLogs);
  const latestActionLog = actionLogs[0];
  const actionLogSummary = {
    opened: actionLogs.filter((log) => log.status === "opened").length,
    blocked: actionLogs.filter((log) => log.status === "blocked").length,
    cancelled: actionLogs.filter((log) => log.status === "cancelled").length,
    highRisk: actionLogs.filter((log) => log.risk === "high").length,
  };
  const sourceSummary = buildActionLogSourceSummary(actionLogs);
  const capabilitySummary = getSystemActionCapabilitySummary(allowedSchemes);
  const nativeActionPlanSummary = getNativeSystemActionPlanSummary();
  const localizedUrlOptions = {
    manualSource: t("actions.source.manual"),
    unknownLabel: t("actions.unknown"),
    blockedMessage: (scheme: string) => t("actions.blockedScheme", { scheme }),
    confirmMessage: (label: string) => t("actions.confirmRun", { label }),
  };

  const appendActionLog = (log: Omit<SystemActionLog, "id" | "createdAt">) => {
    const normalized = normalizeSystemActionLog({
      ...log,
      id: `action-log-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      createdAt: Date.now(),
    });
    if (!normalized) return;
    setActionLogs((items) => [
      normalized,
      ...items,
    ].slice(0, 20));
  };

  const clearActionLogs = () => {
    if (actionLogs.length === 0) return;
    if (!window.confirm(t("actions.confirmClearLogs", {
      count: actionLogs.length,
      opened: actionLogSummary.opened,
      blocked: actionLogSummary.blocked,
      highRisk: actionLogSummary.highRisk,
    }))) return;
    setActionLogs([]);
  };

  useEffect(() => {
    writeSystemActionStorage(SYSTEM_ACTIONS_STORAGE_KEY, savedActions);
    if (hydrated) void setClientState("lifeos_system_actions", savedActions);
  }, [savedActions, hydrated]);

  useEffect(() => {
    writeSystemActionStorage(ALLOWED_URL_SCHEMES_STORAGE_KEY, allowedSchemes);
    if (hydrated) void setClientState("lifeos_allowed_url_schemes", allowedSchemes);
  }, [allowedSchemes, hydrated]);

  useEffect(() => {
    writeSystemActionStorage(SYSTEM_ACTION_LOGS_STORAGE_KEY, actionLogs);
    if (hydrated) void setClientState("lifeos_system_action_logs", actionLogs);
  }, [actionLogs, hydrated]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const [serverActions, serverSchemes, serverLogs] = await Promise.all([
        getClientState<SavedSystemAction[]>("lifeos_system_actions", savedActions),
        getClientState<string[]>("lifeos_allowed_url_schemes", allowedSchemes),
        getClientState<SystemActionLog[]>("lifeos_system_action_logs", actionLogs),
      ]);
      if (cancelled) return;
      if (Array.isArray(serverActions)) setSavedActions(serverActions);
      if (Array.isArray(serverSchemes) && serverSchemes.length > 0) {
        const safeSchemes = normalizeAllowedUrlSchemes(serverSchemes);
        setAllowedSchemes(safeSchemes);
        setSchemeInput(safeSchemes.join(", "));
      }
      if (Array.isArray(serverLogs)) setActionLogs(serverLogs.map(normalizeSystemActionLog).filter(Boolean).slice(0, 20) as SystemActionLog[]);
      setHydrated(true);
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const saveCustomAction = () => {
    if (!customName.trim() || !customUrl.trim()) return;
    const scheme = getUrlScheme(customUrl);
    if (!scheme || !allowedSchemes.includes(scheme)) {
      alert(t("actions.saveBlocked", { scheme: scheme || t("actions.unknown") }));
      return;
    }
    const action = {
      id: `action-${Date.now()}`,
      name: customName.trim().slice(0, 40),
      url: customUrl.trim(),
    };
    setSavedActions((items) => [action, ...items].slice(0, 12));
    setCustomName("");
  };

  const updateAllowedSchemes = () => {
    const next = normalizeAllowedUrlSchemes(schemeInput.split(","), []);
    if (next.length === 0) return;
    setAllowedSchemes(next);
    setSchemeInput(next.join(", "));
  };

  return (
    <div className="h-full overflow-y-auto bg-[#111113] text-zinc-100 p-4 space-y-4 border border-white/[0.05]">
      <section className="rounded-2xl border border-white/[0.06] bg-white/[0.03] p-3">
        <div className="mb-2 flex items-center justify-between gap-2">
          <h3 className="text-sm font-bold">{t("actions.permissionCenter")}</h3>
          <div className="flex items-center gap-2">
            <span className="rounded-full border border-white/[0.08] bg-white/[0.04] px-2.5 py-1 text-[10px] font-bold text-zinc-300">
              {t("actions.loggedCount", { count: actionLogs.length })}
            </span>
            {actionLogs.length > 0 ? (
              <button onClick={clearActionLogs} className="rounded-full border border-red-300/20 bg-red-500/10 px-2.5 py-1 text-[10px] font-bold text-red-100">
                {t("actions.clearLogs")}
              </button>
            ) : null}
          </div>
        </div>
        <div className="mb-3 grid grid-cols-4 gap-2 text-center text-[10px]">
          <ActionMetric label={t("actions.metricOpened")} value={actionLogSummary.opened} tone="text-emerald-200" />
          <ActionMetric label={t("actions.metricBlocked")} value={actionLogSummary.blocked} tone="text-red-200" />
          <ActionMetric label={t("actions.metricCancelled")} value={actionLogSummary.cancelled} tone="text-zinc-300" />
          <ActionMetric label={t("actions.metricHighRisk")} value={actionLogSummary.highRisk} tone="text-amber-100" />
        </div>
        {actionLogs.length > 0 ? (
          <div className="mb-3 rounded-xl border border-white/[0.06] bg-black/20 p-3 text-[10px] leading-relaxed text-zinc-400">
            <div className="font-bold text-zinc-200">{t("actions.sourceSummaryTitle")}</div>
            <div className="mt-1 truncate">{t("actions.sourceSummaryTop", { source: sourceSummary.topSource, count: sourceSummary.topSourceCount })}</div>
            <div className="mt-1 grid grid-cols-3 gap-2">
              <ActionMiniStat label={t("actions.sourceSummaryTotal")} value={sourceSummary.totalSources} />
              <ActionMiniStat label={t("actions.sourceSummaryBlocked")} value={sourceSummary.blockedSources} />
              <ActionMiniStat label={t("actions.sourceSummaryHighRisk")} value={sourceSummary.highRiskSources} />
            </div>
          </div>
        ) : null}
        <div className="flex flex-wrap gap-2">
          {allowedSchemes.map((scheme) => (
            <span key={scheme} className={`rounded-full border px-2.5 py-1 text-[11px] font-bold ${riskForScheme(scheme) === "high" ? "border-amber-300/25 bg-amber-500/10 text-amber-100" : riskForScheme(scheme) === "medium" ? "border-blue-300/20 bg-blue-500/10 text-blue-100" : "border-emerald-300/20 bg-emerald-500/10 text-emerald-100"}`}>
              {scheme}
            </span>
          ))}
        </div>
        <div className="mt-2 text-xs text-zinc-500">{t("actions.whitelistHint")}</div>
        <div className="mt-3 rounded-xl border border-white/[0.06] bg-black/20 p-3">
          <div className="mb-2 text-[11px] font-bold text-zinc-200">{t("actions.capabilityMatrix")}</div>
          <div className="grid gap-2 md:grid-cols-2">
            {capabilitySummary.map((capability) => (
              <div key={capability.id} className={`rounded-xl border p-2 text-[10px] ${capability.enabled ? "border-emerald-300/15 bg-emerald-500/5 text-emerald-50" : "border-white/[0.06] bg-white/[0.02] text-zinc-500"}`}>
                <div className="flex items-center justify-between gap-2">
                  <span className="font-black">{t(capabilityLabelKey(capability.id))}</span>
                  <span className={capability.enabled ? "text-emerald-200" : "text-zinc-500"}>
                    {capability.enabled ? t("actions.capabilityEnabled") : t("actions.capabilityDisabled")}
                  </span>
                </div>
                <div className="mt-1 truncate opacity-80">
                  {t(capabilityStatusKey(capability.status))} · {capability.enabledSchemes.length ? capability.enabledSchemes.join(", ") : capability.schemes.join(", ")}
                </div>
                <div className="mt-1 opacity-70">
                  {capability.requiresConfirmation ? t("actions.capabilityConfirmRequired") : t("actions.capabilityConfirmWhenRisky")}
                </div>
              </div>
            ))}
          </div>
        </div>
        <div className="mt-3 rounded-xl border border-amber-300/15 bg-amber-500/[0.04] p-3">
          <div className="mb-2 flex items-center gap-2 text-[11px] font-black text-amber-100">
            <ShieldAlert className="h-3.5 w-3.5" />
            {t("actions.nativeSafetyTitle")}
          </div>
          <p className="mb-3 text-[10px] leading-relaxed text-amber-100/70">{t("actions.nativeSafetyBody")}</p>
          <div className="grid gap-2 md:grid-cols-2">
            {nativeActionPlanSummary.map((capability) => (
              <div key={capability.id} className="rounded-xl border border-white/[0.06] bg-black/20 p-2 text-[10px] text-zinc-300">
                <div className="flex items-center justify-between gap-2">
                  <span className="font-black text-zinc-100">{t(nativeCapabilityLabelKey(capability.id))}</span>
                  <span className="rounded-full bg-amber-500/15 px-2 py-0.5 font-bold text-amber-100">
                    {t("actions.nativeStatus.blockedPreview")}
                  </span>
                </div>
                <div className="mt-1 text-zinc-500">
                  {t("actions.nativeRiskLine", { risk: riskLabel(capability.risk, t) })}
                </div>
                <div className="mt-2 flex flex-wrap gap-1.5">
                  {capability.requirements.map((requirement) => (
                    <span key={requirement} className="rounded-full border border-white/[0.06] bg-white/[0.03] px-2 py-0.5 text-zinc-400">
                      {t(nativeRequirementLabelKey(requirement))}
                    </span>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </div>
        {latestActionLog ? (
          <div className="mt-3 rounded-xl border border-white/[0.06] bg-black/20 p-3 text-xs">
            <div className="mb-2 flex items-center justify-between gap-2">
              <div className="font-bold text-zinc-100">{t("actions.latestRecord")}</div>
              <span className={`shrink-0 rounded-full px-2 py-0.5 text-[10px] font-bold ${actionStatusClass(latestActionLog.status)}`}>
                {actionStatusLabel(latestActionLog.status, t)}
              </span>
            </div>
            <div className="grid gap-1 text-[10px] text-zinc-500">
              <div className="truncate">{t("actions.logLineOne", { source: latestActionLog.source, target: latestActionLog.target })}</div>
              <div className="truncate">{t("actions.logLineTwo", { scheme: latestActionLog.scheme, risk: riskLabel(latestActionLog.risk, t), params: latestActionLog.paramsSummary })}</div>
              <div className="truncate">{t("actions.logTime", { time: new Date(latestActionLog.createdAt).toLocaleString() })}</div>
            </div>
          </div>
        ) : (
          <div className="mt-3 rounded-xl border border-white/[0.06] bg-black/20 p-3 text-xs text-zinc-500">
            {t("actions.noRecords")}
          </div>
        )}
      </section>

      <section className="rounded-2xl border border-white/[0.06] bg-white/[0.03] p-3">
        <div className="flex items-center gap-2 mb-3">
          <Phone className="w-4 h-4 text-cyan-300" />
          <h3 className="text-sm font-bold">{t("actions.phoneSms")}</h3>
        </div>
        <input
          value={phone}
          onChange={(event) => setPhone(event.target.value)}
          className="w-full rounded-xl border border-white/[0.08] bg-black/20 px-3 py-2 text-xs outline-none focus:border-cyan-400/50"
          placeholder={t("actions.phonePlaceholder")}
        />
        <textarea
          value={messageText}
          onChange={(event) => setMessageText(event.target.value)}
          className="mt-2 h-16 w-full resize-none rounded-xl border border-white/[0.08] bg-black/20 px-3 py-2 text-xs outline-none focus:border-cyan-400/50"
          placeholder={t("actions.smsPlaceholder")}
        />
        <div className="mt-2 grid grid-cols-2 gap-2">
          <button onClick={() => openUrl(`tel:${encodeURIComponent(phone)}`, allowedSchemes, { ...localizedUrlOptions, confirm: true, label: t("actions.callLabel", { phone }), source: t("actions.phoneSource"), target: phone || t("actions.emptyPhone"), paramsSummary: "-", onLog: appendActionLog })} className="inline-flex items-center justify-center gap-2 rounded-xl bg-cyan-500 px-3 py-2 text-xs font-bold text-[#061016]">
            <Phone className="w-3.5 h-3.5" />
            {t("actions.call")}
          </button>
          <button onClick={() => openUrl(`sms:${encodeURIComponent(phone)}?body=${encodeURIComponent(messageText)}`, allowedSchemes, { ...localizedUrlOptions, confirm: true, label: t("actions.smsLabel", { phone }), source: t("actions.smsSource"), target: phone || t("actions.emptyPhone"), paramsSummary: messageText ? "body" : "-", onLog: appendActionLog })} className="inline-flex items-center justify-center gap-2 rounded-xl border border-white/[0.08] bg-white/[0.04] px-3 py-2 text-xs font-bold text-zinc-200">
            <MessageSquare className="w-3.5 h-3.5" />
            {t("actions.sms")}
          </button>
        </div>
      </section>

      <section className="rounded-2xl border border-white/[0.06] bg-white/[0.03] p-3">
        <div className="flex items-center gap-2 mb-3">
          <Mail className="w-4 h-4 text-emerald-300" />
          <h3 className="text-sm font-bold">{t("actions.email")}</h3>
        </div>
        <input
          value={email}
          onChange={(event) => setEmail(event.target.value)}
          className="w-full rounded-xl border border-white/[0.08] bg-black/20 px-3 py-2 text-xs outline-none focus:border-emerald-400/50"
          placeholder={t("actions.emailPlaceholder")}
        />
        <input
          value={subject}
          onChange={(event) => setSubject(event.target.value)}
          className="mt-2 w-full rounded-xl border border-white/[0.08] bg-black/20 px-3 py-2 text-xs outline-none focus:border-emerald-400/50"
          placeholder={t("actions.subjectPlaceholder")}
        />
        <button
          onClick={() => openUrl(`mailto:${encodeURIComponent(email)}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(messageText)}`, allowedSchemes, { ...localizedUrlOptions, confirm: true, label: t("actions.emailLabel", { email }), source: t("actions.emailSource"), target: email || t("actions.emptyEmail"), paramsSummary: [subject ? "subject" : "", messageText ? "body" : ""].filter(Boolean).join(", ") || "-", onLog: appendActionLog })}
          className="mt-2 inline-flex w-full items-center justify-center gap-2 rounded-xl bg-emerald-500 px-3 py-2 text-xs font-bold text-[#061016]"
        >
          <Mail className="w-3.5 h-3.5" />
          {t("actions.openMail")}
        </button>
      </section>

      <section className="rounded-2xl border border-white/[0.06] bg-white/[0.03] p-3">
        <div className="flex items-center gap-2 mb-3">
          <Command className="w-4 h-4 text-violet-300" />
          <h3 className="text-sm font-bold">{t("actions.shortcutBridge")}</h3>
        </div>
        <input
          value={shortcutName}
          onChange={(event) => setShortcutName(event.target.value)}
          className="w-full rounded-xl border border-white/[0.08] bg-black/20 px-3 py-2 text-xs outline-none focus:border-violet-400/50"
          placeholder={t("actions.shortcutNamePlaceholder")}
        />
        <textarea
          value={shortcutInput}
          onChange={(event) => setShortcutInput(event.target.value)}
          className="mt-2 h-16 w-full resize-none rounded-xl border border-white/[0.08] bg-black/20 px-3 py-2 text-xs outline-none focus:border-violet-400/50"
          placeholder={t("actions.shortcutTextPlaceholder")}
        />
        <button
          onClick={() => openUrl(buildShortcutUrl(shortcutName, shortcutInput), allowedSchemes, { ...localizedUrlOptions, confirm: true, label: t("actions.shortcutLabel", { name: shortcutName }), source: t("actions.shortcutSource"), target: shortcutName || t("actions.unnamedShortcut"), paramsSummary: shortcutInput ? "text" : "name", onLog: appendActionLog })}
          className="mt-2 inline-flex w-full items-center justify-center gap-2 rounded-xl bg-violet-500 px-3 py-2 text-xs font-bold text-white"
        >
          <Play className="w-3.5 h-3.5" />
          {t("actions.runShortcut")}
        </button>
      </section>

      <section className="rounded-2xl border border-white/[0.06] bg-white/[0.03] p-3">
        <div className="flex items-center gap-2 mb-3">
          <ExternalLink className="w-4 h-4 text-amber-300" />
          <h3 className="text-sm font-bold">{t("actions.customScheme")}</h3>
        </div>
        <input
          value={customName}
          onChange={(event) => setCustomName(event.target.value)}
          className="w-full rounded-xl border border-white/[0.08] bg-black/20 px-3 py-2 text-xs outline-none focus:border-amber-400/50"
          placeholder={t("actions.customNamePlaceholder")}
        />
        <input
          value={customUrl}
          onChange={(event) => setCustomUrl(event.target.value)}
          className="mt-2 w-full rounded-xl border border-white/[0.08] bg-black/20 px-3 py-2 text-xs outline-none focus:border-amber-400/50"
          placeholder={t("actions.customUrlPlaceholder")}
        />
        <div className="mt-2 grid grid-cols-2 gap-2">
          <button onClick={() => openUrl(customUrl, allowedSchemes, { ...localizedUrlOptions, confirm: true, label: customName || customUrl, source: t("actions.customSource"), target: customName || customUrl, onLog: appendActionLog })} className="inline-flex items-center justify-center gap-2 rounded-xl bg-amber-400 px-3 py-2 text-xs font-bold text-[#161004]">
            <Play className="w-3.5 h-3.5" />
            {t("actions.open")}
          </button>
          <button onClick={saveCustomAction} className="inline-flex items-center justify-center gap-2 rounded-xl border border-white/[0.08] bg-white/[0.04] px-3 py-2 text-xs font-bold text-zinc-200">
            <Save className="w-3.5 h-3.5" />
            {t("actions.save")}
          </button>
        </div>
      </section>

      <section className="rounded-2xl border border-white/[0.06] bg-white/[0.03] p-3">
        <h3 className="mb-2 text-sm font-bold">{t("actions.schemeWhitelist")}</h3>
        <textarea
          value={schemeInput}
          onChange={(event) => setSchemeInput(event.target.value)}
          className="h-16 w-full resize-none rounded-xl border border-white/[0.08] bg-black/20 px-3 py-2 text-xs outline-none focus:border-cyan-400/50"
          placeholder="http, https, tel, sms, mailto, shortcuts"
        />
        <button onClick={updateAllowedSchemes} className="mt-2 w-full rounded-xl border border-white/[0.08] bg-white/[0.04] px-3 py-2 text-xs font-bold text-zinc-200">
          {t("actions.updateWhitelist")}
        </button>
      </section>

      {savedActions.length > 0 && (
        <section className="rounded-2xl border border-white/[0.06] bg-white/[0.03] p-3">
          <h3 className="mb-2 text-sm font-bold">{t("actions.savedLaunchers")}</h3>
          <div className="space-y-2">
            {savedActions.map((action) => {
              const scheme = getUrlScheme(action.url) || t("actions.unknown");
              const risk = riskForScheme(scheme);
              const redactedUrl = redactActionUrl(action.url);
              return (
                <div key={action.id} className="flex items-center gap-2 rounded-xl border border-white/[0.05] bg-black/20 p-2">
                  <button onClick={() => openUrl(action.url, allowedSchemes, { ...localizedUrlOptions, confirm: true, label: action.name, source: t("actions.savedLaunchers"), target: action.name, onLog: appendActionLog })} className="min-w-0 flex-1 text-left">
                    <div className="truncate text-xs font-bold text-zinc-100">{action.name}</div>
                    <div className="truncate text-[10px] text-zinc-500">{redactedUrl}</div>
                    <div className="mt-1 truncate text-[10px] text-zinc-500">
                      {t("actions.launcherRiskLine", { scheme, risk: riskLabel(risk, t), params: summarizeActionParams(action.url) })}
                    </div>
                  </button>
                  <button
                    onClick={() => setSavedActions((items) => items.filter((item) => item.id !== action.id))}
                    className="rounded-lg p-2 text-zinc-500 hover:bg-red-500/10 hover:text-red-300"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </div>
              );
            })}
          </div>
        </section>
      )}

      {actionLogs.length > 0 && (
        <section className="rounded-2xl border border-white/[0.06] bg-white/[0.03] p-3">
          <div className="mb-2 flex items-center justify-between gap-2">
            <h3 className="text-sm font-bold">{t("actions.recentLogs")}</h3>
            <button onClick={clearActionLogs} className="text-[11px] font-bold text-zinc-500 hover:text-zinc-200">
              {t("actions.clear")}
            </button>
          </div>
          <div className="space-y-2">
            {actionLogs.slice(0, 6).map((log) => (
              <div key={log.id} className="rounded-xl border border-white/[0.05] bg-black/20 p-2">
                <div className="flex items-center justify-between gap-2">
                  <div className="truncate text-xs font-bold text-zinc-100">{log.label}</div>
                  <span className={`shrink-0 rounded-full px-2 py-0.5 text-[10px] font-bold ${actionStatusClass(log.status)}`}>
                    {actionStatusLabel(log.status, t)}
                  </span>
                </div>
                <div className="mt-1 grid gap-1 text-[10px] text-zinc-500">
                  <div className="truncate">{t("actions.logLineOne", { source: log.source, target: log.target })}</div>
                  <div className="truncate">{t("actions.logLineTwo", { scheme: log.scheme, risk: riskLabel(log.risk, t), params: log.paramsSummary })}</div>
                  <div className="truncate">{t("actions.logTime", { time: new Date(log.createdAt).toLocaleString() })} · {log.url}</div>
                </div>
              </div>
            ))}
          </div>
        </section>
      )}
    </div>
  );
}

function ActionMetric({ label, value, tone }: { label: string; value: number; tone: string }) {
  return (
    <div className="rounded-xl border border-white/[0.06] bg-black/15 px-2 py-2">
      <div className={`font-black ${tone}`}>{value}</div>
      <div className="mt-0.5 font-bold text-zinc-500">{label}</div>
    </div>
  );
}

function ActionMiniStat({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-lg border border-white/[0.05] bg-white/[0.03] px-2 py-1.5">
      <div className="font-black text-zinc-100">{value}</div>
      <div className="truncate text-zinc-500">{label}</div>
    </div>
  );
}
