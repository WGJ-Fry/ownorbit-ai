import { AlertTriangle, CheckCircle2, ShieldCheck, WifiOff } from "lucide-react";
import { useI18n } from "../../i18n/I18nProvider";
import type { OfflineQueueHealth } from "../../services/offlineQueueHealth";

const toneClass = {
  ok: "border-emerald-400/20 bg-emerald-500/10 text-emerald-100",
  info: "border-cyan-400/20 bg-cyan-500/10 text-cyan-100",
  warning: "border-amber-400/20 bg-amber-500/10 text-amber-100",
  danger: "border-red-400/20 bg-red-500/10 text-red-100",
};

function HealthIcon({ tone }: { tone: OfflineQueueHealth["tone"] }) {
  if (tone === "ok") return <CheckCircle2 className="h-4 w-4" />;
  if (tone === "info") return <WifiOff className="h-4 w-4" />;
  if (tone === "warning") return <AlertTriangle className="h-4 w-4" />;
  return <ShieldCheck className="h-4 w-4" />;
}

export function MobileOfflineQueueHealthCard({ health }: { health: OfflineQueueHealth }) {
  const { t } = useI18n();
  return (
    <div className={`mt-4 rounded-2xl border p-3 text-xs leading-relaxed ${toneClass[health.tone]}`}>
      <div className="flex items-start gap-2">
        <div className="mt-0.5 shrink-0">
          <HealthIcon tone={health.tone} />
        </div>
        <div>
          <div className="font-bold">{t(health.titleKey as any)}</div>
          <div className="mt-1 opacity-85">{t(health.bodyKey as any)}</div>
          <div className="mt-2 border-t border-current/15 pt-2 font-bold opacity-90">{t(health.actionKey as any)}</div>
        </div>
      </div>
    </div>
  );
}
