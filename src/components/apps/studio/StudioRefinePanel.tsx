import { AlertCircle, RefreshCw, Sparkles } from "lucide-react";
import { useI18n } from "../../../i18n/I18nProvider";
import type { CustomAppAutoRepairQueueItem, CustomAppAutoRepairResult, CustomAppAutoRepairTask, CustomAppRepairProposal, StoredCustomAppRuntimeEvent } from "../../../services/lifeosApi";
import StudioRuntimeEventsPanel from "./StudioRuntimeEventsPanel";
import StudioRefineVersionCompareCard from "./StudioRefineVersionCompareCard";
import StudioStoredVersionCompareCard from "./StudioStoredVersionCompareCard";

export type StudioRefineHistoryItem = {
  id: string;
  timestamp: string;
  instruction: string;
  code: string;
  persona: string;
};

type StudioRefinePanelProps = {
  appId?: string | null;
  currentCode: string;
  instruction: string;
  isRefining: boolean;
  refineError: string | null;
  refineHistory: StudioRefineHistoryItem[];
  runtimeEvents: StoredCustomAppRuntimeEvent[];
  isLoadingRuntimeEvents: boolean;
  runtimeEventsError: string | null;
  runtimeDebugIssue: string;
  runtimeRepairProposal: CustomAppRepairProposal | null;
  runtimeAutoRepairQueue: CustomAppAutoRepairQueueItem[];
  runtimeAutoRepairTask: CustomAppAutoRepairTask | null;
  runtimeAutoRepairResult: CustomAppAutoRepairResult | null;
  isRequestingRuntimeDebug: boolean;
  isApplyingRuntimeRepair: boolean;
  onInstructionChange: (value: string) => void;
  onRefine: () => void;
  onRollback: (version: StudioRefineHistoryItem) => void;
  onRuntimeDebugIssueChange: (value: string) => void;
  onRefreshRuntimeEvents: () => void;
  onRequestRuntimeDebug: () => void;
  onApplyRuntimeRepair: () => void;
  onResumeRuntimeRepair: (item: CustomAppAutoRepairQueueItem) => void;
  onApplyStoredVersionRepair: (instruction: string) => void;
};

export default function StudioRefinePanel({
  appId,
  currentCode,
  instruction,
  isRefining,
  refineError,
  refineHistory,
  runtimeEvents,
  isLoadingRuntimeEvents,
  runtimeEventsError,
  runtimeDebugIssue,
  runtimeRepairProposal,
  runtimeAutoRepairQueue,
  runtimeAutoRepairTask,
  runtimeAutoRepairResult,
  isRequestingRuntimeDebug,
  isApplyingRuntimeRepair,
  onInstructionChange,
  onRefine,
  onRollback,
  onRuntimeDebugIssueChange,
  onRefreshRuntimeEvents,
  onRequestRuntimeDebug,
  onApplyRuntimeRepair,
  onResumeRuntimeRepair,
  onApplyStoredVersionRepair,
}: StudioRefinePanelProps) {
  const { t } = useI18n();
  const presetInstructions = [
    { label: t("studio.dev.presetResetLabel"), prompt: t("studio.dev.presetResetPrompt") },
    { label: t("studio.dev.presetThemeLabel"), prompt: t("studio.dev.presetThemePrompt") },
    { label: t("studio.dev.presetPersistLabel"), prompt: t("studio.dev.presetPersistPrompt") },
    { label: t("studio.dev.presetMotionLabel"), prompt: t("studio.dev.presetMotionPrompt") },
  ];

  return (
    <div className="w-full lg:w-[360px] xl:w-[380px] bg-[#0b0b0e] border-b lg:border-b-0 lg:border-r border-white/[0.08] p-6 text-left flex flex-col shrink-0 relative overflow-y-auto gap-5 scrollbar-thin">
      <div className="absolute top-0 right-0 w-64 h-64 bg-indigo-500/5 rounded-full blur-3xl pointer-events-none" />

      <div className="space-y-1 relative">
        <div className="flex items-center gap-2 text-zinc-100 font-bold text-sm">
          <Sparkles className="w-4 h-4 text-indigo-400 animate-pulse" />
          <span>{t("studio.refine.title")}</span>
        </div>
        <p className="text-xs text-zinc-400 leading-relaxed font-sans">
          {t("studio.refine.subtitle")}
        </p>
      </div>

      <div className="space-y-3.5 relative">
        <div className="space-y-2">
          <div className="flex flex-wrap gap-1.5 pb-0.5">
            {presetInstructions.map((preset, idx) => (
              <button
                key={idx}
                type="button"
                onClick={() => onInstructionChange(preset.prompt)}
                className="text-[10px] px-2 py-0.5 rounded bg-indigo-500/10 hover:bg-indigo-500/20 text-indigo-400 font-medium transition-all"
              >
                {preset.label.replace(/^[^a-zA-Z]+/, "")}
              </button>
            ))}
          </div>

          <textarea
            value={instruction}
            onChange={(event) => onInstructionChange(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter" && !event.shiftKey && !isRefining) {
                event.preventDefault();
                if (instruction.trim()) {
                  onRefine();
                }
              }
            }}
            rows={4}
            placeholder={t("studio.refine.placeholder")}
            disabled={isRefining}
            className="w-full bg-[#141416] hover:border-white/10 focus:border-indigo-500 border border-white/[0.06] rounded-xl px-3.5 py-3 text-xs text-zinc-200 outline-none placeholder-zinc-500 transition-all focus:shadow-[0_0_15px_rgba(99,102,241,0.08)] disabled:opacity-50 font-medium resize-none leading-relaxed animate-fade-in"
          />
          <div className="text-[10px] text-zinc-500 text-right">
            <span>{t("studio.refine.shortcut")}</span>
          </div>
        </div>

        <button
          onClick={onRefine}
          disabled={isRefining || !instruction.trim()}
          className="w-full bg-zinc-100 hover:bg-white text-black disabled:bg-zinc-800 disabled:text-zinc-600 py-2.5 rounded-xl text-xs font-bold transition-all shrink-0 flex items-center justify-center gap-1.5 shadow-lg active:scale-[0.98] disabled:pointer-events-none"
        >
          {isRefining ? (
            <>
              <RefreshCw className="w-3.5 h-3.5 animate-spin text-zinc-900" />
              {t("studio.refine.running")}
            </>
          ) : (
            <>
              <Sparkles className="w-3.5 h-3.5 text-indigo-600" />
              <span>{t("studio.refine.execute")}</span>
            </>
          )}
        </button>
      </div>

      <div className="space-y-2 mt-2">
        <div className="text-[10px] text-zinc-500 font-bold uppercase tracking-wider flex items-center justify-between">
          <span>{t("studio.refine.history")}</span>
          <span className="text-emerald-400 font-semibold text-[9px] px-1.5 py-0.5 bg-emerald-500/10 rounded font-mono">HISTORY</span>
        </div>
        {refineHistory.length === 0 ? (
          <div className="border border-dashed border-white/[0.04] rounded-xl p-3.5 text-center text-zinc-650 text-[10px]">
            {t("studio.refine.emptyHistory")}
          </div>
        ) : (
          <div className="flex flex-col gap-1.5 max-h-[140px] overflow-y-auto scrollbar-thin">
            {refineHistory.map((version) => (
              <div
                key={version.id}
                className="bg-[#141416] border border-white/[0.04] rounded-lg p-2.5 flex items-center justify-between text-xs hover:bg-[#18181b] transition-all"
              >
                <div className="space-y-0.5 text-left truncate flex-grow pr-2">
                  <div className="text-[9px] font-mono text-zinc-550">
                    {version.timestamp}
                  </div>
                  <div className="text-zinc-300 font-medium truncate text-[11px]" title={version.instruction}>
                    {version.instruction}
                  </div>
                </div>
                <button
                  onClick={() => onRollback(version)}
                  className="text-[10px] text-indigo-400 hover:text-indigo-300 font-semibold bg-indigo-500/5 hover:bg-indigo-500/15 border border-indigo-500/10 px-2.5 py-1 rounded transition-all shrink-0"
                >
                  {t("studio.refine.rollback")}
                </button>
              </div>
            ))}
          </div>
        )}
      </div>

      <StudioRefineVersionCompareCard currentCode={currentCode} refineHistory={refineHistory} />
      <StudioStoredVersionCompareCard appId={appId} isApplyingRepair={isRefining} onApplyRepair={onApplyStoredVersionRepair} />

      {refineError && (
        <div className="text-xs text-red-500 bg-red-500/5 border border-red-500/10 p-3 rounded-xl flex items-start gap-2">
          <AlertCircle className="w-3.5 h-3.5 shrink-0 text-red-500 mt-0.5" />
          <div className="space-y-0.5">
            <div className="font-bold">{t("studio.refine.failed")}</div>
            <div className="text-[11px] text-red-400/80 leading-relaxed font-mono">{refineError}</div>
          </div>
        </div>
      )}

      <StudioRuntimeEventsPanel
        events={runtimeEvents}
        isLoading={isLoadingRuntimeEvents}
        error={runtimeEventsError}
        issue={runtimeDebugIssue}
        repairProposal={runtimeRepairProposal}
        autoRepairQueue={runtimeAutoRepairQueue}
        autoRepairTask={runtimeAutoRepairTask}
        autoRepairResult={runtimeAutoRepairResult}
        isRequestingDebug={isRequestingRuntimeDebug}
        isApplyingRepair={isApplyingRuntimeRepair}
        onIssueChange={onRuntimeDebugIssueChange}
        onRefresh={onRefreshRuntimeEvents}
        onRequestDebug={onRequestRuntimeDebug}
        onApplyRepair={onApplyRuntimeRepair}
        onResumeAutoRepair={onResumeRuntimeRepair}
      />

      <div className="mt-auto pt-4 border-t border-white/[0.04] text-[10px] text-zinc-500 flex items-center gap-1.5 justify-center">
        <span>{t("studio.refine.footer")}</span>
      </div>
    </div>
  );
}
