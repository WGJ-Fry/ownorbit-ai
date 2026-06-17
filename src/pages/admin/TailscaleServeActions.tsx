import { Play, Square } from "lucide-react";
import type { NetworkDiagnostics } from "../../services/lifeosApi";
import { useI18n } from "../../i18n/I18nProvider";

export default function TailscaleServeActions({
  tailscale,
  serveBusy,
  onStart,
  onStop,
}: {
  tailscale: NetworkDiagnostics["tailscale"];
  serveBusy: "start" | "stop" | null;
  onStart: () => void;
  onStop: () => void;
}) {
  const { t } = useI18n();
  const canStart = tailscale.installed && tailscale.online && tailscale.magicDnsEnabled && tailscale.httpsServeReady;
  const unavailableMessage = !tailscale.installed
    ? t("connection.tailscaleInstallRequired")
    : !tailscale.online
      ? t("connection.tailscaleLoginRequired", { command: tailscale.loginCommand || "tailscale up" })
      : !tailscale.magicDnsEnabled
        ? t("connection.tailscaleMagicDnsRequired")
        : t("connection.tailscaleServeUnavailable");

  return (
    <div className="mt-3 grid gap-2">
      <button
        onClick={onStart}
        disabled={!canStart || serveBusy === "start"}
        className="inline-flex items-center justify-center gap-2 rounded-xl border border-emerald-400/20 bg-emerald-500/10 px-3 py-2 text-xs font-bold text-emerald-100 disabled:opacity-50"
      >
        <Play className="h-3.5 w-3.5" />
        {serveBusy === "start" ? t("connection.tailscaleServeStarting") : t("connection.tailscaleServeStart")}
      </button>
      {tailscale.serveRunning ? (
        <button
          onClick={onStop}
          disabled={serveBusy === "stop"}
          className="inline-flex items-center justify-center gap-2 rounded-xl border border-red-400/20 bg-red-500/10 px-3 py-2 text-xs font-bold text-red-100 disabled:opacity-50"
        >
          <Square className="h-3.5 w-3.5" />
          {serveBusy === "stop" ? t("connection.tailscaleServeStopping") : t("connection.tailscaleServeStop")}
        </button>
      ) : null}
      {tailscale.serveRunning && tailscale.httpsServeUrl ? (
        <div className="rounded-xl border border-emerald-400/15 bg-emerald-500/10 p-2 text-[11px] leading-relaxed text-emerald-100">
          {t("connection.tailscaleServeUrl", { url: tailscale.httpsServeUrl })}
        </div>
      ) : !canStart ? (
        <div className="rounded-xl border border-amber-400/15 bg-amber-500/10 p-2 text-[11px] leading-relaxed text-amber-100">
          {unavailableMessage}
        </div>
      ) : null}
    </div>
  );
}
