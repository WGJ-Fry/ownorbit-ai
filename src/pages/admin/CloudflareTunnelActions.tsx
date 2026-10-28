import { Square, WandSparkles } from "lucide-react";
import type { NetworkDiagnostics } from "../../services/lifeosApi";
import { useI18n } from "../../i18n/I18nProvider";

export default function CloudflareTunnelActions({
  cloudflare,
  tunnelBusy,
  onStart,
  onStop,
}: {
  cloudflare: NetworkDiagnostics["cloudflare"];
  tunnelBusy: "start" | "stop" | null;
  onStart: () => void;
  onStop: () => void;
}) {
  const { t } = useI18n();
  const canStart = cloudflare.installed;
  const managed = cloudflare.managed;
  // The server keeps the last URL after cloudflared exits, so a URL alone does
  // not mean the tunnel is up: only claim "running" while it is ready.
  const quickTunnelUp = Boolean(managed.url) && managed.kind !== "named" && managed.running && managed.ready;
  const namedTunnelUp = Boolean(managed.url) && managed.kind === "named" && managed.running;
  // A quick tunnel's address dies with its process and nothing restarts it.
  const quickTunnelStopped = Boolean(managed.url) && managed.kind !== "named" && !managed.running;

  return (
    <div className="mt-3 grid gap-2">
      <button
        onClick={onStart}
        disabled={!canStart || tunnelBusy === "start"}
        className="inline-flex items-center justify-center gap-2 rounded-xl border border-emerald-400/20 bg-emerald-500/10 px-3 py-2 text-xs font-bold text-emerald-100 disabled:opacity-50"
      >
        <WandSparkles className="h-3.5 w-3.5" />
        {tunnelBusy === "start" ? t("connection.cloudflareStarting") : t("connection.cloudflareStart")}
      </button>
      {managed.running ? (
        <button
          onClick={onStop}
          disabled={tunnelBusy === "stop"}
          className="inline-flex items-center justify-center gap-2 rounded-xl border border-red-400/20 bg-red-500/10 px-3 py-2 text-xs font-bold text-red-100 disabled:opacity-50"
        >
          <Square className="h-3.5 w-3.5" />
          {tunnelBusy === "stop" ? t("connection.cloudflareStopping") : t("connection.cloudflareStop")}
        </button>
      ) : null}
      {quickTunnelUp || namedTunnelUp ? (
        <div className="space-y-1 rounded-xl border border-emerald-400/15 bg-emerald-500/10 p-2 text-[11px] leading-relaxed text-emerald-100">
          <div>
            {namedTunnelUp
              ? t("connection.cloudflareNamedManagedUrl", { url: managed.url })
              : t("connection.cloudflareManagedUrl", { url: managed.url })}
          </div>
          {namedTunnelUp ? (
            <div className="text-emerald-100/80">
              {managed.reconnectAttempts > 0
                ? t("connection.cloudflareReconnectRestored", { count: managed.reconnectAttempts })
                : t("connection.cloudflareReconnectReady")}
            </div>
          ) : null}
        </div>
      ) : quickTunnelStopped ? (
        <div data-testid="cloudflare-quick-tunnel-stopped" className="space-y-1 rounded-xl border border-amber-400/15 bg-amber-500/10 p-2 text-[11px] leading-relaxed text-amber-100">
          <div>{t("connection.cloudflareManagedStopped", { url: managed.url })}</div>
          {managed.lastError ? <div className="text-amber-100/75">{managed.lastError}</div> : null}
        </div>
      ) : managed.lastError ? (
        <div className="rounded-xl border border-amber-400/15 bg-amber-500/10 p-2 text-[11px] leading-relaxed text-amber-100">
          {managed.lastError}
          {managed.reconnectScheduledAt ? (
            <div className="mt-1">
              {t("connection.cloudflareReconnectScheduled", { time: new Date(managed.reconnectScheduledAt).toLocaleTimeString() })}
            </div>
          ) : null}
        </div>
      ) : !canStart ? (
        <div className="rounded-xl border border-amber-400/15 bg-amber-500/10 p-2 text-[11px] leading-relaxed text-amber-100">
          <div>{t("connection.cloudflareInstallRequired")}</div>
          <div className="mt-1 font-mono text-amber-50/90">{cloudflare.installCommand}</div>
        </div>
      ) : null}
    </div>
  );
}
