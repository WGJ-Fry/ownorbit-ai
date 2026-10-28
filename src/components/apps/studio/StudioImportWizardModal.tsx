import { Sparkles } from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import { useI18n } from "../../../i18n/I18nProvider";

type StudioImportWizardModalProps = {
  isOpen: boolean;
  isGenerating: boolean;
  appName: string;
  promptInput: string;
  error: string | null;
  onClose: () => void;
  onAppNameChange: (value: string) => void;
  onPromptInputChange: (value: string) => void;
  onGenerate: () => void;
};

export default function StudioImportWizardModal({
  isOpen,
  isGenerating,
  appName,
  promptInput,
  error,
  onClose,
  onAppNameChange,
  onPromptInputChange,
  onGenerate,
}: StudioImportWizardModalProps) {
  const { t } = useI18n();
  const suggestions = [
    { label: t("studio.import.suggestionTodoLabel"), name: t("studio.import.suggestionTodoName"), prompt: t("studio.import.suggestionTodoPrompt") },
    { label: t("studio.import.suggestionPomodoroLabel"), name: t("studio.import.suggestionPomodoroName"), prompt: t("studio.import.suggestionPomodoroPrompt") },
    { label: t("studio.import.suggestionLedgerLabel"), name: t("studio.import.suggestionLedgerName"), prompt: t("studio.import.suggestionLedgerPrompt") },
    { label: t("studio.import.suggestionConverterLabel"), name: t("studio.import.suggestionConverterName"), prompt: t("studio.import.suggestionConverterPrompt") },
  ];

  return (
    <AnimatePresence>
      {isOpen && (
        <div className="fixed inset-0 bg-black/80 backdrop-blur-md z-[100] flex items-center justify-center p-4">
          <motion.div
            initial={{ opacity: 0, scale: 0.95, y: 15 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.95, y: 15 }}
            className="bg-[#0b0b0d] border border-white/[0.1] rounded-[32px] w-full max-w-4xl h-[70vh] max-h-[620px] shadow-2xl overflow-hidden flex flex-col"
          >
            <div className="px-6 py-4.5 border-b border-white/[0.04] bg-black/20 flex items-center justify-between text-left">
              <div className="flex items-center gap-2.5">
                <div className="w-8 h-8 rounded-lg bg-indigo-500/10 border border-indigo-500/20 flex items-center justify-center text-indigo-400">
                  <Sparkles className="w-4 h-4" />
                </div>
                <div>
                  <h3 className="font-semibold text-white text-sm tracking-tight">{t("studio.import.title")}</h3>
                  <p className="text-[10px] text-zinc-500 mt-0.5">{t("studio.import.subtitle")}</p>
                </div>
              </div>
              <button
                onClick={() => {
                  if (!isGenerating) onClose();
                }}
                disabled={isGenerating}
                className="w-8 h-8 rounded-full hover:bg-white/[0.05] text-zinc-500 hover:text-zinc-200 transition-colors flex items-center justify-center text-xs disabled:opacity-30 disabled:cursor-not-allowed"
              >
                x
              </button>
            </div>

            <div className="flex-1 overflow-hidden flex text-left relative">
              {isGenerating ? (
                <div className="absolute inset-0 bg-[#08080a]/98 z-[60] flex flex-col items-center justify-center py-12 text-center space-y-6">
                  <div className="relative">
                    <div className="w-16 h-16 rounded-full bg-indigo-500/10 border border-indigo-500/20 flex items-center justify-center animate-spin" style={{ animationDuration: "6s" }}>
                      <Sparkles className="w-8 h-8 text-indigo-400" />
                    </div>
                  </div>
                  <div className="space-y-2 max-w-sm px-6">
                    <h3 className="text-sm font-semibold text-white tracking-tight flex items-center justify-center gap-1.5 animate-pulse">
                      {t("studio.import.generatingTitle")}
                    </h3>
                    <p className="text-zinc-500 text-xs leading-normal">
                      {t("studio.import.generatingBody")}
                    </p>
                  </div>
                  <div className="w-48 bg-zinc-900/80 h-1 rounded-full overflow-hidden border border-zinc-800/30">
                    <div className="h-full bg-indigo-500 rounded-full animate-pulse shadow-[0_0_10px_rgba(99,102,241,0.5)]" style={{ width: "85%" }} />
                  </div>
                  <span className="text-[9px] text-zinc-600 font-mono tracking-wider">AI Code Generation Engine Active</span>
                </div>
              ) : null}

              <div className="w-1/3 p-6 bg-[#070709] border-r border-white/[0.04] flex flex-col justify-between select-none">
                <div className="space-y-4">
                  <div className="flex items-center gap-2.5">
                    <div className="w-8 h-8 rounded-lg bg-indigo-500/10 flex items-center justify-center text-indigo-400 text-xs font-bold border border-indigo-500/15">
                      OwnOrbit
                    </div>
                    <div>
                      <h4 className="text-xs font-bold text-zinc-300">{t("studio.import.guideTitle")}</h4>
                      <span className="text-[8px] text-zinc-600 font-mono tracking-wider uppercase">CORE ENGINE</span>
                    </div>
                  </div>

                  <div className="bg-[#111115]/40 border border-white/[0.03] p-3.5 rounded-xl text-xs text-zinc-400 leading-relaxed font-sans space-y-2">
                    <p>{t("studio.import.noCode")}</p>
                    <p>{t("studio.import.noCodeBody")}</p>
                  </div>
                </div>

                <div className="text-[9px] text-zinc-600 font-medium border-t border-white/[0.03] pt-3 flex items-center gap-1.5">
                  <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
                  <span>{t("studio.import.sandboxVerified")}</span>
                </div>
              </div>

              <div className="flex-1 p-6 flex flex-col justify-between bg-black/10 overflow-y-auto">
                <div className="space-y-4">
                  {error ? (
                    <div className="rounded-xl border border-red-500/15 bg-red-500/5 px-3.5 py-3 text-xs font-semibold leading-relaxed text-red-300">
                      {error}
                    </div>
                  ) : null}

                  <div className="space-y-1.5 text-left">
                    <label className="block text-xs font-semibold text-zinc-400 pl-0.5">
                      {t("studio.import.appName")} <span className="text-zinc-600 font-normal text-[10px] ml-1">{t("studio.import.optional")}</span>
                    </label>
                    <input
                      type="text"
                      value={appName}
                      onChange={(event) => onAppNameChange(event.target.value)}
                      placeholder={t("studio.import.appNamePlaceholder")}
                      className="w-full bg-[#050505] border border-white/[0.06] rounded-xl px-3.5 py-2.5 text-xs text-zinc-200 outline-none focus:border-indigo-500/40 transition-colors placeholder:text-zinc-600"
                    />
                  </div>

                  <div className="space-y-1.5 text-left">
                    <label className="block text-xs font-semibold text-zinc-400 pl-0.5">{t("studio.import.description")}</label>
                    <textarea
                      value={promptInput}
                      onChange={(event) => onPromptInputChange(event.target.value)}
                      placeholder={t("studio.import.descriptionPlaceholder")}
                      className="w-full bg-[#050505] border border-white/[0.06] rounded-xl px-3.5 py-2.5 text-xs text-zinc-200 outline-none focus:border-indigo-500/40 focus:ring-1 focus:ring-indigo-500/10 transition-all h-24 resize-none placeholder:text-zinc-600 leading-relaxed"
                    />
                  </div>

                  <div className="space-y-1.5 text-left">
                    <span className="block text-[10px] font-bold text-zinc-500 uppercase tracking-wider pl-0.5">{t("studio.import.quickIdeas")}</span>
                    <div className="flex flex-wrap gap-1.5">
                      {suggestions.map((suggestion) => (
                        <button
                          key={suggestion.name}
                          type="button"
                          onClick={() => {
                            onAppNameChange(suggestion.name);
                            onPromptInputChange(suggestion.prompt);
                          }}
                          className="text-[10px] px-2.5 py-1.5 rounded-lg bg-white/[0.02] hover:bg-indigo-500/5 border border-white/[0.04] hover:border-indigo-500/20 text-zinc-400 hover:text-indigo-300 transition-all active:scale-95 text-left"
                        >
                          {suggestion.label}
                        </button>
                      ))}
                    </div>
                  </div>
                </div>

                <div className="flex justify-end gap-2.5 pt-3.5 border-t border-white/[0.03] mt-3">
                  <button
                    type="button"
                    onClick={onClose}
                    className="px-4 py-2 rounded-lg text-xs font-bold text-zinc-500 hover:text-zinc-300 transition-colors"
                  >
                    {t("studio.import.cancel")}
                  </button>
                  <button
                    type="button"
                    onClick={onGenerate}
                    disabled={!promptInput.trim() || isGenerating}
                    className="bg-indigo-600 hover:bg-indigo-500 disabled:bg-zinc-800 disabled:opacity-40 disabled:cursor-not-allowed text-white px-5 py-2.5 rounded-lg text-xs font-semibold tracking-wide transition-all shadow-[0_0_15px_rgba(99,102,241,0.2)] active:scale-95 flex items-center gap-1.5"
                  >
                    <Sparkles className="w-3.5 h-3.5 text-indigo-200" />
                    <span>{t("studio.import.generate")}</span>
                  </button>
                </div>
              </div>
            </div>
          </motion.div>
        </div>
      )}
    </AnimatePresence>
  );
}
