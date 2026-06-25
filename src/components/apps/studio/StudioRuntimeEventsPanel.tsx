import { AlertCircle, Bug, RefreshCw, WandSparkles } from "lucide-react";
import { useI18n } from "../../../i18n/I18nProvider";
import type { StoredCustomAppRuntimeEvent } from "../../../services/lifeosApi";

type StudioRuntimeEventsPanelProps = {
  events: StoredCustomAppRuntimeEvent[];
  isLoading: boolean;
  error: string | null;
  issue: string;
  isRequestingDebug: boolean;
  onIssueChange: (value: string) => void;
  onRefresh: () => void;
  onRequestDebug: () => void;
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

export default function StudioRuntimeEventsPanel({
  events,
  isLoading,
  error,
  issue,
  isRequestingDebug,
  onIssueChange,
  onRefresh,
  onRequestDebug,
}: StudioRuntimeEventsPanelProps) {
  const { t } = useI18n();

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

      <div className="space-y-2 pt-2 border-t border-white/[0.04]">
        <textarea
          value={issue}
          onChange={(event) => onIssueChange(event.target.value)}
          rows={2}
          placeholder={t("studio.runtime.issuePlaceholder")}
          className="w-full bg-[#141416] border border-white/[0.06] focus:border-amber-500/50 rounded-xl px-3 py-2 text-[11px] text-zinc-200 outline-none placeholder-zinc-600 resize-none"
        />
        <button
          type="button"
          onClick={onRequestDebug}
          disabled={isRequestingDebug}
          className="w-full bg-amber-500/10 hover:bg-amber-500/15 border border-amber-500/20 text-amber-300 disabled:text-zinc-600 disabled:border-white/[0.04] disabled:bg-white/[0.02] py-2 rounded-xl text-[11px] font-bold transition-all flex items-center justify-center gap-1.5"
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
      </div>
    </div>
  );
}
