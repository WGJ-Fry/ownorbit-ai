import { useEffect, useState } from "react";
import { CheckCircle2, Clock3, Loader2, RefreshCw, ShieldCheck } from "lucide-react";
import {
  getCloudKitAutoSyncSchedule,
  runCloudKitAutoSyncNow,
  updateCloudKitAutoSyncSchedule,
  type CloudKitAutoSyncSchedule,
  type NetworkDiagnostics,
} from "../../services/lifeosApi";
import { useI18n } from "../../i18n/I18nProvider";

type Props = {
  dataSyncReady: boolean;
  onDiagnostics?: (diagnostics: NetworkDiagnostics) => void;
};

const intervals = [15, 30, 60, 180];

const autoSyncNextActionKeys: Record<string, { titleKey: string; bodyKey: string; ctaKey?: string; targetTestId?: string; retry?: boolean; tone: string }> = {
  "configure-cloudkit": {
    titleKey: "onboarding.appleRemoteIcloudDataSyncAutoNextConfigureTitle",
    bodyKey: "onboarding.appleRemoteIcloudDataSyncAutoNextConfigureBody",
    ctaKey: "onboarding.appleRemoteIcloudDataSyncAutoNextConfigureCta",
    targetTestId: "onboarding-icloud-data-sync-readiness",
    tone: "border-amber-300/25 bg-amber-500/10 text-amber-50",
  },
  "review-conflicts": {
    titleKey: "onboarding.appleRemoteIcloudDataSyncAutoNextReviewTitle",
    bodyKey: "onboarding.appleRemoteIcloudDataSyncAutoNextReviewBody",
    ctaKey: "onboarding.appleRemoteIcloudDataSyncAutoNextReviewCta",
    targetTestId: "onboarding-icloud-data-sync-quarantine-next",
    tone: "border-amber-300/25 bg-amber-500/10 text-amber-50",
  },
  "review-blocked-records": {
    titleKey: "onboarding.appleRemoteIcloudDataSyncAutoNextBlockedTitle",
    bodyKey: "onboarding.appleRemoteIcloudDataSyncAutoNextBlockedBody",
    ctaKey: "onboarding.appleRemoteIcloudDataSyncAutoNextBlockedCta",
    targetTestId: "onboarding-icloud-data-sync-record-plan",
    tone: "border-sky-300/25 bg-sky-500/10 text-sky-50",
  },
  retry: {
    titleKey: "onboarding.appleRemoteIcloudDataSyncAutoNextRetryTitle",
    bodyKey: "onboarding.appleRemoteIcloudDataSyncAutoNextRetryBody",
    ctaKey: "onboarding.appleRemoteIcloudDataSyncAutoNextRetryCta",
    retry: true,
    tone: "border-red-300/25 bg-red-500/10 text-red-50",
  },
  wait: {
    titleKey: "onboarding.appleRemoteIcloudDataSyncAutoNextWaitTitle",
    bodyKey: "onboarding.appleRemoteIcloudDataSyncAutoNextWaitBody",
    ctaKey: "onboarding.appleRemoteIcloudDataSyncAutoNextWaitCta",
    targetTestId: "onboarding-icloud-data-sync-auto-last-result",
    tone: "border-cyan-300/25 bg-cyan-500/10 text-cyan-50",
  },
  done: {
    titleKey: "onboarding.appleRemoteIcloudDataSyncAutoNextDoneTitle",
    bodyKey: "onboarding.appleRemoteIcloudDataSyncAutoNextDoneBody",
    tone: "border-emerald-300/25 bg-emerald-500/10 text-emerald-50",
  },
  "use-lifeos": {
    titleKey: "onboarding.appleRemoteIcloudDataSyncAutoNextDoneTitle",
    bodyKey: "onboarding.appleRemoteIcloudDataSyncAutoNextDoneBody",
    tone: "border-emerald-300/25 bg-emerald-500/10 text-emerald-50",
  },
};

function formatTime(value?: number) {
  if (!value) return "";
  try {
    return new Date(value).toLocaleString();
  } catch {
    return "";
  }
}

export default function CloudKitAutoSyncCard({ dataSyncReady, onDiagnostics }: Props) {
  const { t } = useI18n();
  const [schedule, setSchedule] = useState<CloudKitAutoSyncSchedule | null>(null);
  const [busy, setBusy] = useState<"load" | "save" | "run" | null>("load");
  const [message, setMessage] = useState("");

  useEffect(() => {
    let cancelled = false;
    getCloudKitAutoSyncSchedule()
      .then((result) => {
        if (cancelled) return;
        setSchedule(result.schedule);
        onDiagnostics?.(result.diagnostics);
      })
      .catch((error: any) => {
        if (!cancelled) setMessage(error?.message || t("onboarding.appleRemoteIcloudDataSyncAutoLoadFailed"));
      })
      .finally(() => {
        if (!cancelled) setBusy(null);
      });
    return () => {
      cancelled = true;
    };
  }, [onDiagnostics, t]);

  const enabled = Boolean(schedule?.enabled);
  const intervalMinutes = schedule?.intervalMinutes || 15;
  const lastResult = schedule?.lastResult;
  const pendingLocalChanges = schedule?.pendingLocalChanges;
  const lastResultNextAction = lastResult ? autoSyncNextActionKeys[lastResult.nextAction] || autoSyncNextActionKeys.retry : null;
  const nextRunAt = formatTime(schedule?.nextRunAt);
  const pendingNextRunAt = formatTime(pendingLocalChanges?.nextSuggestedRunAt);
  const lastRunAt = formatTime(schedule?.lastRunAt);
  const pendingTypeSummary = pendingLocalChanges
    ? Object.entries(pendingLocalChanges.byType)
      .map(([type, count]) => `${type}: ${count}`)
      .join(", ")
    : "";
  const statusTone = enabled
    ? "border-emerald-300/20 bg-emerald-500/10 text-emerald-50"
    : dataSyncReady
    ? "border-cyan-300/20 bg-cyan-500/10 text-cyan-50"
    : "border-amber-300/20 bg-amber-500/10 text-amber-50";

  const saveSchedule = async (next: { enabled: boolean; intervalMinutes: number }) => {
    setBusy("save");
    setMessage("");
    try {
      const result = await updateCloudKitAutoSyncSchedule(next);
      setSchedule(result.schedule);
      onDiagnostics?.(result.diagnostics);
      setMessage(next.enabled ? t("onboarding.appleRemoteIcloudDataSyncAutoSavedOn") : t("onboarding.appleRemoteIcloudDataSyncAutoSavedOff"));
    } catch (error: any) {
      setMessage(error?.message || t("onboarding.appleRemoteIcloudDataSyncAutoSaveFailed"));
    } finally {
      setBusy(null);
    }
  };

  const runNow = async () => {
    setBusy("run");
    setMessage("");
    try {
      const result = await runCloudKitAutoSyncNow();
      setSchedule(result.schedule);
      onDiagnostics?.(result.diagnostics);
      setMessage(result.skipped ? t("onboarding.appleRemoteIcloudDataSyncAutoSkipped") : t("onboarding.appleRemoteIcloudDataSyncAutoRunDone"));
    } catch (error: any) {
      const payload = error?.payload as { schedule?: CloudKitAutoSyncSchedule; diagnostics?: NetworkDiagnostics } | undefined;
      if (payload?.schedule) setSchedule(payload.schedule);
      if (payload?.diagnostics) onDiagnostics?.(payload.diagnostics);
      setMessage(error?.message || t("onboarding.appleRemoteIcloudDataSyncAutoRunFailed"));
    } finally {
      setBusy(null);
    }
  };

  const handleLastResultNextAction = () => {
    if (!lastResultNextAction) return;
    if (lastResultNextAction.retry) {
      runNow();
      return;
    }
    if (lastResultNextAction.targetTestId) {
      const target = document.querySelector(`[data-testid="${lastResultNextAction.targetTestId}"]`);
      target?.scrollIntoView({ block: "center", behavior: "smooth" });
    }
  };

  return (
    <div data-testid="onboarding-icloud-data-sync-auto" className={`mt-2 rounded-lg border p-3 text-[11px] leading-relaxed ${statusTone}`}>
      <div className="flex items-start gap-2">
        {enabled ? <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" /> : <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0" />}
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="font-bold">{t("onboarding.appleRemoteIcloudDataSyncAutoTitle")}</div>
            <span className="rounded-full border border-current/15 bg-black/15 px-2 py-0.5 text-[10px] font-bold">
              {enabled ? t("onboarding.appleRemoteIcloudDataSyncAutoOn") : t("onboarding.appleRemoteIcloudDataSyncAutoOff")}
            </span>
          </div>
          <div className="mt-1 opacity-85">
            {dataSyncReady ? t("onboarding.appleRemoteIcloudDataSyncAutoBodyReady") : t("onboarding.appleRemoteIcloudDataSyncAutoBodyBlocked")}
          </div>
          <div className="mt-3 grid gap-2 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-end">
            <label className="grid gap-1">
              <span className="text-[10px] font-bold uppercase tracking-normal opacity-70">
                {t("onboarding.appleRemoteIcloudDataSyncAutoInterval")}
              </span>
              <select
                data-testid="onboarding-icloud-data-sync-auto-interval"
                value={intervalMinutes}
                disabled={busy === "load" || busy === "save"}
                onChange={(event) => saveSchedule({ enabled, intervalMinutes: Number(event.target.value) })}
                className="rounded-lg border border-current/15 bg-[#060a10]/60 px-3 py-2 text-[11px] font-bold text-inherit outline-none"
              >
                {intervals.map((value) => (
                  <option key={value} value={value}>
                    {t("onboarding.appleRemoteIcloudDataSyncAutoEveryMinutes", { minutes: value })}
                  </option>
                ))}
              </select>
            </label>
            <button
              type="button"
              data-testid="onboarding-icloud-data-sync-auto-toggle"
              onClick={() => saveSchedule({ enabled: !enabled, intervalMinutes })}
              disabled={!dataSyncReady || busy === "load" || busy === "save"}
              className="inline-flex w-full items-center justify-center gap-2 rounded-lg bg-cyan-300 px-3 py-2 text-[11px] font-bold text-slate-950 disabled:opacity-50 sm:w-auto"
            >
              {busy === "save" ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}
              {enabled ? t("onboarding.appleRemoteIcloudDataSyncAutoDisable") : t("onboarding.appleRemoteIcloudDataSyncAutoEnable")}
            </button>
          </div>
          <div className="mt-2 flex flex-wrap gap-2">
            <button
              type="button"
              data-testid="onboarding-icloud-data-sync-auto-run-now"
              onClick={runNow}
              disabled={!dataSyncReady || busy === "load" || busy === "run"}
              className="inline-flex items-center justify-center gap-2 rounded-lg border border-current/15 bg-black/15 px-3 py-2 text-[11px] font-bold disabled:opacity-50"
            >
              {busy === "run" ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Clock3 className="h-3.5 w-3.5" />}
              {t("onboarding.appleRemoteIcloudDataSyncAutoRunNow")}
            </button>
            {nextRunAt ? (
              <span className="inline-flex items-center rounded-lg border border-current/10 bg-black/10 px-3 py-2 text-[10px] font-bold opacity-85">
                {t("onboarding.appleRemoteIcloudDataSyncAutoNextRun", { time: nextRunAt })}
              </span>
            ) : null}
          </div>
          {message ? (
            <div className="mt-2 rounded-lg border border-current/10 bg-black/10 px-2 py-1 font-bold">
              {message}
            </div>
          ) : null}
          {pendingLocalChanges?.total ? (
            <div data-testid="onboarding-icloud-data-sync-auto-pending-local" className="mt-2 rounded-lg border border-current/10 bg-black/10 p-2 text-[10px] font-bold">
              <div>{t("onboarding.appleRemoteIcloudDataSyncAutoPendingLocal", { count: pendingLocalChanges.total, types: pendingTypeSummary || "-" })}</div>
              {pendingNextRunAt ? <div className="mt-1 opacity-80">{t("onboarding.appleRemoteIcloudDataSyncAutoPendingNext", { time: pendingNextRunAt })}</div> : null}
            </div>
          ) : null}
          {lastResult ? (
            <div data-testid="onboarding-icloud-data-sync-auto-last-result" className="mt-2 grid gap-1 rounded-lg border border-current/10 bg-black/10 p-2 font-mono text-[10px] opacity-85">
              <div className="font-sans text-[11px] font-bold">{t("onboarding.appleRemoteIcloudDataSyncAutoLastTitle")}</div>
              <div>{t("onboarding.appleRemoteIcloudDataSyncAutoLastStatus", { status: lastResult.status, action: lastResult.nextAction })}</div>
              <div>{t("onboarding.appleRemoteIcloudDataSyncAutoLastCounts", {
                applied: lastResult.pullApplied || 0,
                conflicts: lastResult.pullConflicts || 0,
                uploaded: lastResult.uploadSaved || 0,
              })}</div>
              <div>{t("onboarding.appleRemoteIcloudDataSyncAutoLastRun", { time: lastRunAt || formatTime(lastResult.finishedAt) || "-" })}</div>
            </div>
          ) : null}
          {lastResult && lastResultNextAction ? (
            <div
              data-testid="onboarding-icloud-data-sync-auto-next-action"
              data-cloudkit-auto-sync-next-action={lastResult.nextAction}
              className={`mt-2 rounded-lg border p-3 text-[11px] leading-relaxed ${lastResultNextAction.tone}`}
            >
              <div className="text-[10px] font-bold uppercase tracking-normal opacity-70">
                {t("onboarding.appleRemoteIcloudDataSyncAutoNextLabel")}
              </div>
              <div className="mt-1 font-bold">{t(lastResultNextAction.titleKey as any)}</div>
              <div className="mt-1 opacity-85">{t(lastResultNextAction.bodyKey as any)}</div>
              {lastResultNextAction.ctaKey ? (
                <button
                  type="button"
                  data-testid="onboarding-icloud-data-sync-auto-next-action-button"
                  onClick={handleLastResultNextAction}
                  disabled={busy === "run" || (lastResultNextAction.retry && !dataSyncReady)}
                  className="mt-3 inline-flex w-full items-center justify-center gap-2 rounded-lg bg-white/90 px-3 py-2 text-[11px] font-bold text-slate-950 disabled:opacity-50 sm:w-auto"
                >
                  {busy === "run" && lastResultNextAction.retry ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}
                  {t(lastResultNextAction.ctaKey as any)}
                </button>
              ) : null}
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
}
