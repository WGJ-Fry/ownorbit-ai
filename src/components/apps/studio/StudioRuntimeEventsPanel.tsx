import { AlertCircle, Bug, RefreshCw, ShieldCheck, WandSparkles } from "lucide-react";
import { useI18n } from "../../../i18n/I18nProvider";
import type { CustomAppAutoRepairResult, CustomAppAutoRepairTask, CustomAppRepairProposal, StoredCustomAppRuntimeEvent } from "../../../services/lifeosApi";

type StudioRuntimeEventsPanelProps = {
  events: StoredCustomAppRuntimeEvent[];
  isLoading: boolean;
  error: string | null;
  issue: string;
  repairProposal: CustomAppRepairProposal | null;
  autoRepairTask: CustomAppAutoRepairTask | null;
  autoRepairResult: CustomAppAutoRepairResult | null;
  isRequestingDebug: boolean;
  isApplyingRepair: boolean;
  onIssueChange: (value: string) => void;
  onRefresh: () => void;
  onRequestDebug: () => void;
  onApplyRepair: () => void;
};

function eventClass(severity: StoredCustomAppRuntimeEvent["severity"]) {
  if (severity === "error") return "border-red-500/15 bg-red-500/[0.04] text-red-300";
  if (severity === "warning") return "border-amber-500/15 bg-amber-500/[0.04] text-amber-300";
  return "border-white/[0.04] bg-[#141416] text-zinc-300";
}

function formatEventTime(createdAt: number) {
  if (!createdAt) return "--:--";
  return new Date(createdAt).toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit", second: "2-digit" });
}

function proposalRiskClass(risk: CustomAppRepairProposal["risk"]) {
  if (risk === "high") return "border-red-500/20 bg-red-500/[0.06] text-red-200";
  if (risk === "medium") return "border-amber-500/20 bg-amber-500/[0.06] text-amber-200";
  return "border-emerald-500/20 bg-emerald-500/[0.06] text-emerald-200";
}

export default function StudioRuntimeEventsPanel({
  events,
  isLoading,
  error,
  issue,
  repairProposal,
  autoRepairTask,
  autoRepairResult,
  isRequestingDebug,
  isApplyingRepair,
  onIssueChange,
  onRefresh,
  onRequestDebug,
  onApplyRepair,
}: StudioRuntimeEventsPanelProps) {
  const { t } = useI18n();
  const autoApplyBlocked = Boolean(repairProposal && !repairProposal.executionPlan.canAutoApply);

  return (
    <div className="space-y-3 mt-2">
      <div className="text-[10px] text-zinc-500 font-bold uppercase tracking-wider flex items-center justify-between">
        <span className="flex items-center gap-1.5">
          <Bug className="w-3 h-3 text-amber-400" />
          {t("studio.runtime.title")}
        </span>
        <button
          type="button"
          onClick={onRefresh}
          disabled={isLoading}
          className="text-[9px] text-zinc-400 hover:text-white bg-white/[0.03] hover:bg-white/[0.06] border border-white/[0.05] rounded px-2 py-0.5 disabled:opacity-50"
        >
          {isLoading ? t("studio.runtime.loading") : t("studio.runtime.refresh")}
        </button>
      </div>

      {error && (
        <div className="text-[10px] text-red-400 bg-red-500/5 border border-red-500/10 rounded-xl p-2.5 flex gap-2">
          <AlertCircle className="w-3.5 h-3.5 shrink-0" />
          <span>{error}</span>
        </div>
      )}

      <div className="space-y-1.5 max-h-[160px] overflow-y-auto scrollbar-thin">
        {events.length === 0 ? (
          <div className="border border-dashed border-white/[0.04] rounded-xl p-3.5 text-center text-zinc-650 text-[10px]">
            {t("studio.runtime.empty")}
          </div>
        ) : (
          events.slice(0, 8).map((event) => (
            <div key={event.id} className={`rounded-lg border p-2.5 text-xs ${eventClass(event.severity)}`}>
              <div className="flex items-center justify-between gap-2">
                <span className="font-semibold truncate text-[11px]" title={event.label}>{event.label}</span>
                <span className="text-[9px] text-zinc-500 font-mono shrink-0">{formatEventTime(event.createdAt)}</span>
              </div>
              <div className="text-[10px] text-zinc-500 font-mono mt-1 line-clamp-2" title={event.message}>
                {event.message}
              </div>
            </div>
          ))
        )}
      </div>

      {repairProposal && (
        <div className={`rounded-xl border p-3 text-[10px] leading-relaxed ${proposalRiskClass(repairProposal.risk)}`}>
          <div className="flex items-start justify-between gap-2">
            <div className="min-w-0">
              <div className="text-xs font-black text-current">{t("studio.runtime.proposalTitle")}</div>
              <div className="mt-1 text-current/75">
                {t("studio.runtime.proposalMeta", {
                  risk: t(`studio.runtime.proposalRisk.${repairProposal.risk}` as any),
                  area: t(`studio.runtime.proposalArea.${repairProposal.suspectedArea}` as any),
                })}
              </div>
            </div>
            <span className="shrink-0 rounded-full border border-current/15 bg-black/10 px-2 py-0.5 font-bold uppercase">
              {t(`studio.runtime.proposalRisk.${repairProposal.risk}` as any)}
            </span>
          </div>
          <div className="mt-3 space-y-2">
            <ProposalList title={t("studio.runtime.proposalSteps")} items={repairProposal.repairSteps.slice(0, 3)} />
            <ProposalList title={t("studio.runtime.proposalPermissionReview")} items={repairProposal.permissionReview.slice(0, 2)} />
            <ProposalList title={t("studio.runtime.proposalVersionSafety")} items={repairProposal.versionSafety.slice(0, 2)} />
            <ProposalList
              title={t("studio.runtime.executionPlan")}
              items={[
                t(`studio.runtime.executionMode.${repairProposal.executionPlan.mode}` as any),
                t(`studio.runtime.executionReason.${repairProposal.executionPlan.reasonKey}` as any),
                ...repairProposal.executionPlan.checks.slice(0, 2),
              ]}
            />
          </div>
        </div>
      )}

      {autoRepairTask && (
        <div className={`rounded-xl border p-3 text-[10px] leading-relaxed ${
          autoRepairTask.status === "ready"
            ? "border-emerald-500/20 bg-emerald-500/[0.06] text-emerald-200"
            : "border-amber-500/20 bg-amber-500/[0.06] text-amber-200"
        }`}>
          <div className="flex items-start justify-between gap-2">
            <div className="min-w-0">
              <div className="text-xs font-black text-current flex items-center gap-1.5">
                <ShieldCheck className="w-3.5 h-3.5" />
                {t("studio.runtime.autoRepairTaskTitle")}
              </div>
              <div className="mt-1 text-current/75">
                {t("studio.runtime.autoRepairTaskMeta", {
                  status: t(`studio.runtime.autoRepairTaskStatus.${autoRepairTask.status}` as any),
                  attempt: String(autoRepairTask.repairAttempt),
                  limit: String(autoRepairTask.retryLimit),
                  rollback: autoRepairTask.rollbackVersion ? `v${autoRepairTask.rollbackVersion}` : "--",
                })}
              </div>
              <div className="mt-1 text-current/75">
                {t(`studio.runtime.executionReason.${autoRepairTask.reasonKey}` as any)}
              </div>
            </div>
            <span className="shrink-0 rounded-full border border-current/15 bg-black/10 px-2 py-0.5 font-bold uppercase">
              {t(`studio.runtime.autoRepairTaskStatus.${autoRepairTask.status}` as any)}
            </span>
          </div>
          <div className="mt-3 space-y-2">
            <ProposalList title={t("studio.runtime.autoRepairChecks")} items={autoRepairTask.requiredChecks.slice(0, 3)} />
            <ProposalList title={t("studio.runtime.autoRepairNextSteps")} items={autoRepairTask.nextSteps.slice(0, 3)} />
          </div>
        </div>
      )}

      {autoRepairResult && (
        <div className={`rounded-xl border p-3 text-[10px] leading-relaxed ${
          autoRepairResult.status === "applied"
            ? "border-emerald-500/20 bg-emerald-500/[0.06] text-emerald-200"
            : "border-amber-500/20 bg-amber-500/[0.06] text-amber-200"
        }`}>
          <div className="flex items-start justify-between gap-2">
            <div className="min-w-0">
              <div className="text-xs font-black text-current flex items-center gap-1.5">
                <ShieldCheck className="w-3.5 h-3.5" />
                {t("studio.runtime.autoRepairResultTitle")}
              </div>
              <div className="mt-1 text-current/75">
                {t("studio.runtime.autoRepairResultMeta", {
                  status: t(`studio.runtime.autoRepairResultStatus.${autoRepairResult.status}` as any),
                  from: autoRepairResult.fromVersion ? `v${autoRepairResult.fromVersion}` : "--",
                  to: autoRepairResult.toVersion ? `v${autoRepairResult.toVersion}` : "--",
                  risk: autoRepairResult.comparisonRisk ? t(`studio.runtime.proposalRisk.${autoRepairResult.comparisonRisk}` as any) : "--",
                })}
              </div>
            </div>
            <span className="shrink-0 rounded-full border border-current/15 bg-black/10 px-2 py-0.5 font-bold uppercase">
              {t(`studio.runtime.autoRepairResultStatus.${autoRepairResult.status}` as any)}
            </span>
          </div>
          <div className="mt-3 space-y-2">
            <ProposalList title={t("studio.runtime.autoRepairVerification")} items={autoRepairResult.verification.requiredChecks.slice(0, 3)} />
            <ProposalList title={t("studio.runtime.autoRepairNextSteps")} items={autoRepairResult.nextSteps.slice(0, 3)} />
          </div>
        </div>
      )}

      <div className="space-y-2 pt-2 border-t border-white/[0.04]">
        <textarea
          value={issue}
          onChange={(event) => onIssueChange(event.target.value)}
          rows={2}
          placeholder={t("studio.runtime.issuePlaceholder")}
          className="w-full bg-[#141416] border border-white/[0.06] focus:border-amber-500/50 rounded-xl px-3 py-2 text-[11px] text-zinc-200 outline-none placeholder-zinc-600 resize-none"
        />
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
          <button
            type="button"
            onClick={onRequestDebug}
            disabled={isRequestingDebug || isApplyingRepair}
            className="bg-amber-500/10 hover:bg-amber-500/15 border border-amber-500/20 text-amber-300 disabled:text-zinc-600 disabled:border-white/[0.04] disabled:bg-white/[0.02] py-2 rounded-xl text-[11px] font-bold transition-all flex items-center justify-center gap-1.5"
          >
            {isRequestingDebug ? (
              <>
                <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                {t("studio.runtime.requesting")}
              </>
            ) : (
              <>
                <WandSparkles className="w-3.5 h-3.5" />
                {t("studio.runtime.requestRepair")}
              </>
            )}
          </button>
          <button
            type="button"
            onClick={onApplyRepair}
            disabled={isRequestingDebug || isApplyingRepair || autoApplyBlocked}
            className="bg-emerald-500/10 hover:bg-emerald-500/15 border border-emerald-500/20 text-emerald-300 disabled:text-zinc-600 disabled:border-white/[0.04] disabled:bg-white/[0.02] py-2 rounded-xl text-[11px] font-bold transition-all flex items-center justify-center gap-1.5"
          >
            {isApplyingRepair ? (
              <>
                <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                {t("studio.runtime.applyingRepair")}
              </>
            ) : autoApplyBlocked ? (
              <>
                <WandSparkles className="w-3.5 h-3.5" />
                {t("studio.runtime.manualReviewButton")}
              </>
            ) : (
              <>
                <WandSparkles className="w-3.5 h-3.5" />
                {t("studio.runtime.applyRepair")}
              </>
            )}
          </button>
        </div>
      </div>
    </div>
  );
}

function ProposalList({ title, items }: { title: string; items: string[] }) {
  return (
    <div>
      <div className="font-bold text-current/85">{title}</div>
      <ul className="mt-1 space-y-0.5 text-current/70">
        {items.map((item) => (
          <li key={item}>- {item}</li>
        ))}
      </ul>
    </div>
  );
}
