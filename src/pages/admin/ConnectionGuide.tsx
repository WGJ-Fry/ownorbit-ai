import { useEffect, useState } from "react";
import { CheckCircle2, Copy, Globe2, PlugZap, Router, ShieldCheck } from "lucide-react";
import { getHealth, getNetworkDiagnostics, NetworkDiagnostics, runRemoteHealthCheck, saveDesktopConnectionConfig, startCloudflareTunnel, startTailscaleHttpsServe, stopCloudflareTunnel, stopTailscaleHttpsServe, testConnectionUrl } from "../../services/lifeosApi";
import { useI18n } from "../../i18n/I18nProvider";
import CloudflareTunnelActions from "./CloudflareTunnelActions";
import CloudflareNamedTunnelCard from "./CloudflareNamedTunnelCard";
import ConnectionToolStatus from "./ConnectionToolStatus";
import CustomRemoteEntryCard from "./CustomRemoteEntryCard";
import GuideCard from "./ConnectionGuideCard";
import RemoteReadinessCard from "./RemoteReadinessCard";
import TailscaleServeActions from "./TailscaleServeActions";

type Health = Awaited<ReturnType<typeof getHealth>>;
type ConnectionResult = Awaited<ReturnType<typeof testConnectionUrl>>["result"];

function connectionStatusMessage(result: ConnectionResult, t: ReturnType<typeof useI18n>["t"]) {
  const passed = result.steps?.filter((step) => step.ok).length || 0;
  const total = result.steps?.length || 1;
  return result.ok
    ? t("connection.success", { latency: result.latencyMs, url: result.url, passed, total })
    : t("connection.failure", { message: result.error || `HTTP ${result.status}`, passed, total });
}

export default function ConnectionGuide({ health }: { health: Health | null }) {
  const { t } = useI18n();
  const [diagnostics, setDiagnostics] = useState<NetworkDiagnostics | null>(null);
  const [copied, setCopied] = useState<string | null>(null);
  const [testStatus, setTestStatus] = useState<string | null>(null);
  const [testingCandidate, setTestingCandidate] = useState<string | null>(null);
  const [savingCandidate, setSavingCandidate] = useState<string | null>(null);
  const [tunnelBusy, setTunnelBusy] = useState<"start" | "stop" | null>(null);
  const [tailscaleServeBusy, setTailscaleServeBusy] = useState<"start" | "stop" | null>(null);
  const [testing, setTesting] = useState(false);
  const [remoteHealthBusy, setRemoteHealthBusy] = useState(false);
  const baseUrl = diagnostics?.recommendedBaseUrl || health?.publicBaseUrl || "http://LAN-IP:3000";
  const mobileChatUrl = `${baseUrl.replace(/\/$/, "")}/mobile/chat`;
  const recommendedCandidate = diagnostics?.connectionCandidates?.[0] || null;

  useEffect(() => {
    let cancelled = false;
    getNetworkDiagnostics()
      .then((data) => {
        if (!cancelled) setDiagnostics(data);
      })
      .catch(() => {
        if (!cancelled) setDiagnostics(null);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const copyText = async (label: string, value: string) => {
    await navigator.clipboard.writeText(value).catch(() => null);
    setCopied(label);
    window.setTimeout(() => setCopied(null), 1200);
  };

  const refreshDiagnostics = async () => {
    const nextDiagnostics = await getNetworkDiagnostics().catch(() => null);
    if (nextDiagnostics) setDiagnostics(nextDiagnostics);
  };

  const handleTestConnection = async () => {
    setTesting(true);
    setTestStatus(null);
    try {
      const { result } = await testConnectionUrl(baseUrl);
      setTestStatus(connectionStatusMessage(result, t));
    } catch (error: any) {
      setTestStatus(error.message || t("connection.testFailed"));
    } finally {
      setTesting(false);
    }
  };

  const handleTestCandidate = async (candidateId: string, candidateBaseUrl: string, persist = false, label = "") => {
    setTestingCandidate(candidateId);
    setTestStatus(null);
    try {
      const { result } = await testConnectionUrl(candidateBaseUrl, { persist, label });
      setTestStatus(connectionStatusMessage(result, t));
      if (persist) await refreshDiagnostics();
    } catch (error: any) {
      setTestStatus(error.message || t("connection.testFailed"));
    } finally {
      setTestingCandidate(null);
    }
  };

  const handleSaveCandidate = async (candidate: NetworkDiagnostics["connectionCandidates"][number]) => {
    setSavingCandidate(candidate.id);
    setTestStatus(null);
    try {
      const result = await saveDesktopConnectionConfig({
        mode: candidate.mode,
        label: candidate.label,
        baseUrl: candidate.baseUrl,
      });
      setTestStatus(result.message);
      const nextDiagnostics = await getNetworkDiagnostics().catch(() => null);
      if (nextDiagnostics) setDiagnostics(nextDiagnostics);
    } catch (error: any) {
      setTestStatus(error.message || t("connection.saveFailed"));
    } finally {
      setSavingCandidate(null);
    }
  };

  const runRemoteAction = async (
    setBusy: (value: "start" | "stop" | null) => void,
    state: "start" | "stop",
    action: () => Promise<{ diagnostics: NetworkDiagnostics; message: string }>,
    fallbackKey: string,
  ) => {
    setBusy(state);
    setTestStatus(null);
    try {
      const result = await action();
      setDiagnostics(result.diagnostics);
      setTestStatus(result.message);
    } catch (error: any) {
      setTestStatus(error.message || t(fallbackKey as any));
      await refreshDiagnostics();
    } finally {
      setBusy(null);
    }
  };

  const handleStartCloudflareTunnel = () => runRemoteAction(setTunnelBusy, "start", startCloudflareTunnel, "connection.cloudflareStartFailed");
  const handleStopCloudflareTunnel = () => runRemoteAction(setTunnelBusy, "stop", stopCloudflareTunnel, "connection.cloudflareStopFailed");
  const handleStartTailscaleServe = () => runRemoteAction(setTailscaleServeBusy, "start", startTailscaleHttpsServe, "connection.tailscaleServeStartFailed");
  const handleStopTailscaleServe = () => runRemoteAction(setTailscaleServeBusy, "stop", stopTailscaleHttpsServe, "connection.tailscaleServeStopFailed");

  const handleRemoteHealthCheck = async () => {
    setRemoteHealthBusy(true);
    setTestStatus(null);
    try {
      const result = await runRemoteHealthCheck();
      setDiagnostics(result.diagnostics);
      setTestStatus(result.skipped ? t("connection.remoteHealthSkipped") : t("connection.remoteHealthChecked"));
    } catch (error: any) {
      setTestStatus(error.message || t("connection.testFailed"));
      await refreshDiagnostics();
    } finally {
      setRemoteHealthBusy(false);
    }
  };

  return (
    <section id="mobile-connect" className="mb-6 scroll-mt-6 rounded-[28px] border border-white/[0.08] bg-[#101722] p-5">
      <div className="mb-4 flex items-center gap-2 font-bold">
        <Router className="h-4 w-4 text-cyan-300" />
        {t("connection.title")}
      </div>
      <div className="grid gap-4 md:grid-cols-3">
        <GuideCard
          icon={<ShieldCheck className="h-4 w-4" />}
          title={t("connection.localTitle")}
          status={health?.networkMode === "local" && !health?.publicBaseUrl ? t("connection.currentMode") : t("connection.optional")}
          rows={[
            [t("connection.purpose"), t("connection.localPurpose")],
            [t("connection.listen"), "LIFEOS_HOST=127.0.0.1"],
            [t("connection.risk"), t("connection.lowestRisk")],
          ]}
          notes={[t("connection.localNote")]}
          tone="green"
        />
        <GuideCard
          icon={<Router className="h-4 w-4" />}
          title={t("connection.lanTitle")}
          status={health?.networkMode === "lan" && !health?.publicBaseUrl ? t("connection.currentMode") : t("connection.needsRestart")}
          rows={[
            [t("connection.purpose"), t("connection.lanPurpose")],
            [t("connection.listen"), "LIFEOS_HOST=0.0.0.0"],
            [t("connection.authorization"), "LIFEOS_ALLOW_PUBLIC=1"],
          ]}
          notes={diagnostics?.lanUrls.length ? [t("connection.availableAddress", { url: diagnostics.lanUrls[0] }), t("connection.trustedOnly")] : [t("connection.lanFallback")]}
          tone="blue"
        />
        <GuideCard
          icon={<Globe2 className="h-4 w-4" />}
          title={t("connection.publicTitle")}
          status={health?.publicBaseUrl ? t("connection.currentMode") : t("connection.needsDomain")}
          rows={[
            [t("connection.purpose"), t("connection.publicPurpose")],
            [t("connection.address"), diagnostics?.publicBaseUrl || health?.publicBaseUrl || "PUBLIC_BASE_URL=https://..."],
            [t("connection.authorization"), "LIFEOS_ALLOW_PUBLIC=1"],
          ]}
          notes={diagnostics?.tailscale.mobileUrls?.length ? [t("connection.tailscaleUrl", { url: diagnostics.tailscale.mobileUrls[0] }), t("connection.tunnelRecommendation")] : [t("connection.tunnelRecommendation")]}
          tone={health?.publicBaseUrl ? "amber" : "blue"}
        />
      </div>
      {diagnostics ? (
        <>
        <div className="mt-4 rounded-2xl border border-cyan-400/20 bg-cyan-500/10 p-4">
          <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
            <div>
              <div className="flex items-center gap-2 text-sm font-bold text-cyan-100">
                <CheckCircle2 className="h-4 w-4" />
                {t("connection.recommendedAddress")}
              </div>
              <div className="mt-2 font-mono text-sm text-cyan-50">{recommendedCandidate?.baseUrl || baseUrl}</div>
              <div className="mt-2 text-xs leading-relaxed text-cyan-100/75">
                {recommendedCandidate?.requiresRestart
                  ? t("connection.restartRequiredDescription")
                  : t("connection.activeDescription")}
              </div>
              {recommendedCandidate?.envTemplate ? (
                <div className="mt-3 rounded-xl border border-cyan-100/15 bg-[#061016]/45 p-3">
                  <div className="mb-1 text-[11px] font-bold text-cyan-100/80">{t("connection.recommendedEnv")}</div>
                  <div className="font-mono text-[11px] leading-relaxed text-cyan-50/85">{recommendedCandidate.envTemplate}</div>
                  {recommendedCandidate.requiresRestart ? (
                    <div className="mt-2 text-[11px] leading-relaxed text-cyan-100/60">
                      {t("connection.packageRestartHint", { instruction: recommendedCandidate.restartInstruction })}
                    </div>
                  ) : null}
                </div>
              ) : null}
              {diagnostics.desktopRuntimeConfig ? (
                <div className="mt-3 rounded-xl border border-emerald-400/15 bg-emerald-500/10 p-3 text-[11px] leading-relaxed text-emerald-100">
                  {t("connection.savedDesktopConfig", { label: diagnostics.desktopRuntimeConfig.label, url: diagnostics.desktopRuntimeConfig.baseUrl })}
                </div>
              ) : null}
            </div>
            <div className="flex flex-wrap gap-2">
              <button
                onClick={() => copyText("recommended-mobile", recommendedCandidate?.mobileChatUrl || mobileChatUrl)}
                className="inline-flex items-center gap-2 rounded-xl border border-cyan-100/20 bg-[#061016]/45 px-3 py-2 text-xs font-bold text-cyan-50"
              >
                <Copy className="h-3.5 w-3.5" />
                {copied === "recommended-mobile" ? t("connection.copiedMobileEntry") : t("connection.copyMobileEntry")}
              </button>
              {recommendedCandidate?.envTemplate ? (
                <button
                  aria-label={t("connection.copyRecommendedEnvAria")}
                  onClick={() => copyText("recommended-env", recommendedCandidate.envTemplate)}
                  className="inline-flex items-center gap-2 rounded-xl border border-cyan-100/20 bg-[#061016]/45 px-3 py-2 text-xs font-bold text-cyan-50"
                >
                  <Copy className="h-3.5 w-3.5" />
                  {copied === "recommended-env" ? t("connection.copiedRecommendedEnv") : t("connection.copyRecommendedEnv")}
                </button>
              ) : null}
              <button
                onClick={() => handleTestCandidate(recommendedCandidate?.id || "recommended", recommendedCandidate?.baseUrl || baseUrl)}
                disabled={testingCandidate === (recommendedCandidate?.id || "recommended")}
                className="inline-flex items-center gap-2 rounded-xl border border-cyan-100/20 bg-[#061016]/45 px-3 py-2 text-xs font-bold text-cyan-50 disabled:opacity-50"
              >
                <PlugZap className="h-3.5 w-3.5" />
                {testingCandidate === (recommendedCandidate?.id || "recommended") ? t("connection.testing") : t("connection.testRecommended")}
              </button>
              {recommendedCandidate ? (
                <button
                  onClick={() => handleSaveCandidate(recommendedCandidate)}
                  disabled={savingCandidate === recommendedCandidate.id}
                  className="inline-flex items-center gap-2 rounded-xl border border-emerald-400/20 bg-emerald-500/10 px-3 py-2 text-xs font-bold text-emerald-100 disabled:opacity-50"
                >
                  <CheckCircle2 className="h-3.5 w-3.5" />
                  {savingCandidate === recommendedCandidate.id ? t("connection.saving") : t("connection.saveDesktopConfig")}
                </button>
              ) : null}
              {diagnostics.desktopRuntimeConfig?.publicBaseUrl ? (
                <button
                  onClick={() => handleTestCandidate("saved-desktop-config", diagnostics.desktopRuntimeConfig!.publicBaseUrl, true, diagnostics.desktopRuntimeConfig!.label)}
                  disabled={testingCandidate === "saved-desktop-config"}
                  className="inline-flex items-center gap-2 rounded-xl border border-emerald-400/20 bg-emerald-500/10 px-3 py-2 text-xs font-bold text-emerald-100 disabled:opacity-50"
                >
                  <PlugZap className="h-3.5 w-3.5" />
                  {testingCandidate === "saved-desktop-config" ? t("connection.testing") : t("connection.testSavedRemote")}
                </button>
              ) : null}
              <button
                onClick={handleRemoteHealthCheck}
                disabled={remoteHealthBusy}
                className="inline-flex items-center gap-2 rounded-xl border border-sky-400/20 bg-sky-500/10 px-3 py-2 text-xs font-bold text-sky-100 disabled:opacity-50"
              >
                <PlugZap className="h-3.5 w-3.5" />
                {remoteHealthBusy ? t("connection.testing") : t("connection.runRemoteHealth")}
              </button>
            </div>
          </div>
          {diagnostics.remoteValidationReport ? (
            <div className={`mt-4 rounded-2xl border p-3 text-xs leading-relaxed ${diagnostics.remoteValidationReport.ok ? "border-emerald-400/20 bg-emerald-500/10 text-emerald-100" : "border-rose-400/20 bg-rose-500/10 text-rose-100"}`}>
              <div className="font-bold">
                {diagnostics.remoteValidationReport.ok
                  ? t("connection.remoteValidationOk", {
                    passed: diagnostics.remoteValidationReport.passed,
                    total: diagnostics.remoteValidationReport.total,
                    time: new Date(diagnostics.remoteValidationReport.createdAt).toLocaleString(),
                  })
                  : t("connection.remoteValidationFail", {
                    passed: diagnostics.remoteValidationReport.passed,
                    total: diagnostics.remoteValidationReport.total,
                    time: new Date(diagnostics.remoteValidationReport.createdAt).toLocaleString(),
                  })}
              </div>
              <div className="mt-1 font-mono text-[11px] opacity-85">{diagnostics.remoteValidationReport.baseUrl}</div>
              {diagnostics.remoteValidationReport.error ? <div className="mt-1 opacity-80">{diagnostics.remoteValidationReport.error}</div> : null}
            </div>
          ) : null}
          <RemoteReadinessCard readiness={diagnostics.remoteReadiness} />
          {diagnostics.connectionCandidates?.length ? (
            <div className="mt-4 grid gap-2 lg:grid-cols-2">
              {diagnostics.connectionCandidates.slice(0, 6).map((candidate) => (
                <div key={candidate.id} className="rounded-2xl border border-white/[0.08] bg-[#061016]/45 p-3">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="font-bold text-zinc-100">{candidate.label}</span>
                        <span className={`rounded-full px-2 py-0.5 text-[10px] font-bold ${candidate.secure ? "bg-emerald-500/15 text-emerald-200" : "bg-amber-500/15 text-amber-100"}`}>
                          {candidate.secure ? t("connection.secureRecommended") : t("connection.trustedNetworkOnly")}
                        </span>
                        {candidate.requiresRestart ? <span className="rounded-full bg-blue-500/15 px-2 py-0.5 text-[10px] font-bold text-blue-100">{t("connection.restartBadge")}</span> : null}
                        <span className={`rounded-full px-2 py-0.5 text-[10px] font-bold ${candidate.stability === "stable" ? "bg-emerald-500/15 text-emerald-200" : candidate.stability === "temporary" ? "bg-amber-500/15 text-amber-100" : "bg-zinc-500/15 text-zinc-300"}`}>
                          {candidate.stability === "stable" ? t("connection.stableAddress") : candidate.stability === "temporary" ? t("connection.temporaryAddress") : t("connection.localAddress")}
                        </span>
                      </div>
                      <div className="mt-1 truncate font-mono text-xs text-cyan-200">{candidate.baseUrl}</div>
                      <div className="mt-2 text-xs leading-relaxed text-zinc-400">{candidate.notes[0]}</div>
                      <div className="mt-2 rounded-xl border border-white/[0.06] bg-black/15 p-2 font-mono text-[10px] leading-relaxed text-zinc-400">
                        {candidate.envTemplate}
                      </div>
                      <div className="mt-2 text-[11px] leading-relaxed text-zinc-500">
                        {t("connection.packageCandidateHint", { instruction: candidate.restartInstruction })}
                      </div>
                    </div>
                  </div>
                  <div className="mt-3 flex flex-wrap gap-2">
                    <button
                      onClick={() => copyText(candidate.id, candidate.mobileChatUrl)}
                      className="inline-flex items-center gap-2 rounded-xl border border-white/[0.08] bg-white/[0.04] px-3 py-2 text-xs font-bold text-zinc-200"
                    >
                      <Copy className="h-3.5 w-3.5" />
                      {copied === candidate.id ? t("connection.copied") : t("connection.copyMobileEntry")}
                    </button>
                    <button
                      onClick={() => handleTestCandidate(candidate.id, candidate.baseUrl)}
                      disabled={testingCandidate === candidate.id}
                      className="inline-flex items-center gap-2 rounded-xl border border-cyan-400/20 bg-cyan-500/10 px-3 py-2 text-xs font-bold text-cyan-200 disabled:opacity-50"
                    >
                      <PlugZap className="h-3.5 w-3.5" />
                      {testingCandidate === candidate.id ? t("connection.testing") : t("connection.test")}
                    </button>
                    <button
                      onClick={() => copyText(`${candidate.id}-env`, candidate.envTemplate)}
                      className="inline-flex items-center gap-2 rounded-xl border border-white/[0.08] bg-white/[0.04] px-3 py-2 text-xs font-bold text-zinc-200"
                    >
                      <Copy className="h-3.5 w-3.5" />
                      {copied === `${candidate.id}-env` ? t("connection.copiedEnv") : t("connection.copyEnv")}
                    </button>
                    <button
                      onClick={() => handleSaveCandidate(candidate)}
                      disabled={savingCandidate === candidate.id}
                      className="inline-flex items-center gap-2 rounded-xl border border-emerald-400/20 bg-emerald-500/10 px-3 py-2 text-xs font-bold text-emerald-100 disabled:opacity-50"
                    >
                      <CheckCircle2 className="h-3.5 w-3.5" />
                      {savingCandidate === candidate.id ? t("connection.saving") : t("connection.saveDesktopConfig")}
                    </button>
                  </div>
                </div>
              ))}
            </div>
          ) : null}
          <CustomRemoteEntryCard
            defaultUrl={diagnostics.desktopRuntimeConfig?.publicBaseUrl || diagnostics.publicBaseUrl || ""}
            onSaved={setDiagnostics}
          />
          {diagnostics.cloudflareNamedTunnel ? (
            <CloudflareNamedTunnelCard
              namedTunnel={diagnostics.cloudflareNamedTunnel}
              onUpdate={setDiagnostics}
            />
          ) : null}
        </div>
        <div className="mt-4 grid gap-3 md:grid-cols-2">
          <ConnectionToolStatus
            title="Cloudflare Tunnel"
            status={diagnostics.cloudflare.running ? t("connection.running") : diagnostics.cloudflare.installed ? t("connection.installed") : t("connection.notInstalled")}
            rows={[
              [t("connection.version"), diagnostics.cloudflare.version || "-"],
              [t("connection.publicAddress"), diagnostics.cloudflare.detectedUrls[0] || "-"],
              [t("connection.install"), diagnostics.cloudflare.installCommand],
              [t("connection.command"), diagnostics.cloudflare.suggestedCommand],
              [t("connection.startup"), diagnostics.cloudflare.envTemplate],
            ]}
            notes={diagnostics.cloudflare.notes}
            onCopy={() => copyText("cloudflare", diagnostics.cloudflare.detectedUrls[0] || diagnostics.cloudflare.suggestedCommand)}
            copied={copied === "cloudflare"}
            extraCopy={{
              label: copied === "cloudflare-env" ? t("connection.copiedEnv") : t("connection.copyEnv"),
              onCopy: () => copyText("cloudflare-env", diagnostics.cloudflare.envTemplate),
            }}
            installCopy={{
              label: copied === "cloudflare-install" ? t("connection.copiedInstallCommand") : t("connection.copyInstallCommand"),
              onCopy: () => copyText("cloudflare-install", diagnostics.cloudflare.installCommand),
            }}
            installUrl={diagnostics.cloudflare.installUrl}
            actions={<CloudflareTunnelActions cloudflare={diagnostics.cloudflare} tunnelBusy={tunnelBusy} onStart={handleStartCloudflareTunnel} onStop={handleStopCloudflareTunnel} />}
          />
          <ConnectionToolStatus
            title="Tailscale"
            status={diagnostics.tailscale.online ? t("connection.online") : diagnostics.tailscale.installed ? t("connection.installed") : t("connection.notInstalled")}
            rows={[
              [t("connection.device"), diagnostics.tailscale.deviceName || "-"],
              ["Tailnet", diagnostics.tailscale.tailnetName || "-"],
              ["HTTPS Serve", diagnostics.tailscale.httpsServeUrl || "-"],
              [t("connection.command"), diagnostics.tailscale.serveCommand || "-"],
              ["MagicDNS", diagnostics.tailscale.magicDnsUrls?.[0] || "-"],
              ["Tailnet IP", diagnostics.tailscale.urls[0] || "-"],
              [t("connection.install"), diagnostics.tailscale.installCommand],
              [t("connection.mobileAccess"), diagnostics.tailscale.mobileUrls?.[0] || diagnostics.tailscale.urls[0] || "-"],
              [t("connection.startup"), diagnostics.tailscale.envTemplate],
            ]}
            notes={diagnostics.tailscale.notes}
            onCopy={(diagnostics.tailscale.mobileUrls?.[0] || diagnostics.tailscale.urls[0]) ? () => copyText("tailscale", diagnostics.tailscale.mobileUrls?.[0] || diagnostics.tailscale.urls[0]) : undefined}
            copied={copied === "tailscale"}
            extraCopy={{
              label: copied === "tailscale-env" ? t("connection.copiedEnv") : t("connection.copyEnv"),
              onCopy: () => copyText("tailscale-env", diagnostics.tailscale.envTemplate),
            }}
            installCopy={{
              label: copied === "tailscale-install" ? t("connection.copiedInstallCommand") : t("connection.copyInstallCommand"),
              onCopy: () => copyText("tailscale-install", diagnostics.tailscale.installCommand),
            }}
            installUrl={diagnostics.tailscale.installUrl}
            actions={<TailscaleServeActions tailscale={diagnostics.tailscale} serveBusy={tailscaleServeBusy} onStart={handleStartTailscaleServe} onStop={handleStopTailscaleServe} />}
          />
        </div>
        </>
      ) : null}
      {diagnostics?.lanEnvTemplate ? (
        <div className="mt-3 flex flex-col gap-3 rounded-2xl border border-white/[0.06] bg-white/[0.03] p-4 text-xs text-zinc-400 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <div className="mb-1 font-bold text-zinc-200">{t("connection.lanEnv")}</div>
            <div className="font-mono text-zinc-300">{diagnostics.lanEnvTemplate}</div>
          </div>
          <button
            aria-label={t("connection.copyLanEnvAria")}
            onClick={() => copyText("lan-env", diagnostics.lanEnvTemplate)}
            className="inline-flex items-center justify-center gap-2 rounded-xl border border-cyan-400/20 bg-cyan-500/10 px-3 py-2 text-xs font-bold text-cyan-200"
          >
            <Copy className="h-3.5 w-3.5" />
            {copied === "lan-env" ? t("connection.copied") : t("connection.copy")}
          </button>
        </div>
      ) : null}
      <div className="mt-4 grid gap-3 rounded-2xl border border-white/[0.06] bg-white/[0.03] p-4 text-xs text-zinc-400 md:grid-cols-[1fr_1fr_auto]">
        <div>
          <div className="mb-1 font-bold text-zinc-200">{t("connection.mobileEntry")}</div>
          <div aria-label={t("connection.mobileEntryAria")} className="font-mono text-cyan-200">{mobileChatUrl}</div>
          <div className="mt-1 leading-relaxed text-zinc-500">
            {t("connection.pairingQrHint")}
          </div>
        </div>
        <div>
          <div className="mb-1 font-bold text-zinc-200">{t("connection.mobileChatEntry")}</div>
          <div aria-label={t("connection.mobileChatEntryAria")} className="font-mono text-cyan-200">{mobileChatUrl}</div>
        </div>
        <div className="flex items-end">
          <button
            onClick={handleTestConnection}
            disabled={testing}
            className="inline-flex items-center gap-2 rounded-xl border border-cyan-400/20 bg-cyan-500/10 px-3 py-2 text-xs font-bold text-cyan-200 disabled:cursor-not-allowed disabled:opacity-50"
          >
            <PlugZap className="h-3.5 w-3.5" />
            {testing ? t("connection.testing") : t("connection.testRecommended")}
          </button>
        </div>
      </div>
      {testStatus ? <div className="mt-3 rounded-2xl border border-white/[0.06] bg-white/[0.03] p-3 text-xs leading-relaxed text-zinc-300">{testStatus}</div> : null}
      {diagnostics?.safety.requiresHttpsForInternet ? (
        <div className="mt-3 rounded-2xl border border-amber-400/20 bg-amber-500/10 p-3 text-xs leading-relaxed text-amber-100">
          {t("connection.httpsWarning")}
        </div>
      ) : null}
    </section>
  );
}
