import { AlertTriangle, CheckCircle2, Link2, MessageCircle, RefreshCw, Wifi } from "lucide-react";
import type { DeviceConnectivityReport } from "../../services/lifeosApi";
import type { OfflineMessageQueueSummary } from "../../services/offlineMessageQueue";
import type { MobileConnectivityIssueKey, RemoteEntryStatus } from "../../services/pwaCapabilities";
import { useI18n } from "../../i18n/I18nProvider";

type RecoveryState = "ready" | "needs-repair" | "untested" | "stale" | "queue";

function getRecoveryState({
  currentEntry,
  lastConnectivityIssue,
  lastConnectivityReport,
  queueSummary,
  stale,
}: {
  currentEntry: RemoteEntryStatus;
  lastConnectivityIssue: MobileConnectivityIssueKey | null;
  lastConnectivityReport: DeviceConnectivityReport | null;
  queueSummary: OfflineMessageQueueSummary;
  stale: boolean;
}): RecoveryState {
  const queueWaiting = queueSummary.failed > 0 || queueSummary.pending > 0 || queueSummary.syncing > 0;
  if (!currentEntry.okForRemote || lastConnectivityIssue && lastConnectivityIssue !== "mobileDevice.connectivityIssueOk") return "needs-repair";
  if (!lastConnectivityReport) return "untested";
  if (stale) return "stale";
  if (queueWaiting) return "queue";
  return "ready";
}

export default function MobileConnectionRecoveryCard({
  connectivityBusy,
  currentEntry,
  lastConnectivityIssue,
  lastConnectivityReport,
  queueSummary,
  serverRefreshBusy,
  stale,
  onConnectivityTest,
  onFocusPairing,
  onRefreshServer,
}: {
  connectivityBusy: boolean;
  currentEntry: RemoteEntryStatus;
  lastConnectivityIssue: MobileConnectivityIssueKey | null;
  lastConnectivityReport: DeviceConnectivityReport | null;
  queueSummary: OfflineMessageQueueSummary;
  serverRefreshBusy: boolean;
  stale: boolean;
  onConnectivityTest: () => void;
  onFocusPairing: () => void;
  onRefreshServer: () => void;
}) {
  const { t } = useI18n();
  const state = getRecoveryState({ currentEntry, lastConnectivityIssue, lastConnectivityReport, queueSummary, stale });
  const healthy = state === "ready";
  const Icon = healthy ? CheckCircle2 : state === "needs-repair" ? AlertTriangle : Wifi;
  const primaryGoesToChat = healthy || state === "queue";
  const tone = healthy
    ? "border-emerald-400/20 bg-emerald-500/10 text-emerald-100"
    : state === "needs-repair"
      ? "border-red-400/20 bg-red-500/10 text-red-100"
      : "border-amber-400/20 bg-amber-500/10 text-amber-100";
  const bodyKey = `mobileDevice.recoveryPanel.${state}.body`;
  const chatLabel = state === "queue" ? t("mobileDevice.openChatSync") : t("mobileDevice.recoveryPanel.chatAction");
  const testButton = (variant: "primary" | "secondary") => (
    <button
      onClick={onConnectivityTest}
      disabled={connectivityBusy}
      className={[
        "inline-flex items-center justify-center gap-2 rounded-xl border px-4 py-3 text-sm font-bold disabled:opacity-50",
        variant === "primary"
          ? "border-cyan-300/20 bg-cyan-400/15 text-cyan-50"
          : "border-white/[0.12] bg-black/10 text-zinc-50",
      ].join(" ")}
    >
      <RefreshCw className={`h-4 w-4 ${connectivityBusy ? "animate-spin" : ""}`} />
      {connectivityBusy ? t("mobileDevice.connectivityTesting") : t(variant === "primary" ? "mobileDevice.recoveryPanel.testAction" : "mobileDevice.connectivityTest")}
    </button>
  );
  const chatButton = (variant: "primary" | "secondary") => (
    <a
      href="/mobile/chat"
      className={[
        "inline-flex items-center justify-center gap-2 rounded-xl border px-4 py-3 text-sm font-bold text-emerald-50",
        variant === "primary" ? "border-emerald-300/20 bg-emerald-400/15" : "border-emerald-300/20 bg-black/10",
      ].join(" ")}
    >
      <MessageCircle className="h-4 w-4" />
      {chatLabel}
    </a>
  );

  return (
    <section className={`mb-4 rounded-[28px] border p-5 ${tone}`}>
      <div className="flex items-start gap-3">
        <div className="flex h-11 w-11 flex-shrink-0 items-center justify-center rounded-2xl border border-current/20 bg-black/10">
          <Icon className="h-5 w-5" />
        </div>
        <div className="min-w-0 flex-1">
          <h2 className="text-base font-bold">{t("mobileDevice.recoveryPanelTitle")}</h2>
          <p className="mt-1 text-sm leading-relaxed opacity-80">{t(bodyKey as any)}</p>
          {lastConnectivityIssue && lastConnectivityIssue !== "mobileDevice.connectivityIssueOk" ? (
            <div className="mt-3 rounded-2xl border border-white/[0.08] bg-black/10 p-3 text-xs font-bold leading-relaxed">
              {t(lastConnectivityIssue as any)}
            </div>
          ) : null}
        </div>
      </div>

      <div className="mt-4 grid gap-2 text-xs">
        <div className="rounded-2xl border border-white/[0.08] bg-black/10 p-3">
          <div className="font-bold">{t("mobileDevice.recoveryPanel.stepTest")}</div>
          <div className="mt-1 opacity-75">{t("mobileDevice.recoveryPanel.stepTestBody")}</div>
        </div>
        <div className="rounded-2xl border border-white/[0.08] bg-black/10 p-3">
          <div className="font-bold">{t("mobileDevice.recoveryPanel.stepRefresh")}</div>
          <div className="mt-1 opacity-75">{t("mobileDevice.recoveryPanel.stepRefreshBody")}</div>
        </div>
        <div className="rounded-2xl border border-white/[0.08] bg-black/10 p-3">
          <div className="font-bold">{t("mobileDevice.recoveryPanel.stepRebind")}</div>
          <div className="mt-1 opacity-75">{t("mobileDevice.recoveryPanel.stepRebindBody")}</div>
        </div>
      </div>

      <div className="mt-4 grid gap-2">
        {primaryGoesToChat ? chatButton("primary") : testButton("primary")}
        <button
          onClick={onRefreshServer}
          disabled={serverRefreshBusy}
          className="inline-flex items-center justify-center gap-2 rounded-xl border border-white/[0.12] bg-black/10 px-4 py-3 text-sm font-bold text-zinc-50 disabled:opacity-50"
        >
          <RefreshCw className={`h-4 w-4 ${serverRefreshBusy ? "animate-spin" : ""}`} />
          {serverRefreshBusy ? t("mobileDevice.refreshingServerState") : t("mobileDevice.recoveryPanel.refreshAction")}
        </button>
        <div className="grid gap-2 sm:grid-cols-2">
          <button
            onClick={onFocusPairing}
            className="inline-flex items-center justify-center gap-2 rounded-xl border border-amber-300/20 bg-amber-400/15 px-4 py-3 text-sm font-bold text-amber-50"
          >
            <Link2 className="h-4 w-4" />
            {t("mobileDevice.recoveryPanel.rebindAction")}
          </button>
          {primaryGoesToChat ? testButton("secondary") : chatButton("secondary")}
        </div>
      </div>
    </section>
  );
}
