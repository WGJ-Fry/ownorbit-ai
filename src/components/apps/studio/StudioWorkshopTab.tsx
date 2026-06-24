import { FolderSync, Globe, Lock, Play, Sparkles, Terminal, Trash2, Zap } from "lucide-react";
import { motion } from "motion/react";
import type { ChangeEvent, RefObject } from "react";
import { useI18n } from "../../../i18n/I18nProvider";
import type { ProblemBlueprint } from "../../../services/problemBlueprint";
import { CustomApp } from "../../../types";
import StudioProblemSolverCard from "./StudioProblemSolverCard";

type StudioWorkshopTabProps = {
  customApps: CustomApp[];
  fileInputRef: RefObject<HTMLInputElement>;
  problemInput: string;
  problemBlueprint: ProblemBlueprint;
  onClose: () => void;
  onFileInputChange: (event: ChangeEvent<HTMLInputElement>) => void;
  onProblemInputChange: (value: string) => void;
  onGenerateFromProblem: () => void;
  onOpenImportWizard: () => void;
  onOpenApp?: (id: string) => void;
  onDeleteApp?: (id: string) => void;
  onEditApp: (app: CustomApp) => void;
};

export default function StudioWorkshopTab({
  customApps,
  fileInputRef,
  problemInput,
  problemBlueprint,
  onClose,
  onFileInputChange,
  onProblemInputChange,
  onGenerateFromProblem,
  onOpenImportWizard,
  onOpenApp,
  onDeleteApp,
  onEditApp,
}: StudioWorkshopTabProps) {
  const { t } = useI18n();

  return (
    <motion.div
      key="workshop"
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -10 }}
      className="space-y-6 relative rounded-[32px] transition-all duration-300"
    >
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 p-6 bg-[#0b0b0d] border border-white/[0.05] rounded-[24px] text-left relative overflow-hidden">
        <div className="absolute inset-0 bg-gradient-to-r from-indigo-500/5 to-transparent pointer-events-none" />
        <div className="relative z-10 max-w-xl">
          <h2 className="text-lg font-bold text-white flex items-center gap-2">
            <Zap className="w-5 h-5 text-indigo-400 animate-pulse" />
            {t("studio.workshop.title")}
          </h2>
          <p className="text-xs text-zinc-400 leading-relaxed mt-1 font-medium">
            {t("studio.workshop.subtitle")}
          </p>
        </div>
        <button
          onClick={onOpenImportWizard}
          className="bg-indigo-600 hover:bg-indigo-500 text-white font-bold text-xs px-5 py-3 rounded-2xl transition-all shadow-[0_0_15px_rgba(99,102,241,0.35)] hover:shadow-[0_0_20px_rgba(99,102,241,0.5)] flex items-center gap-2 active:scale-95 shrink-0"
        >
          <Sparkles className="w-4 h-4 text-indigo-200" />
          {t("studio.workshop.generate")}
        </button>
      </div>

      <StudioProblemSolverCard
        problemInput={problemInput}
        blueprint={problemBlueprint}
        onProblemInputChange={onProblemInputChange}
        onGenerateFromBlueprint={onGenerateFromProblem}
      />

      <div
        onClick={() => fileInputRef.current?.click()}
        className="group border border-dashed border-zinc-800 hover:border-indigo-500/50 bg-[#0b0b0d]/80 hover:bg-zinc-950/45 p-8 rounded-[24px] transition-all duration-300 flex flex-col items-center text-center cursor-pointer relative overflow-hidden shadow-lg select-none"
      >
        <input
          type="file"
          ref={fileInputRef}
          onChange={onFileInputChange}
          className="hidden"
          accept="*"
        />
        <div className="absolute inset-0 bg-gradient-to-b from-indigo-500/[0.02] to-transparent pointer-events-none" />
        <div className="w-14 h-14 rounded-2xl bg-white/[0.02] group-hover:bg-indigo-500/10 border border-white/[0.05] group-hover:border-indigo-500/30 flex items-center justify-center mb-4 transition-all group-hover:scale-105 group-hover:shadow-[0_0_20px_rgba(99,102,241,0.15)]">
          <FolderSync className="w-6 h-6 text-zinc-400 group-hover:text-indigo-400 transition-colors animate-pulse" />
        </div>
        <h3 className="font-bold text-zinc-200 group-hover:text-white text-sm mb-1.5 transition-colors flex items-center gap-1.5 justify-center">
          {t("studio.workshop.integratorTitle")}
        </h3>
        <p className="text-zinc-500 group-hover:text-zinc-400 text-xs max-w-2xl leading-relaxed transition-colors font-medium">
          {t("studio.workshop.dropLine1Prefix")} <span className="text-indigo-400 font-semibold">.tsx, .jsx, .vue, .html, .py, .java, .js, .json, .txt</span> {t("studio.workshop.dropLine1Suffix")}<span className="text-emerald-400 font-semibold font-mono">{t("studio.workshop.prototypeScreenshot")}</span>{t("studio.workshop.dropLine1End")}
          <br />
          {t("studio.workshop.dropLine2")}
        </p>
        <div className="mt-3.5 flex gap-2.5">
          <span className="text-[10px] bg-white/[0.02] group-hover:bg-white/[0.04] border border-white/[0.04] px-2.5 py-1 rounded-md text-zinc-500 group-hover:text-zinc-400 font-mono">SUPPORTED: .TSX, .VUE, .PY, .HTML, .JS, ALL LANGUAGES</span>
          <span className="text-[10px] bg-white/[0.02] group-hover:bg-white/[0.04] border border-white/[0.04] px-2.5 py-1 rounded-md text-zinc-400 group-hover:text-emerald-400 font-semibold font-mono">IMAGE / SCREENSHOT</span>
        </div>
      </div>

      {customApps.length === 0 ? (
        <div className="flex flex-col items-center justify-center p-16 mt-4 bg-[#0b0b0d] rounded-[32px] border border-dashed border-white/[0.08] text-center max-w-2xl mx-auto">
          <div className="w-20 h-20 rounded-full bg-white/[0.03] flex items-center justify-center mb-6 border border-white/[0.05]">
            <Terminal className="w-10 h-10 text-zinc-500" />
          </div>
          <h2 className="font-bold text-zinc-200 text-xl mb-3">{t("studio.workshop.emptyTitle")}</h2>
          <p className="text-zinc-500 font-medium text-xs mb-8 max-w-md leading-relaxed">
            {t("studio.workshop.emptyBody")}
          </p>
          <button onClick={onClose} className="bg-indigo-600 hover:bg-indigo-500 text-white font-bold text-xs py-3.5 px-8 rounded-full shadow-lg transition-transform active:scale-95">
            {t("studio.workshop.backToChat")}
          </button>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {customApps.map((app) => (
            <div key={app.id} className="bg-[#0b0b0d] p-6 rounded-[24px] border border-white/[0.05] hover:border-indigo-500/40 hover:bg-[#0e0e11] transition-all duration-300 group shadow-lg flex flex-col h-[260px] text-left justify-between">
              <div className="flex flex-col flex-grow">
                <div className="flex justify-between items-start mb-4">
                  <h3 className="text-[15px] font-bold text-zinc-100 flex items-center gap-2.5 truncate">
                    <span className="w-2 h-2 rounded-full bg-indigo-500" />
                    {app.name}
                    {app.status === "building" && (
                      <span className="text-[9px] font-semibold tracking-wide bg-amber-500/10 text-amber-500 px-2 py-0.5 rounded-full border border-amber-500/20 flex items-center shrink-0">
                        <Sparkles className="w-2.5 h-2.5 mr-1 animate-spin" /> {t("studio.workshop.building")}
                      </span>
                    )}
                  </h3>
                  {app.status === "active" && (
                    <div className="flex gap-1.5 opacity-0 group-hover:opacity-100 transition-opacity">
                      {onOpenApp && (
                        <button onClick={() => onOpenApp(app.id)} className="p-2 bg-indigo-500/10 hover:bg-indigo-500/20 text-indigo-400 rounded-lg transition-colors border border-indigo-500/25" title={t("studio.workshop.runTitle")}>
                          <Play className="w-3.5 h-3.5" />
                        </button>
                      )}
                      {onDeleteApp && (
                        <button onClick={() => onDeleteApp(app.id)} className="p-2 bg-red-500/10 hover:bg-red-500/20 text-red-400 rounded-lg transition-colors border border-red-500/15" title={t("studio.workshop.deleteTitle")}>
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      )}
                    </div>
                  )}
                </div>

                <p className="text-[13px] text-zinc-400 leading-relaxed font-semibold mb-auto line-clamp-3">
                  {app.description}
                </p>
              </div>

              {app.status === "active" && (
                <div className="mt-4 pt-4 border-t border-white/[0.05] flex justify-between items-center shrink-0">
                  <div className="flex items-center gap-2">
                    <span className={app.visibility === "public" ? "flex items-center gap-1.5 px-2.5 py-1 rounded-md text-[10px] font-bold tracking-wider uppercase bg-indigo-500/10 text-indigo-400" : "flex items-center gap-1.5 px-2.5 py-1 rounded-md text-[10px] font-bold tracking-wider uppercase bg-white/[0.03] text-zinc-500 border border-white/[0.05]"}>
                      {app.visibility === "public" ? <Globe className="w-3 h-3" /> : <Lock className="w-3 h-3" />}
                      {app.visibility === "public" ? "Public" : "Private"}
                    </span>
                    <span className="text-[10px] text-zinc-500 font-mono bg-[#111115] px-2 py-0.5 rounded border border-white/[0.05]">
                      {t("studio.workshop.sandboxReady")}
                    </span>
                  </div>
                  <button
                    onClick={() => onEditApp(app)}
                    className="text-xs font-bold text-white bg-indigo-500/10 hover:bg-indigo-500 text-indigo-400 hover:text-white border border-indigo-500/30 px-3.5 py-2 rounded-xl transition-all flex items-center gap-1.5 active:scale-95 shadow-inner"
                  >
                    <Sparkles className="w-3.5 h-3.5 text-indigo-400" /> {t("studio.workshop.aiRewrite")}
                  </button>
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </motion.div>
  );
}
