import { useEffect, useMemo, useState } from "react";
import { ArrowLeft, RefreshCw, Search, Sparkles, Wrench } from "lucide-react";
import LanguageSwitcher from "../../i18n/LanguageSwitcher";
import { useI18n } from "../../i18n/I18nProvider";
import { listCustomApps, type StoredCustomApp } from "../../services/lifeosApi";

export default function MobileToolsPage() {
  const { t } = useI18n();
  const [apps, setApps] = useState<StoredCustomApp[]>([]);
  const [query, setQuery] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const filteredApps = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase();
    const activeApps = apps.filter((app) => app.status === "active");
    if (!normalizedQuery) return activeApps;
    return activeApps.filter((app) => {
      return `${app.name} ${app.description}`.toLowerCase().includes(normalizedQuery);
    });
  }, [apps, query]);

  const loadApps = async (silent = false) => {
    if (!silent) setIsLoading(true);
    setError(null);
    try {
      const data = await listCustomApps(100);
      setApps(data.apps);
    } catch (loadError: any) {
      setError(loadError?.message || t("mobile.toolsLoadFailed"));
    } finally {
      if (!silent) setIsLoading(false);
    }
  };

  useEffect(() => {
    void loadApps();
    const refresh = () => void loadApps(true);
    window.addEventListener("focus", refresh);
    document.addEventListener("visibilitychange", refresh);
    return () => {
      window.removeEventListener("focus", refresh);
      document.removeEventListener("visibilitychange", refresh);
    };
  }, []);

  return (
    <div className="min-h-screen bg-[#060a10] px-4 py-5 text-zinc-100">
      <div className="mx-auto flex w-full max-w-md flex-col gap-4">
        <header className="flex items-center justify-between gap-3">
          <a
            href="/mobile/chat"
            className="inline-flex h-10 w-10 items-center justify-center rounded-2xl border border-white/[0.08] bg-white/[0.03] text-zinc-200"
            aria-label={t("common.back")}
          >
            <ArrowLeft className="h-4 w-4" />
          </a>
          <LanguageSwitcher compact />
        </header>

        <section className="rounded-[28px] border border-white/[0.08] bg-[#101722] p-5">
          <div className="flex items-start gap-3">
            <div className="flex h-12 w-12 flex-shrink-0 items-center justify-center rounded-2xl border border-cyan-400/20 bg-cyan-500/10">
              <Wrench className="h-5 w-5 text-cyan-200" />
            </div>
            <div className="min-w-0">
              <h1 className="text-xl font-bold tracking-tight">{t("mobile.toolsTitle")}</h1>
              <p className="mt-2 text-sm leading-relaxed text-zinc-400">{t("mobile.toolsDescription")}</p>
            </div>
          </div>
          <div className="mt-4 rounded-2xl border border-emerald-400/20 bg-emerald-500/10 p-3 text-xs leading-relaxed text-emerald-100">
            {t("mobile.toolsStateHint")}
          </div>
        </section>

        <section className="rounded-[28px] border border-white/[0.08] bg-[#101722] p-4">
          <div className="flex gap-2">
            <label className="relative min-w-0 flex-1">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-zinc-500" />
              <input
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                className="h-11 w-full rounded-2xl border border-white/[0.08] bg-[#060a10] pl-9 pr-3 text-sm outline-none transition focus:border-cyan-400/60"
                placeholder={t("mobile.toolsSearch")}
              />
            </label>
            <button
              onClick={() => void loadApps()}
              disabled={isLoading}
              className="inline-flex h-11 w-11 flex-shrink-0 items-center justify-center rounded-2xl border border-white/[0.08] bg-white/[0.03] text-zinc-300 disabled:opacity-50"
              aria-label={t("common.refresh")}
            >
              <RefreshCw className={`h-4 w-4 ${isLoading ? "animate-spin" : ""}`} />
            </button>
          </div>

          {error ? (
            <div className="mt-4 rounded-2xl border border-amber-400/20 bg-amber-500/10 p-3 text-sm leading-relaxed text-amber-100">
              {error}
            </div>
          ) : null}

          {!error && filteredApps.length === 0 ? (
            <div className="mt-4 rounded-2xl border border-white/[0.06] bg-white/[0.03] p-5 text-sm leading-relaxed text-zinc-400">
              {isLoading ? t("common.reading") : t("mobile.toolsEmpty")}
            </div>
          ) : null}

          {filteredApps.length > 0 ? (
            <div className="mt-4 space-y-3">
              {filteredApps.map((app) => (
                <article key={app.id} className="rounded-2xl border border-white/[0.06] bg-white/[0.03] p-4">
                  <div className="flex items-start gap-3">
                    <div className="mt-0.5 flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-xl border border-violet-400/20 bg-violet-500/10">
                      <Sparkles className="h-4 w-4 text-violet-200" />
                    </div>
                    <div className="min-w-0 flex-1">
                      <h2 className="truncate text-sm font-bold text-zinc-100">{app.name}</h2>
                      <p className="mt-1 line-clamp-3 text-xs leading-relaxed text-zinc-400">{app.description}</p>
                      <div className="mt-3 text-[11px] font-medium text-zinc-500">
                        {t("mobile.toolsEdited", { time: new Date(app.updatedAt || app.createdAt).toLocaleString() })}
                      </div>
                      <a
                        href={`/mobile/chat?openApp=${encodeURIComponent(app.id)}`}
                        className="mt-3 inline-flex w-full items-center justify-center rounded-xl border border-cyan-400/20 bg-cyan-500/10 px-4 py-3 text-sm font-bold text-cyan-100"
                      >
                        {t("mobile.toolsOpen")}
                      </a>
                    </div>
                  </div>
                </article>
              ))}
            </div>
          ) : null}
        </section>
      </div>
    </div>
  );
}
