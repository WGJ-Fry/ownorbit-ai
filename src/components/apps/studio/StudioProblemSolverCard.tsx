import { ArrowRight, ClipboardList, ShieldAlert, Sparkles, WandSparkles } from "lucide-react";
import type { ProblemBlueprint } from "../../../services/problemBlueprint";
import { useI18n } from "../../../i18n/I18nProvider";

type StudioProblemSolverCardProps = {
  problemInput: string;
  blueprint: ProblemBlueprint;
  onProblemInputChange: (value: string) => void;
  onGenerateFromBlueprint: () => void;
};

export default function StudioProblemSolverCard({
  problemInput,
  blueprint,
  onProblemInputChange,
  onGenerateFromBlueprint,
}: StudioProblemSolverCardProps) {
  const { t } = useI18n();
  const visibleSteps = blueprint.steps.slice(0, 3);

  return (
    <section className="bg-[#0b0b0d] border border-emerald-500/15 rounded-[24px] overflow-hidden shadow-[0_18px_60px_rgba(0,0,0,0.28)]">
      <div className="p-6 border-b border-white/[0.06] bg-gradient-to-r from-emerald-500/10 via-cyan-500/[0.04] to-transparent">
        <div className="flex flex-col lg:flex-row lg:items-start justify-between gap-5">
          <div className="max-w-2xl">
            <p className="text-[10px] font-black uppercase tracking-[0.24em] text-emerald-300 mb-2">
              {t("studio.problemSolver.eyebrow")}
            </p>
            <h3 className="text-xl font-black text-white flex items-center gap-2">
              <WandSparkles className="w-5 h-5 text-emerald-300" />
              {t("studio.problemSolver.title")}
            </h3>
            <p className="text-xs text-zinc-400 leading-relaxed mt-2 font-medium">
              {t("studio.problemSolver.subtitle")}
            </p>
          </div>
          <button
            onClick={onGenerateFromBlueprint}
            disabled={!blueprint.isReady}
            className="inline-flex items-center justify-center gap-2 px-5 py-3 rounded-2xl bg-emerald-500 text-black text-xs font-black hover:bg-emerald-400 disabled:opacity-40 disabled:cursor-not-allowed transition-all active:scale-95 shadow-[0_0_24px_rgba(16,185,129,0.24)] shrink-0"
          >
            <Sparkles className="w-4 h-4" />
            {t("studio.problemSolver.generate")}
          </button>
        </div>

        <textarea
          value={problemInput}
          onChange={(event) => onProblemInputChange(event.target.value)}
          placeholder={t("studio.problemSolver.placeholder")}
          className="mt-5 w-full min-h-[108px] resize-y rounded-2xl border border-white/[0.08] bg-black/35 p-4 text-sm text-zinc-100 placeholder:text-zinc-600 outline-none focus:border-emerald-400/60 focus:ring-2 focus:ring-emerald-400/10 leading-relaxed"
          maxLength={900}
        />
      </div>

      <div className="p-6 grid grid-cols-1 xl:grid-cols-[1.15fr_0.85fr] gap-5">
        <div className="space-y-4">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-[10px] font-black uppercase tracking-[0.18em] text-zinc-500">
              {t("studio.problemSolver.category")}
            </span>
            <span className="px-2.5 py-1 rounded-full bg-emerald-500/10 border border-emerald-500/25 text-emerald-300 text-[11px] font-bold">
              {blueprint.categoryLabel}
            </span>
            <span className="px-2.5 py-1 rounded-full bg-white/[0.04] border border-white/[0.06] text-zinc-300 text-[11px] font-semibold">
              {blueprint.suggestedAppName}
            </span>
          </div>
          <p className="text-sm text-zinc-300 leading-relaxed font-semibold">
            {blueprint.summary}
          </p>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            {visibleSteps.map((step, index) => (
              <div key={step.id} className="rounded-2xl bg-white/[0.025] border border-white/[0.06] p-4 min-h-[150px]">
                <div className="w-8 h-8 rounded-xl bg-emerald-500/10 border border-emerald-500/20 text-emerald-300 text-xs font-black flex items-center justify-center mb-3">
                  {index + 1}
                </div>
                <h4 className="text-sm font-black text-white mb-2">{step.title}</h4>
                <p className="text-xs text-zinc-400 leading-relaxed font-medium">{step.detail}</p>
                <p className="mt-3 text-[10px] text-zinc-500 font-mono">{step.artifact}</p>
              </div>
            ))}
          </div>
        </div>

        <div className="space-y-4">
          <div className="rounded-2xl bg-white/[0.025] border border-white/[0.06] p-4">
            <h4 className="text-xs font-black text-zinc-200 flex items-center gap-2 mb-3">
              <ClipboardList className="w-4 h-4 text-cyan-300" />
              {t("studio.problemSolver.modules")}
            </h4>
            <div className="flex flex-wrap gap-2">
              {blueprint.suggestedModules.map((module) => (
                <span key={module} className="px-2.5 py-1 rounded-lg bg-cyan-500/10 border border-cyan-500/20 text-cyan-200 text-[11px] font-bold">
                  {module}
                </span>
              ))}
            </div>
          </div>

          <div className="rounded-2xl bg-amber-500/[0.04] border border-amber-500/15 p-4">
            <h4 className="text-xs font-black text-amber-200 flex items-center gap-2 mb-2">
              <ShieldAlert className="w-4 h-4 text-amber-300" />
              {t("studio.problemSolver.risks")}
            </h4>
            {blueprint.riskNotes.map((risk) => (
              <p key={risk} className="text-xs text-amber-100/75 leading-relaxed font-medium">
                {risk}
              </p>
            ))}
          </div>

          <button
            onClick={onGenerateFromBlueprint}
            disabled={!blueprint.isReady}
            className="w-full flex items-center justify-between gap-3 px-4 py-3 rounded-2xl border border-white/[0.08] bg-white/[0.03] hover:bg-white/[0.06] disabled:opacity-40 disabled:cursor-not-allowed text-left transition-colors"
          >
            <span>
              <span className="block text-sm font-black text-white">{t("studio.problemSolver.reviewPrompt")}</span>
              <span className="block text-[11px] text-zinc-500 mt-0.5">{t("studio.problemSolver.reviewPromptHint")}</span>
            </span>
            <ArrowRight className="w-4 h-4 text-emerald-300 shrink-0" />
          </button>
        </div>
      </div>
    </section>
  );
}
