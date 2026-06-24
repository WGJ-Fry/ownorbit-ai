import { useEffect, useMemo, useState } from "react";
import { RefreshCw, Sparkles, Wrench } from "lucide-react";
import { useI18n } from "../../i18n/I18nProvider";
import { listProblemBlueprints, type StoredProblemBlueprint } from "../../services/lifeosApi";

export default function MobileGeneratedToolsCard() {
  const { t } = useI18n();
  const [blueprints, setBlueprints] = useState<StoredProblemBlueprint[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const generatedTools = useMemo(() => {
    return blueprints
      .filter((blueprint) => blueprint.status === "generated")
      .slice(0, 5);
  }, [blueprints]);

  const loadBlueprints = async (silent = false) => {
    if (!silent) setIsLoading(true);
    setError(null);
    try {
      const data = await listProblemBlueprints(8);
      setBlueprints(data.blueprints);
    } catch (loadError: any) {
      setError(loadError.message || t("mobileDevice.generatedToolsLoadFailed"));
    } finally {
      if (!silent) setIsLoading(false);
    }
  };

  useEffect(() => {
    void loadBlueprints();
    const refresh = () => void loadBlueprints(true);
    window.addEventListener("focus", refresh);
    document.addEventListener("visibilitychange", refresh);
    return () => {
      window.removeEventListener("focus", refresh);
      document.removeEventListener("visibilitychange", refresh);
    };
  }, []);

  return (
    <section className="mt-4 rounded-[28px] border border-white/[0.08] bg-[#101722] p-5">
      <div className="mb-4 flex items-start justify-between gap-3">
        <div className="flex min-w-0 items-start gap-3">
          <div className="flex h-11 w-11 flex-shrink-0 items-center justify-center rounded-2xl border border-violet-400/20 bg-violet-500/10">
            <Wrench className="h-5 w-5 text-violet-200" />
          </div>
          <div className="min-w-0">
            <h2 className="text-base font-bold">{t("mobileDevice.generatedToolsTitle")}</h2>
            <p className="mt-1 text-sm leading-relaxed text-zinc-400">{t("mobileDevice.generatedToolsBody")}</p>
          </div>
        </div>
        <button
          onClick={() => void loadBlueprints()}
          disabled={isLoading}
          className="inline-flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-xl border border-white/[0.08] bg-white/[0.03] text-zinc-300 disabled:opacity-50"
          aria-label={t("common.refresh")}
        >
          <RefreshCw className={`h-4 w-4 ${isLoading ? "animate-spin" : ""}`} />
        </button>
      </div>

      {error ? <div className="rounded-2xl border border-amber-400/20 bg-amber-500/10 p-3 text-xs leading-relaxed text-amber-100">{error}</div> : null}

      {!error && generatedTools.length === 0 ? (
        <div className="rounded-2xl border border-white/[0.06] bg-white/[0.03] p-4 text-sm leading-relaxed text-zinc-400">
          {isLoading ? t("common.reading") : t("mobileDevice.generatedToolsEmpty")}
        </div>
      ) : null}

      {generatedTools.length > 0 ? (
        <div className="space-y-3">
          {generatedTools.map((tool) => (
            <article key={tool.id} className="rounded-2xl border border-white/[0.06] bg-white/[0.03] p-4">
              <div className="flex items-start gap-3">
                <div className="mt-0.5 flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-xl border border-cyan-400/20 bg-cyan-500/10">
                  <Sparkles className="h-4 w-4 text-cyan-200" />
                </div>
                <div className="min-w-0">
                  <div className="truncate text-sm font-bold text-zinc-100">{tool.generatedAppName || tool.suggestedAppName}</div>
                  <p className="mt-1 line-clamp-2 text-xs leading-relaxed text-zinc-400">{tool.summary || tool.problem}</p>
                  <div className="mt-2 text-[11px] font-bold uppercase tracking-[0.18em] text-cyan-200/80">
                    {new Date(tool.updatedAt || tool.createdAt).toLocaleDateString()}
                  </div>
                </div>
              </div>
            </article>
          ))}
          <a href="/mobile/chat" className="inline-flex w-full justify-center rounded-xl border border-cyan-400/20 bg-cyan-500/10 px-4 py-3 text-sm font-bold text-cyan-100">
            {t("mobileDevice.generatedToolsOpenChat")}
          </a>
        </div>
      ) : null}
    </section>
  );
}
