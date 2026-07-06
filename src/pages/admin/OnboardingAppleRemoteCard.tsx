import { AlertTriangle, ArrowRight, CheckCircle2, Cloud, ExternalLink, Loader2, QrCode, RefreshCw, ShieldCheck, Smartphone, Wifi } from "lucide-react";
import type { NetworkDiagnostics } from "../../services/lifeosApi";
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

export default function OnboardingAppleRemoteCard({ diagnostics, busy, onExportIcloud, onStartTailscale, onStartCloudflare, onSaveCandidate, onTestCandidate }: Props) {
  const { t } = useI18n();
  const appleRuntime = isAppleRuntime();
  const candidate = getPreferredCandidate(diagnostics);
  const icloud = diagnostics?.icloud;
  const handoffHealth = icloud?.handoffHealth;
  const latestIgnoredEntryEvent = icloud?.latestIgnoredEntryEvent || null;
  const readiness = diagnostics?.remoteReadiness;
  const tailscaleInstalled = Boolean(diagnostics?.tailscale.installed);
  const tailscaleInstallUrl = diagnostics?.tailscale.installUrl || "https://tailscale.com/download";
  const isIcloudBusy = Boolean(busy?.startsWith("icloud-handoff"));
  const isBusy = Boolean(busy?.startsWith("remote-") || isIcloudBusy);
  const readinessTone = readiness?.severity === "ok" ? "text-emerald-200" : readiness?.severity === "danger" ? "text-red-200" : "text-amber-200";
  const candidateReady = Boolean(candidate);
  const canExportIcloud = Boolean(icloud?.canExport);
  const handoffHealthTone = handoffHealth?.status === "fresh" ? "bg-emerald-500/15 text-emerald-100" : handoffHealth?.status === "address-changed" || handoffHealth?.status === "expired" || handoffHealth?.status === "invalid" || handoffHealth?.status === "html-mismatch" ? "bg-red-500/15 text-red-100" : "bg-amber-500/15 text-amber-100";
  const lastExportedAt = formatHandoffTime(handoffHealth?.lastExportedAt);
  const refreshAfter = formatHandoffTime(handoffHealth?.refreshAfter);
  const latestIgnoredAt = formatHandoffTime(latestIgnoredEntryEvent?.ignoredAt);

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
          <div className="mt-2 break-all font-mono text-[11px] text-zinc-500">
            {icloud?.handoffFilePath || icloud?.openInstruction || t("onboarding.appleRemoteIcloudNoPath")}
          </div>
          {handoffHealth ? (
            <div className="mt-3 border-t border-white/[0.06] pt-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="font-bold text-zinc-100">{t("onboarding.appleRemoteIcloudHealthTitle")}</span>
                <span className={`rounded-full px-2 py-0.5 text-[10px] font-bold ${handoffHealthTone}`}>
                  {t(handoffHealthStatusKeys[handoffHealth.status])}
                </span>
              </div>
              <div className="mt-2 grid gap-1 text-[11px] text-zinc-500">
                <div>{t("onboarding.appleRemoteIcloudLastExported")}: {lastExportedAt || t("onboarding.appleRemoteIcloudNeverExported")}</div>
                <div>{t("onboarding.appleRemoteIcloudRefreshAfter")}: {refreshAfter || "-"}</div>
                <div>{t("onboarding.appleRemoteIcloudReason")}: {t(handoffHealthReasonKeys[handoffHealth.status])}</div>
              </div>
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
                </div>
              </div>
            </div>
          ) : null}
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
