import { useState } from "react";
import { AlertTriangle, ArrowRight, CheckCircle2, Cloud, ExternalLink, Loader2, QrCode, RefreshCw, ShieldCheck, Smartphone, Wifi } from "lucide-react";
import { analyzeIcloudHandoffRepairPacket } from "../../services/lifeosApi";
import type { IcloudHandoffRepairAnalysis, NetworkDiagnostics } from "../../services/lifeosApi";
import { useI18n } from "../../i18n/I18nProvider";
import type { TranslationKey } from "../../i18n/translations";

type ConnectionCandidate = NetworkDiagnostics["connectionCandidates"][number];

type Props = {
  diagnostics: NetworkDiagnostics | null;
  busy: string | null;
  onExportIcloud: () => void;
  onStartTailscale: () => void;
  onStartCloudflare: () => void;
  onSaveCandidate: (candidate: ConnectionCandidate) => void;
  onTestCandidate: (candidate: ConnectionCandidate) => void;
};

const readinessStatusKeys: Record<NetworkDiagnostics["remoteReadiness"]["status"], TranslationKey> = {
  ready: "connection.readiness.status.ready",
  "needs-restart": "connection.readiness.status.needsRestart",
  temporary: "connection.readiness.status.temporary",
  "local-only": "connection.readiness.status.localOnly",
  "lan-only": "connection.readiness.status.lanOnly",
  blocked: "connection.readiness.status.blocked",
};

const handoffHealthStatusKeys: Record<NetworkDiagnostics["icloud"]["handoffHealth"]["status"], TranslationKey> = {
  missing: "onboarding.appleRemoteIcloudHealthMissing",
  fresh: "onboarding.appleRemoteIcloudHealthFresh",
  stale: "onboarding.appleRemoteIcloudHealthStale",
  "address-changed": "onboarding.appleRemoteIcloudHealthAddressChanged",
  expired: "onboarding.appleRemoteIcloudHealthExpired",
  invalid: "onboarding.appleRemoteIcloudHealthInvalid",
  legacy: "onboarding.appleRemoteIcloudHealthLegacy",
  "html-mismatch": "onboarding.appleRemoteIcloudHealthHtmlMismatch",
};

const handoffHealthReasonKeys: Record<NetworkDiagnostics["icloud"]["handoffHealth"]["status"], TranslationKey> = {
  missing: "onboarding.appleRemoteIcloudReasonMissing",
  fresh: "onboarding.appleRemoteIcloudReasonFresh",
  stale: "onboarding.appleRemoteIcloudReasonStale",
  "address-changed": "onboarding.appleRemoteIcloudReasonAddressChanged",
  expired: "onboarding.appleRemoteIcloudReasonExpired",
  invalid: "onboarding.appleRemoteIcloudReasonInvalid",
  legacy: "onboarding.appleRemoteIcloudReasonLegacy",
  "html-mismatch": "onboarding.appleRemoteIcloudReasonHtmlMismatch",
};

const icloudAvailabilityKeys: Record<NetworkDiagnostics["icloud"]["availability"]["status"], TranslationKey> = {
  unsupported: "onboarding.appleRemoteIcloudAvailabilityUnsupported",
  missing: "onboarding.appleRemoteIcloudAvailabilityMissing",
  "read-only": "onboarding.appleRemoteIcloudAvailabilityReadOnly",
  "sync-pending": "onboarding.appleRemoteIcloudAvailabilitySyncPending",
  ready: "onboarding.appleRemoteIcloudAvailabilityReady",
};

const icloudSyncReadinessKeys: Record<NetworkDiagnostics["icloud"]["syncReadiness"]["status"], TranslationKey> = {
  unsupported: "onboarding.appleRemoteIcloudSyncUnsupported",
  "missing-drive": "onboarding.appleRemoteIcloudSyncMissingDrive",
  "read-only": "onboarding.appleRemoteIcloudSyncReadOnly",
  "no-entry": "onboarding.appleRemoteIcloudSyncNoEntry",
  "needs-refresh": "onboarding.appleRemoteIcloudSyncNeedsRefresh",
  syncing: "onboarding.appleRemoteIcloudSyncSyncing",
  ready: "onboarding.appleRemoteIcloudSyncReady",
};

const icloudSyncActionKeys: Record<NetworkDiagnostics["icloud"]["syncReadiness"]["action"], TranslationKey> = {
  "use-apple-device": "onboarding.appleRemoteIcloudSyncActionApple",
  "enable-icloud-drive": "onboarding.appleRemoteIcloudSyncActionEnable",
  "fix-permissions": "onboarding.appleRemoteIcloudSyncActionPermissions",
  "export-entry": "onboarding.appleRemoteIcloudSyncActionExport",
  "refresh-entry": "onboarding.appleRemoteIcloudSyncActionRefresh",
  "wait-for-sync": "onboarding.appleRemoteIcloudSyncActionWait",
  "open-files-app": "onboarding.appleRemoteIcloudSyncActionOpen",
};

const repairReasonKeys: Record<IcloudHandoffRepairAnalysis["reason"], TranslationKey> = {
  ready: "onboarding.appleRemoteIcloudRepairReasonReady",
  "invalid-packet": "onboarding.appleRemoteIcloudRepairReasonInvalid",
  "phone-entry-expired": "onboarding.appleRemoteIcloudRepairReasonExpired",
  "phone-entry-stale": "onboarding.appleRemoteIcloudRepairReasonStale",
  "phone-entry-legacy": "onboarding.appleRemoteIcloudRepairReasonLegacy",
  "phone-entry-mismatch": "onboarding.appleRemoteIcloudRepairReasonMismatch",
  "desktop-entry-changed": "onboarding.appleRemoteIcloudRepairReasonChanged",
  "phone-connectivity-failed": "onboarding.appleRemoteIcloudRepairReasonConnectivity",
  "desktop-local-or-lan": "onboarding.appleRemoteIcloudRepairReasonLocal",
  "temporary-entry": "onboarding.appleRemoteIcloudRepairReasonTemporary",
};

const repairRecommendationKeys: Record<IcloudHandoffRepairAnalysis["recommendations"][number]["id"], TranslationKey> = {
  "refresh-icloud": "onboarding.appleRemoteIcloudRepairRecRefresh",
  "open-latest-entry": "onboarding.appleRemoteIcloudRepairRecOpenLatest",
  "regenerate-qr": "onboarding.appleRemoteIcloudRepairRecQr",
  "start-tailscale": "onboarding.appleRemoteIcloudRepairRecTailscale",
  "start-cloudflare": "onboarding.appleRemoteIcloudRepairRecCloudflare",
  "save-stable-entry": "onboarding.appleRemoteIcloudRepairRecStable",
  "test-phone-entry": "onboarding.appleRemoteIcloudRepairRecTest",
  ready: "onboarding.appleRemoteIcloudRepairRecReady",
};

const issueEventKindKeys: Record<NonNullable<NetworkDiagnostics["icloud"]["latestEntryIssueEvent"]>["eventType"], TranslationKey> = {
  "ignored-superseded-entry": "onboarding.appleRemoteIcloudIssueKindSuperseded",
  "opened-stale-entry": "onboarding.appleRemoteIcloudIssueKindStale",
  "opened-expired-entry": "onboarding.appleRemoteIcloudIssueKindExpired",
  "opened-legacy-entry": "onboarding.appleRemoteIcloudIssueKindLegacy",
  "opened-address-mismatch-entry": "onboarding.appleRemoteIcloudIssueKindMismatch",
};

const historyChangeTypeKeys: Record<string, TranslationKey> = {
  "first-export": "onboarding.appleRemoteIcloudHistoryFirstExport",
  "address-changed": "onboarding.appleRemoteIcloudHistoryAddressChanged",
  "refreshed-same-address": "onboarding.appleRemoteIcloudHistoryRefreshed",
};

function isAppleRuntime() {
  if (typeof navigator === "undefined") return false;
  const platform = (navigator as Navigator & { userAgentData?: { platform?: string } }).userAgentData?.platform || navigator.platform || "";
  const agent = navigator.userAgent || "";
  return /Mac|iPhone|iPad|iPod/i.test(`${platform} ${agent}`);
}

function getPreferredCandidate(diagnostics: NetworkDiagnostics | null) {
  const candidates = diagnostics?.connectionCandidates || [];
  const readinessId = diagnostics?.remoteReadiness?.candidateId;
  return (
    candidates.find((candidate) => candidate.id === readinessId && candidate.mode !== "local") ||
    candidates.find((candidate) => candidate.mode === "tailscale" && candidate.stability === "stable") ||
    candidates.find((candidate) => candidate.mode !== "local" && candidate.stability === "stable" && candidate.secure) ||
    candidates.find((candidate) => candidate.mode !== "local" && candidate.secure) ||
    candidates.find((candidate) => candidate.mode !== "local") ||
    null
  );
}

function formatHandoffTime(value?: number) {
  if (!value) return "";
  try {
    return new Date(value).toLocaleString();
  } catch {
    return "";
  }
}

function getSimpleIcloudStatus(icloud: NetworkDiagnostics["icloud"] | undefined) {
  const availability = icloud?.availability;
  const health = icloud?.handoffHealth;
  if (!icloud?.canExport || availability?.status === "missing" || availability?.status === "unsupported" || availability?.status === "read-only") {
    return {
      tone: "border-amber-400/20 bg-amber-500/10 text-amber-50",
      icon: "warning" as const,
      titleKey: "onboarding.appleRemoteIcloudSimpleUnavailableTitle" as TranslationKey,
      bodyKey: "onboarding.appleRemoteIcloudSimpleUnavailableBody" as TranslationKey,
    };
  }
  if (availability?.status === "sync-pending") {
    return {
      tone: "border-amber-400/20 bg-amber-500/10 text-amber-50",
      icon: "sync" as const,
      titleKey: "onboarding.appleRemoteIcloudSimpleSyncingTitle" as TranslationKey,
      bodyKey: "onboarding.appleRemoteIcloudSimpleSyncingBody" as TranslationKey,
    };
  }
  if (!health || health.status === "missing") {
    return {
      tone: "border-sky-400/20 bg-sky-500/10 text-sky-50",
      icon: "sync" as const,
      titleKey: "onboarding.appleRemoteIcloudSimpleMissingTitle" as TranslationKey,
      bodyKey: "onboarding.appleRemoteIcloudSimpleMissingBody" as TranslationKey,
    };
  }
  if (health.needsRefresh || health.status !== "fresh") {
    return {
      tone: "border-amber-400/20 bg-amber-500/10 text-amber-50",
      icon: "refresh" as const,
      titleKey: "onboarding.appleRemoteIcloudSimpleRefreshTitle" as TranslationKey,
      bodyKey: "onboarding.appleRemoteIcloudSimpleRefreshBody" as TranslationKey,
    };
  }
  return {
    tone: "border-emerald-400/20 bg-emerald-500/10 text-emerald-50",
    icon: "ready" as const,
    titleKey: "onboarding.appleRemoteIcloudSimpleReadyTitle" as TranslationKey,
    bodyKey: "onboarding.appleRemoteIcloudSimpleReadyBody" as TranslationKey,
  };
}

export default function OnboardingAppleRemoteCard({ diagnostics, busy, onExportIcloud, onStartTailscale, onStartCloudflare, onSaveCandidate, onTestCandidate }: Props) {
  const { t } = useI18n();
  const [repairText, setRepairText] = useState("");
  const [repairBusy, setRepairBusy] = useState(false);
  const [repairError, setRepairError] = useState("");
  const [repairAnalysis, setRepairAnalysis] = useState<IcloudHandoffRepairAnalysis | null>(null);
  const appleRuntime = isAppleRuntime();
  const candidate = getPreferredCandidate(diagnostics);
  const icloud = diagnostics?.icloud;
  const handoffHealth = icloud?.handoffHealth;
  const icloudAvailability = icloud?.availability;
  const syncReadiness = icloud?.syncReadiness;
  const icloudMonitor = diagnostics?.icloudMonitor;
  const icloudLifecycle = icloud?.lifecycle;
  const latestIgnoredEntryEvent = icloud?.latestIgnoredEntryEvent || null;
  const latestEntryIssueEvent = icloud?.latestEntryIssueEvent || null;
  const latestHistory = icloud?.entryHistory?.slice(0, 3) || [];
  const availableEntryCount = icloud?.availableEntries?.length || 0;
  const readiness = diagnostics?.remoteReadiness;
  const tailscaleInstalled = Boolean(diagnostics?.tailscale.installed);
  const tailscaleInstallUrl = diagnostics?.tailscale.installUrl || "https://tailscale.com/download";
  const isIcloudBusy = Boolean(busy?.startsWith("icloud-handoff"));
  const isBusy = Boolean(busy?.startsWith("remote-") || isIcloudBusy);
  const readinessTone = readiness?.severity === "ok" ? "text-emerald-200" : readiness?.severity === "danger" ? "text-red-200" : "text-amber-200";
  const candidateReady = Boolean(candidate);
  const canExportIcloud = Boolean(icloud?.canExport);
  const handoffHealthTone = handoffHealth?.status === "fresh" ? "bg-emerald-500/15 text-emerald-100" : handoffHealth?.status === "address-changed" || handoffHealth?.status === "expired" || handoffHealth?.status === "invalid" || handoffHealth?.status === "html-mismatch" ? "bg-red-500/15 text-red-100" : "bg-amber-500/15 text-amber-100";
  const icloudAvailabilityTone = icloudAvailability?.severity === "ok" ? "bg-emerald-500/15 text-emerald-100" : icloudAvailability?.severity === "danger" ? "bg-red-500/15 text-red-100" : "bg-amber-500/15 text-amber-100";
  const syncReadinessTone = syncReadiness?.severity === "ok" ? "border-emerald-400/20 bg-emerald-500/10 text-emerald-50" : syncReadiness?.severity === "danger" ? "border-red-400/20 bg-red-500/10 text-red-50" : "border-amber-400/20 bg-amber-500/10 text-amber-50";
  const lastExportedAt = formatHandoffTime(handoffHealth?.lastExportedAt);
  const refreshAfter = formatHandoffTime(handoffHealth?.refreshAfter);
  const icloudMonitorStartedAt = formatHandoffTime(icloudMonitor?.startedAt || undefined);
  const icloudMonitorLastRunAt = formatHandoffTime(icloudMonitor?.lastRunAt || undefined);
  const icloudMonitorNextRunAt = formatHandoffTime(icloudMonitor?.nextRunAt || undefined);
  const icloudMonitorIntervalSeconds = Math.round((icloudMonitor?.intervalMs || 0) / 1000);
  const latestIgnoredAt = formatHandoffTime(latestIgnoredEntryEvent?.ignoredAt);
  const latestIssueAt = formatHandoffTime(latestEntryIssueEvent?.ignoredAt || latestEntryIssueEvent?.createdAt);
  const simpleIcloudStatus = getSimpleIcloudStatus(icloud);

  const handleAnalyzeRepair = async () => {
    const packet = repairText.trim();
    if (!packet) {
      setRepairError(t("onboarding.appleRemoteIcloudRepairEmpty"));
      return;
    }
    setRepairBusy(true);
    setRepairError("");
    try {
      const result = await analyzeIcloudHandoffRepairPacket(packet);
      setRepairAnalysis(result.analysis);
    } catch (error) {
      setRepairAnalysis(null);
      setRepairError(t("onboarding.appleRemoteIcloudRepairFailed"));
    } finally {
      setRepairBusy(false);
    }
  };

  const renderIcloudFixActions = () => (
    <div className="mt-3 grid gap-2 sm:grid-cols-2">
      <button
        type="button"
        onClick={onExportIcloud}
        disabled={!canExportIcloud || isBusy}
        className="inline-flex items-center justify-center gap-2 rounded-xl border border-sky-300/20 bg-sky-500/10 px-3 py-2 text-xs font-bold text-sky-50 disabled:opacity-50"
      >
        {isIcloudBusy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}
        {t("onboarding.appleRemoteRefreshIcloud")}
      </button>
      <a
        href="/admin/devices/pair"
        className="inline-flex items-center justify-center gap-2 rounded-xl border border-amber-200/20 bg-black/15 px-3 py-2 text-xs font-bold text-amber-50"
      >
        <QrCode className="h-3.5 w-3.5" />
        {t("onboarding.appleRemoteOpenQr")}
      </a>
    </div>
  );

  const renderRepairRecommendationAction = (item: IcloudHandoffRepairAnalysis["recommendations"][number]) => {
    const label = t(repairRecommendationKeys[item.id]);
    const actionClass = "inline-flex w-full items-center justify-center gap-2 rounded-xl border px-3 py-2 text-left text-[11px] font-bold disabled:opacity-50";

    if (item.id === "refresh-icloud" || item.id === "open-latest-entry") {
      return (
        <button
          key={item.id}
          type="button"
          onClick={onExportIcloud}
          disabled={!canExportIcloud || isBusy}
          className={`${actionClass} border-sky-300/20 bg-sky-500/10 text-sky-50`}
        >
          {isIcloudBusy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5 shrink-0" />}
          <span>{label}</span>
        </button>
      );
    }

    if (item.id === "regenerate-qr") {
      return (
        <a
          key={item.id}
          href="/admin/devices/pair"
          className={`${actionClass} border-amber-200/20 bg-black/15 text-amber-50`}
        >
          <QrCode className="h-3.5 w-3.5 shrink-0" />
          <span>{label}</span>
        </a>
      );
    }

    if (item.id === "start-tailscale") {
      return tailscaleInstalled ? (
        <button
          key={item.id}
          type="button"
          onClick={onStartTailscale}
          disabled={isBusy}
          className={`${actionClass} border-blue-300/20 bg-blue-500/10 text-blue-100`}
        >
          {busy === "remote-tailscale" ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Wifi className="h-3.5 w-3.5 shrink-0" />}
          <span>{label}</span>
        </button>
      ) : (
        <a
          key={item.id}
          href={tailscaleInstallUrl}
          target="_blank"
          rel="noreferrer"
          className={`${actionClass} border-blue-300/20 bg-blue-500/10 text-blue-100`}
        >
          <ExternalLink className="h-3.5 w-3.5 shrink-0" />
          <span>{label}</span>
        </a>
      );
    }

    if (item.id === "start-cloudflare") {
      return (
        <button
          key={item.id}
          type="button"
          onClick={onStartCloudflare}
          disabled={isBusy}
          className={`${actionClass} border-white/[0.08] bg-white/[0.03] text-zinc-200`}
        >
          {busy === "remote-cloudflare" ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Cloud className="h-3.5 w-3.5 shrink-0" />}
          <span>{label}</span>
        </button>
      );
    }

    if (item.id === "save-stable-entry") {
      return (
        <button
          key={item.id}
          type="button"
          onClick={() => candidate && onSaveCandidate(candidate)}
          disabled={isBusy || !candidateReady}
          className={`${actionClass} border-emerald-400/20 bg-emerald-500/10 text-emerald-200`}
        >
          {busy === "remote-save" ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <ShieldCheck className="h-3.5 w-3.5 shrink-0" />}
          <span>{label}</span>
        </button>
      );
    }

    if (item.id === "test-phone-entry") {
      return (
        <button
          key={item.id}
          type="button"
          onClick={() => candidate && onTestCandidate(candidate)}
          disabled={isBusy || !candidateReady}
          className={`${actionClass} border-white/[0.08] bg-white/[0.03] text-zinc-200`}
        >
          {busy === "remote-test" ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <CheckCircle2 className="h-3.5 w-3.5 shrink-0" />}
          <span>{label}</span>
        </button>
      );
    }

    return (
      <div key={item.id} className="flex items-center gap-2 rounded-xl bg-black/15 p-2 text-[11px] font-bold">
        <CheckCircle2 className="h-3.5 w-3.5 shrink-0" />
        <span>{label}</span>
      </div>
    );
  };

  return (
    <section className="rounded-[28px] border border-sky-400/15 bg-[#101722] p-5">
      <div className="flex items-start justify-between gap-3">
        <div className="flex gap-3">
          <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl border border-sky-400/20 bg-sky-500/10 text-sky-200">
            <Wifi className="h-5 w-5" />
          </div>
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <h2 className="font-bold">{t("onboarding.appleRemoteTitle")}</h2>
              <span className="rounded-full border border-white/[0.08] bg-white/[0.04] px-2 py-0.5 text-[10px] font-bold text-sky-100">
                {appleRuntime ? t("onboarding.appleRemoteDetected") : t("onboarding.appleRemoteWorksElsewhere")}
              </span>
            </div>
            <p className="mt-2 text-sm leading-relaxed text-zinc-400">
              {t("onboarding.appleRemoteDescription")}
            </p>
          </div>
        </div>
        {readiness?.severity === "ok" ? <CheckCircle2 className="mt-1 h-5 w-5 shrink-0 text-emerald-300" /> : null}
      </div>

      <div className="mt-5 rounded-2xl border border-sky-400/15 bg-sky-500/10 p-4 text-xs leading-relaxed text-sky-50/85">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="font-bold text-sky-50">{t("onboarding.appleRemoteDefaultPath")}</div>
          <span className={`rounded-full bg-[#060a10]/55 px-2 py-0.5 text-[10px] font-bold ${readinessTone}`}>
            {readiness ? t(readinessStatusKeys[readiness.status]) : t("connection.readiness.status.localOnly")}
          </span>
        </div>
        <div className="mt-2 break-all font-mono text-[11px] text-sky-100/80">
          {candidate?.baseUrl || t("onboarding.appleRemoteNoCandidate")}
        </div>
        {candidate ? (
          <div className="mt-3 border-t border-sky-200/10 pt-3 text-sky-50/75">
            <div className="font-bold text-sky-50">{candidate.label}</div>
            <div className="mt-1">{candidate.notes[0] || t("onboarding.appleRemoteCandidateReady")}</div>
            {candidate.requiresRestart ? <div className="mt-1 text-amber-100">{t("onboarding.appleRemoteRestartNeeded")}</div> : null}
          </div>
        ) : null}
      </div>

      <div className="mt-3 rounded-2xl border border-white/[0.06] bg-white/[0.03] p-4 text-xs leading-relaxed text-zinc-400">
        <div className="flex gap-2">
          <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-emerald-300" />
          <span>{t("onboarding.appleRemoteIcloudHint")}</span>
        </div>
        <div className="mt-3 rounded-xl border border-white/[0.06] bg-[#060a10]/45 p-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <span className="font-bold text-zinc-100">{t("onboarding.appleRemoteIcloudStatus")}</span>
            <span className={`rounded-full px-2 py-0.5 text-[10px] font-bold ${canExportIcloud ? "bg-emerald-500/15 text-emerald-100" : "bg-amber-500/15 text-amber-100"}`}>
              {canExportIcloud ? t("onboarding.appleRemoteIcloudReady") : t("onboarding.appleRemoteIcloudUnavailable")}
            </span>
          </div>
          <div className={`mt-3 rounded-xl border p-3 ${simpleIcloudStatus.tone}`}>
            <div className="flex gap-2">
              {simpleIcloudStatus.icon === "ready" ? <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" /> : simpleIcloudStatus.icon === "refresh" ? <RefreshCw className="mt-0.5 h-4 w-4 shrink-0" /> : simpleIcloudStatus.icon === "warning" ? <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" /> : <Cloud className="mt-0.5 h-4 w-4 shrink-0" />}
              <div>
                <div className="font-bold">{t(simpleIcloudStatus.titleKey)}</div>
                <div className="mt-1 text-[11px] leading-relaxed opacity-80">{t(simpleIcloudStatus.bodyKey)}</div>
              </div>
            </div>
          </div>
          {syncReadiness ? (
            <div className={`mt-3 rounded-xl border p-3 ${syncReadinessTone}`}>
              <div className="flex gap-2">
                {syncReadiness.canOpenOnPhone ? <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" /> : syncReadiness.status === "syncing" ? <Loader2 className="mt-0.5 h-4 w-4 shrink-0 animate-spin" /> : <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />}
                <div>
                  <div className="font-bold">{t(icloudSyncReadinessKeys[syncReadiness.status])}</div>
                  <div className="mt-1 text-[11px] leading-relaxed opacity-80">
                    {t(icloudSyncActionKeys[syncReadiness.action], { count: syncReadiness.pendingCount })}
                  </div>
                </div>
              </div>
            </div>
          ) : null}
          {availableEntryCount > 1 ? (
            <div className="mt-3 rounded-xl border border-sky-400/15 bg-sky-500/10 p-3 text-[11px] leading-relaxed text-sky-50/80">
              <div className="font-bold text-sky-50">{t("onboarding.appleRemoteIcloudMultiDesktopTitle", { count: availableEntryCount })}</div>
              <div className="mt-1">{t("onboarding.appleRemoteIcloudMultiDesktopBody")}</div>
            </div>
          ) : null}
          {latestIgnoredEntryEvent ? (
            <div className="mt-3 rounded-xl border border-amber-400/20 bg-amber-500/10 p-3 text-amber-50">
              <div className="flex gap-2">
                <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
                <div>
                  <div className="font-bold">{t("onboarding.appleRemoteIcloudOldEntryTitle")}</div>
                  <div className="mt-1 text-[11px] leading-relaxed text-amber-50/80">
                    {t("onboarding.appleRemoteIcloudOldEntryBody", {
                      device: latestIgnoredEntryEvent.deviceName || latestIgnoredEntryEvent.deviceId,
                      time: latestIgnoredAt || "-",
                    })}
                  </div>
                  <div className="mt-2 break-all rounded-lg bg-[#060a10]/40 p-2 font-mono text-[10px] text-amber-50/70">
                    {latestIgnoredEntryEvent.entryBaseUrl}
                  </div>
                  <div className="mt-2 text-[11px] font-bold text-amber-50">
                    {t("onboarding.appleRemoteIcloudOldEntryAction")}
                  </div>
                  {renderIcloudFixActions()}
                </div>
              </div>
            </div>
          ) : null}
          {latestEntryIssueEvent ? (
            <div className="mt-3 rounded-xl border border-amber-400/20 bg-amber-500/10 p-3 text-amber-50">
              <div className="flex gap-2">
                <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
                <div>
                  <div className="font-bold">{t("onboarding.appleRemoteIcloudIssueTitle")}</div>
                  <div className="mt-1 text-[11px] leading-relaxed text-amber-50/80">
                    {t("onboarding.appleRemoteIcloudIssueBody", {
                      device: latestEntryIssueEvent.deviceName || latestEntryIssueEvent.deviceId,
                      kind: t(issueEventKindKeys[latestEntryIssueEvent.eventType]),
                      time: latestIssueAt || "-",
                    })}
                  </div>
                  <div className="mt-2 break-all rounded-lg bg-[#060a10]/40 p-2 font-mono text-[10px] text-amber-50/70">
                    {latestEntryIssueEvent.entryBaseUrl}
                  </div>
                  <div className="mt-2 text-[11px] font-bold text-amber-50">
                    {t("onboarding.appleRemoteIcloudIssueAction")}
                  </div>
                  {renderIcloudFixActions()}
                </div>
              </div>
            </div>
          ) : null}
          <details className="mt-3 rounded-xl border border-white/[0.06] bg-[#060a10]/30 p-3 text-[11px] text-zinc-500">
            <summary className="cursor-pointer font-bold text-zinc-200">{t("onboarding.appleRemoteIcloudAdvancedDiagnostics")}</summary>
            <div className="mt-3 break-all font-mono text-[11px] text-zinc-500">
              {icloud?.handoffFilePath || icloud?.openInstruction || t("onboarding.appleRemoteIcloudNoPath")}
            </div>
            {icloudAvailability ? (
              <div className="mt-3 rounded-xl border border-white/[0.06] bg-[#060a10]/30 p-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="font-bold text-zinc-100">{t("onboarding.appleRemoteIcloudAvailabilityTitle")}</span>
                  <span className={`rounded-full px-2 py-0.5 text-[10px] font-bold ${icloudAvailabilityTone}`}>
                    {t(icloudAvailabilityKeys[icloudAvailability.status])}
                  </span>
                </div>
                {icloudAvailability.status === "sync-pending" ? (
                  <div className="mt-2 text-[11px] leading-relaxed text-amber-100">
                    {t("onboarding.appleRemoteIcloudAvailabilityPendingBody", { count: icloudAvailability.pendingCount })}
                  </div>
                ) : null}
                {icloudAvailability.status === "read-only" ? (
                  <div className="mt-2 text-[11px] leading-relaxed text-red-100">
                    {t("onboarding.appleRemoteIcloudAvailabilityReadOnlyBody")}
                  </div>
                ) : null}
              </div>
            ) : null}
            {handoffHealth ? (
              <div className="mt-3 border-t border-white/[0.06] pt-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="font-bold text-zinc-100">{t("onboarding.appleRemoteIcloudHealthTitle")}</span>
                  <span className={`rounded-full px-2 py-0.5 text-[10px] font-bold ${handoffHealthTone}`}>
                    {t(handoffHealthStatusKeys[handoffHealth.status])}
                  </span>
                </div>
                <div className="mt-2 grid gap-1 text-[11px] text-zinc-500">
                  <div>{t("onboarding.appleRemoteIcloudDesktop")}: {icloud?.desktopName || "-"}</div>
                  <div>{t("onboarding.appleRemoteIcloudChooseFile")}: {icloud?.indexFilePath || "-"}</div>
                  <div>{t("onboarding.appleRemoteIcloudLastExported")}: {lastExportedAt || t("onboarding.appleRemoteIcloudNeverExported")}</div>
                  <div>{t("onboarding.appleRemoteIcloudRefreshAfter")}: {refreshAfter || "-"}</div>
                  <div>{t("onboarding.appleRemoteIcloudReason")}: {t(handoffHealthReasonKeys[handoffHealth.status])}</div>
                </div>
              </div>
            ) : null}
            {icloudMonitor ? (
              <div className="mt-3 border-t border-white/[0.06] pt-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="font-bold text-zinc-100">{t("onboarding.appleRemoteIcloudMonitorTitle")}</span>
                  <span className={`rounded-full px-2 py-0.5 text-[10px] font-bold ${icloudMonitor.running ? "bg-emerald-500/15 text-emerald-100" : icloudMonitor.enabled ? "bg-amber-500/15 text-amber-100" : "bg-zinc-500/15 text-zinc-200"}`}>
                    {icloudMonitor.running ? t("onboarding.appleRemoteIcloudMonitorRunning") : icloudMonitor.enabled ? t("onboarding.appleRemoteIcloudMonitorIdle") : t("onboarding.appleRemoteIcloudMonitorDisabled")}
                  </span>
                </div>
                <div className="mt-2 grid gap-1 text-[11px] text-zinc-500">
                  <div>{t("onboarding.appleRemoteIcloudMonitorInterval")}: {icloudMonitorIntervalSeconds}s</div>
                  <div>{t("onboarding.appleRemoteIcloudMonitorStartedAt")}: {icloudMonitorStartedAt || t("onboarding.appleRemoteIcloudNeverExported")}</div>
                  <div>{t("onboarding.appleRemoteIcloudMonitorLastRun")}: {icloudMonitorLastRunAt || t("onboarding.appleRemoteIcloudNeverExported")}</div>
                  <div>{t("onboarding.appleRemoteIcloudMonitorNextRun")}: {icloudMonitorNextRunAt || "-"}</div>
                  {icloudMonitor.lastResult ? (
                    <div>
                      {t("onboarding.appleRemoteIcloudMonitorLastResult")}:{" "}
                      {icloudMonitor.lastResult.error
                        ? t("onboarding.appleRemoteIcloudMonitorResultFailed")
                        : icloudMonitor.lastResult.refreshed
                          ? t("onboarding.appleRemoteIcloudMonitorResultRefreshed")
                          : t("onboarding.appleRemoteIcloudMonitorResultFresh")}{" "}
                      ({icloudMonitor.lastResult.refreshReason} / {icloudMonitor.lastResult.status})
                    </div>
                  ) : null}
                  {icloudMonitor.lastResult?.error ? (
                    <div className="text-red-200">{t("onboarding.appleRemoteIcloudMonitorError")}: {icloudMonitor.lastResult.error}</div>
                  ) : null}
                </div>
              </div>
            ) : null}
            {icloudLifecycle ? (
              <div className="mt-3 border-t border-white/[0.06] pt-3">
                <div className="font-bold text-zinc-200">{t("onboarding.appleRemoteIcloudLifecycleTitle")}</div>
                <div className="mt-2 grid gap-1 text-[11px] text-zinc-500">
                  <div>{t("onboarding.appleRemoteIcloudLifecycleEntryCount")}: {icloudLifecycle.entryCount}</div>
                  <div>{t("onboarding.appleRemoteIcloudLifecycleExpiredCount")}: {icloudLifecycle.expiredEntryCount}</div>
                  <div>{t("onboarding.appleRemoteIcloudLifecyclePrunableCount")}: {icloudLifecycle.prunableEntryCount}</div>
                  <div>{t("onboarding.appleRemoteIcloudLifecycleOrphanedCount")}: {icloudLifecycle.orphanedFileCount}</div>
                </div>
                {icloudLifecycle.prunableEntryCount > 0 ? (
                  <div className="mt-2 rounded-lg border border-amber-400/20 bg-amber-500/10 p-2 text-[11px] leading-relaxed text-amber-50">
                    {t("onboarding.appleRemoteIcloudLifecycleCleanupHint")}
                  </div>
                ) : null}
              </div>
            ) : null}
            {latestHistory.length ? (
              <div className="mt-3 border-t border-white/[0.06] pt-3">
                <div className="font-bold text-zinc-200">{t("onboarding.appleRemoteIcloudHistoryTitle")}</div>
                <div className="mt-2 grid gap-2">
                  {latestHistory.map((item) => (
                    <div key={`${item.desktopId}-${item.generatedAt}`} className="rounded-lg bg-white/[0.03] p-2">
                      <div className="font-bold text-zinc-200">{item.desktopName}</div>
                      <div className="break-all font-mono text-[10px]">{item.baseUrl}</div>
                      {item.previousBaseUrl && item.previousBaseUrl !== item.baseUrl ? (
                        <div className="break-all font-mono text-[10px] text-zinc-500">{t("onboarding.appleRemoteIcloudHistoryPrevious")}: {item.previousBaseUrl}</div>
                      ) : null}
                      <div>{formatHandoffTime(item.generatedAt)} · {t(historyChangeTypeKeys[item.changeType] || "onboarding.appleRemoteIcloudHistoryUnknown")} · {item.reason}</div>
                    </div>
                  ))}
                </div>
              </div>
            ) : null}
          </details>
          <details className="mt-3 rounded-xl border border-white/[0.06] bg-[#060a10]/30 p-3 text-[11px] text-zinc-500">
            <summary className="cursor-pointer font-bold text-zinc-200">{t("onboarding.appleRemoteIcloudRepairTitle")}</summary>
            <p className="mt-2 leading-relaxed">{t("onboarding.appleRemoteIcloudRepairBody")}</p>
            <textarea
              value={repairText}
              onChange={(event) => setRepairText(event.target.value)}
              placeholder={t("onboarding.appleRemoteIcloudRepairPlaceholder")}
              className="mt-3 min-h-28 w-full resize-y rounded-xl border border-white/[0.08] bg-black/20 p-3 font-mono text-[11px] text-zinc-200 outline-none focus:border-sky-300/40"
            />
            <button
              type="button"
              onClick={handleAnalyzeRepair}
              disabled={repairBusy}
              className="mt-3 inline-flex w-full items-center justify-center gap-2 rounded-xl border border-sky-400/20 bg-sky-500/10 px-4 py-2.5 text-xs font-bold text-sky-100 disabled:opacity-50"
            >
              {repairBusy ? <Loader2 className="h-4 w-4 animate-spin" /> : <ShieldCheck className="h-4 w-4" />}
              {repairBusy ? t("onboarding.appleRemoteIcloudRepairAnalyzing") : t("onboarding.appleRemoteIcloudRepairAnalyze")}
            </button>
            {repairError ? <div className="mt-2 rounded-lg border border-red-400/20 bg-red-500/10 p-2 text-red-100">{repairError}</div> : null}
            {repairAnalysis ? (
              <div className={`mt-3 rounded-xl border p-3 ${repairAnalysis.severity === "danger" ? "border-red-400/20 bg-red-500/10 text-red-50" : repairAnalysis.severity === "warning" ? "border-amber-400/20 bg-amber-500/10 text-amber-50" : "border-emerald-400/20 bg-emerald-500/10 text-emerald-50"}`}>
                <div className="font-bold">{t("onboarding.appleRemoteIcloudRepairResult")}: {t(repairReasonKeys[repairAnalysis.reason])}</div>
                <div className="mt-2 grid gap-1 break-all font-mono text-[10px] opacity-80">
                  <div>{t("onboarding.appleRemoteIcloudRepairPhoneEntry")}: {repairAnalysis.parsed.entryBaseUrl || "-"}</div>
                  <div>{t("onboarding.appleRemoteIcloudRepairDesktopEntry")}: {repairAnalysis.desktop.recommendedBaseUrl || "-"}</div>
                </div>
                <div className="mt-3 text-[11px] font-bold opacity-80">{t("onboarding.appleRemoteIcloudRepairActions")}</div>
                <div className="mt-2 grid gap-2 sm:grid-cols-2">
                  {repairAnalysis.recommendations.map((item) => (
                    renderRepairRecommendationAction(item)
                  ))}
                </div>
              </div>
            ) : null}
          </details>
        </div>
      </div>

      <div className="mt-5 grid gap-3">
        <button
          type="button"
          onClick={onExportIcloud}
          disabled={!canExportIcloud || isBusy}
          className="inline-flex w-full items-center justify-center gap-2 rounded-xl bg-sky-400 px-4 py-3 text-sm font-bold text-[#061016] disabled:opacity-50"
        >
          {isIcloudBusy ? <Loader2 className="h-4 w-4 animate-spin" /> : handoffHealth?.needsRefresh ? <RefreshCw className="h-4 w-4" /> : <Cloud className="h-4 w-4" />}
          {isIcloudBusy ? t("onboarding.appleRemoteIcloudSyncing") : canExportIcloud ? (handoffHealth?.needsRefresh ? t("onboarding.appleRemoteRefreshIcloud") : t("onboarding.appleRemoteExportIcloud")) : t("onboarding.appleRemoteIcloudDisabled")}
        </button>

        <div className="grid gap-3 sm:grid-cols-2">
          <button
            type="button"
            onClick={() => candidate && onSaveCandidate(candidate)}
            disabled={isBusy || !candidateReady}
            className="inline-flex items-center justify-center gap-2 rounded-xl border border-emerald-400/20 bg-emerald-500/10 px-4 py-3 text-sm font-bold text-emerald-200 disabled:opacity-50"
          >
            {busy === "remote-save" ? <Loader2 className="h-4 w-4 animate-spin" /> : <ShieldCheck className="h-4 w-4" />}
            {t("onboarding.appleRemoteSaveDefault")}
          </button>
          <button
            type="button"
            onClick={() => candidate && onTestCandidate(candidate)}
            disabled={isBusy || !candidateReady}
            className="inline-flex items-center justify-center gap-2 rounded-xl border border-white/[0.08] bg-white/[0.03] px-4 py-3 text-sm font-bold text-zinc-200 disabled:opacity-50"
          >
            {busy === "remote-test" ? <Loader2 className="h-4 w-4 animate-spin" /> : <CheckCircle2 className="h-4 w-4" />}
            {t("onboarding.appleRemoteTestDefault")}
          </button>
        </div>

        <details className="rounded-2xl border border-white/[0.08] bg-white/[0.03] p-3">
          <summary className="cursor-pointer text-xs font-bold text-zinc-300">{t("onboarding.appleRemoteFallbackSummary")}</summary>
          <div className="mt-3 grid gap-3">
            <p className="text-xs leading-relaxed text-zinc-500">{t("onboarding.appleRemoteFallbackBody")}</p>
            {tailscaleInstalled ? (
              <button
                type="button"
                onClick={onStartTailscale}
                disabled={isBusy}
                className="inline-flex w-full items-center justify-center gap-2 rounded-xl border border-blue-300/20 bg-blue-500/10 px-4 py-3 text-sm font-bold text-blue-100 disabled:opacity-50"
              >
                {busy === "remote-tailscale" ? <Loader2 className="h-4 w-4 animate-spin" /> : <Wifi className="h-4 w-4" />}
                {t("onboarding.appleRemoteStartTailscale")}
              </button>
            ) : (
              <a
                href={tailscaleInstallUrl}
                target="_blank"
                rel="noreferrer"
                className="inline-flex w-full items-center justify-center gap-2 rounded-xl border border-blue-300/20 bg-blue-500/10 px-4 py-3 text-sm font-bold text-blue-100"
              >
                <ExternalLink className="h-4 w-4" />
                {t("onboarding.appleRemoteInstallTailscale")}
              </a>
            )}
            <button
              type="button"
              onClick={onStartCloudflare}
              disabled={isBusy}
              className="inline-flex w-full items-center justify-center gap-2 rounded-xl border border-white/[0.08] bg-white/[0.03] px-4 py-3 text-sm font-bold text-zinc-200 disabled:opacity-50"
            >
              {busy === "remote-cloudflare" ? <Loader2 className="h-4 w-4 animate-spin" /> : <Cloud className="h-4 w-4" />}
              {t("onboarding.appleRemoteStartCloudflare")}
            </button>
          </div>
        </details>

        <div className="grid gap-3 sm:grid-cols-2">
          <a
            href="/admin/devices/pair"
            className="inline-flex items-center justify-center gap-2 rounded-xl border border-sky-400/20 bg-sky-500/10 px-4 py-3 text-sm font-bold text-sky-200"
          >
            <QrCode className="h-4 w-4" />
            {t("onboarding.appleRemoteOpenQr")}
          </a>
          <a
            href="/admin/settings#mobile-connect"
            className="inline-flex items-center justify-center gap-2 rounded-xl border border-white/[0.08] bg-white/[0.03] px-4 py-3 text-sm font-bold text-zinc-200"
          >
            <ArrowRight className="h-4 w-4" />
            {t("onboarding.appleRemoteAdvanced")}
          </a>
        </div>
        <div className="flex items-center gap-2 text-[11px] leading-relaxed text-zinc-500">
          <Smartphone className="h-3.5 w-3.5 shrink-0" />
          <span>{t("onboarding.appleRemotePairAfterSave")}</span>
        </div>
      </div>
    </section>
  );
}
