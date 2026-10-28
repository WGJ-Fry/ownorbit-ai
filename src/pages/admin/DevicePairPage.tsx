import { useEffect, useState } from "react";
import { QRCodeSVG } from "qrcode.react";
import { AlertTriangle, CheckCircle2, Copy, Loader2, PlugZap, RefreshCw, ShieldCheck, Smartphone } from "lucide-react";
import { BindingSession, BoundDevice, getBindingSession, getNetworkDiagnostics, NetworkDiagnostics, startBindingSession, testConnectionUrl } from "../../services/lifeosApi";
import type { ConnectionTestResult } from "../../services/lifeosApi";
import DevicePairConnectionTestResult from "./DevicePairConnectionTestResult";
import { useI18n } from "../../i18n/I18nProvider";
import type { TranslationKey } from "../../i18n/translations";
import { formatDevicePairingCreateError } from "../../services/devicePairingErrors";
import { eligiblePhonePairingCandidates } from "../../services/pairingCandidatePolicy";

type ConnectionCandidate = NetworkDiagnostics["connectionCandidates"][number];

const candidateLabelKey: Record<ConnectionCandidate["mode"], TranslationKey> = {
  configured: "devicePair.candidateLabel.configured",
  cloudflare: "devicePair.candidateLabel.cloudflare",
  tailscale: "devicePair.candidateLabel.tailscale",
  lan: "devicePair.candidateLabel.lan",
  local: "devicePair.candidateLabel.local",
};

function candidateNoteKey(candidate: ConnectionCandidate): TranslationKey {
  const suffix = candidate.stability === "temporary" ? "Temporary" : "Stable";
  return `devicePair.candidateNote.${candidate.mode}${suffix}` as TranslationKey;
}

export default function DevicePairPage() {
  const { t } = useI18n();
  const [session, setSession] = useState<BindingSession | null>(null);
  const [confirmedDevice, setConfirmedDevice] = useState<BoundDevice | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [createErrorDetail, setCreateErrorDetail] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [pairingBaseUrl, setPairingBaseUrl] = useState("");
  const [diagnostics, setDiagnostics] = useState<NetworkDiagnostics | null>(null);
  const [connectionTestResult, setConnectionTestResult] = useState<ConnectionTestResult | null>(null);
  const [testingConnection, setTestingConnection] = useState(false);
  const [copiedEnv, setCopiedEnv] = useState(false);
  const [clockNow, setClockNow] = useState(() => Date.now());

  const createSession = async (baseUrlOverride = "") => {
    setError(null);
    setCreateErrorDetail(null);
    setSession(null);
    setConfirmedDevice(null);
    setConnectionTestResult(null);
    try {
      let recommendedBaseUrl = "";
      try {
        const networkDiagnostics = await getNetworkDiagnostics();
        setDiagnostics(networkDiagnostics);
        const eligibleCandidates = eligiblePhonePairingCandidates<ConnectionCandidate>(networkDiagnostics.connectionCandidates);
        recommendedBaseUrl = baseUrlOverride
          ? eligibleCandidates.find((candidate) => candidate.baseUrl === baseUrlOverride)?.baseUrl || ""
          : eligibleCandidates[0]?.baseUrl || "";
      } catch {
        setDiagnostics(null);
        recommendedBaseUrl = "";
      }
      if (!recommendedBaseUrl) {
        setPairingBaseUrl("");
        setError(t("devicePair.noReachableAddress"));
        setCreateErrorDetail(t("devicePair.noReachableAddress"));
        return;
      }
      setPairingBaseUrl(recommendedBaseUrl);
      const data = await startBindingSession(recommendedBaseUrl);
      setPairingBaseUrl(data.baseUrl || recommendedBaseUrl);
      setSession(data);
      setClockNow(Date.now());
    } catch (err: any) {
      const detail = formatDevicePairingCreateError(err, t);
      setError(detail);
      setCreateErrorDetail(detail);
    }
  };

  useEffect(() => {
    createSession();
  }, []);

  useEffect(() => {
    if (!session || confirmedDevice) return;
    const timer = window.setInterval(() => setClockNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [session, confirmedDevice]);

  useEffect(() => {
    if (!session || confirmedDevice) return;
    const interval = window.setInterval(async () => {
      if (Date.now() >= session.expiresAt) {
        window.clearInterval(interval);
        return;
      }
      try {
        const data = await getBindingSession(session.id);
        if (data.device) {
          setConfirmedDevice(data.device);
          window.clearInterval(interval);
        }
      } catch (err) {
        console.error(err);
      }
    }, 1500);
    return () => window.clearInterval(interval);
  }, [session, confirmedDevice]);

  const expiresIn = session ? Math.max(0, Math.ceil((session.expiresAt - clockNow) / 1000)) : 0;
  const eligibleCandidates = eligiblePhonePairingCandidates<ConnectionCandidate>(diagnostics?.connectionCandidates || []);
  const activeCandidate = eligibleCandidates.find((candidate) => candidate.baseUrl === pairingBaseUrl) || eligibleCandidates[0] || null;
  const hasDetectedPhoneCandidate = eligibleCandidates.length > 0;
  const activeCandidateLabel = activeCandidate
    ? t(candidateLabelKey[activeCandidate.mode])
    : "";
  const activeCandidateNote = activeCandidate
    ? t(candidateNoteKey(activeCandidate))
    : "";

  const handleTestPairingAddress = async (baseUrl = pairingBaseUrl) => {
    if (!baseUrl) return;
    setTestingConnection(true);
    setConnectionTestResult(null);
    setPairingBaseUrl(baseUrl);
    try {
      const { result } = await testConnectionUrl(baseUrl);
      setConnectionTestResult(result);
    } catch (err: any) {
      setConnectionTestResult({
        ok: false,
        status: 0,
        url: baseUrl,
        latencyMs: 0,
        steps: [],
        error: t("devicePair.testFailed"),
      });
    } finally {
      setTestingConnection(false);
    }
  };

  return (
    <div className="min-h-screen bg-[#060a10] text-zinc-100 flex items-center justify-center p-6">
      <div className="w-full max-w-5xl grid md:grid-cols-[1fr_420px] gap-6">
        <section className="rounded-[28px] border border-white/[0.08] bg-[#101722] p-8 shadow-2xl">
          <div className="flex items-center gap-3 mb-8">
            <div className="w-11 h-11 rounded-2xl bg-cyan-500/10 border border-cyan-400/20 flex items-center justify-center">
              <ShieldCheck className="w-5 h-5 text-cyan-300" />
            </div>
            <div>
              <h1 className="text-2xl font-bold tracking-tight">{t("devicePair.title")}</h1>
              <p className="text-sm text-zinc-400 mt-1">{t("devicePair.subtitle")}</p>
            </div>
          </div>

          <div className="space-y-4 text-sm text-zinc-300 leading-relaxed">
            <div className="rounded-2xl border border-white/[0.06] bg-white/[0.03] p-4">
              <div className="font-bold text-zinc-100 mb-1">{t("devicePair.step1")}</div>
              <p>{t("devicePair.step1Body")}</p>
            </div>
            <div className="rounded-2xl border border-white/[0.06] bg-white/[0.03] p-4">
              <div className="font-bold text-zinc-100 mb-1">{t("devicePair.step2")}</div>
              <p>{t("devicePair.step2Body")}</p>
            </div>
            <div className="rounded-2xl border border-white/[0.06] bg-white/[0.03] p-4">
              <div className="font-bold text-zinc-100 mb-1">{t("devicePair.step3")}</div>
              <p>{t("devicePair.step3Body")}</p>
            </div>
          </div>
        </section>

        <section className="rounded-[28px] border border-white/[0.08] bg-[#0b111a] p-6 flex flex-col items-center justify-center min-h-[520px]">
          {error && session ? (
            <div className="text-red-300 text-sm bg-red-500/10 border border-red-500/20 rounded-2xl p-4 mb-4 w-full">
              {error}
            </div>
          ) : null}

          {error && !session ? (
            <div className="w-full text-center">
              <div className="mx-auto mb-5 flex h-16 w-16 items-center justify-center rounded-3xl border border-amber-400/20 bg-amber-500/10">
                <AlertTriangle className="h-7 w-7 text-amber-300" />
              </div>
              <h2 className="text-xl font-bold">{hasDetectedPhoneCandidate ? t("devicePair.detectedButQrFailedTitle") : t("devicePair.noReachableTitle")}</h2>
              <p className="mx-auto mt-3 max-w-sm text-sm leading-relaxed text-zinc-400">
                {hasDetectedPhoneCandidate ? t("devicePair.detectedButQrFailedBody") : t("devicePair.noReachableBody")}
              </p>
              {createErrorDetail ? (
                <div className="mt-4 rounded-2xl border border-red-400/20 bg-red-500/10 p-3 text-left text-xs leading-relaxed text-red-100">
                  {createErrorDetail}
                </div>
              ) : null}
              {eligibleCandidates.length ? (
                <details className="mt-5 rounded-2xl border border-white/[0.06] bg-white/[0.03] p-4 text-left text-xs text-zinc-400">
                  <summary className="cursor-pointer font-bold text-zinc-200">{t("devicePair.detectedOnlyTitle")}</summary>
                  <div className="mt-2 space-y-2">
                    {eligibleCandidates.slice(0, 3).map((candidate) => (
                      <div key={candidate.id} className="rounded-xl bg-black/20 p-2">
                        <div className="font-semibold text-zinc-200">{candidate.label}</div>
                        <div className="mt-1 break-all font-mono text-zinc-500">{candidate.baseUrl}</div>
                        {candidate.requiresRestart ? <div className="mt-1 text-amber-100/80">{t("devicePair.candidateNeedsRestartHint")}</div> : null}
                      </div>
                    ))}
                  </div>
                </details>
              ) : null}
              <div className="mt-6 grid gap-3">
                <a href="/admin/settings#mobile-connect" className="inline-flex items-center justify-center gap-2 rounded-xl bg-cyan-500 px-4 py-3 text-sm font-bold text-[#061016]">
                  {t("devicePair.openConnectionGuide")}
                </a>
                <button
                  onClick={() => createSession()}
                  className="inline-flex items-center justify-center gap-2 rounded-xl border border-white/[0.08] bg-white/[0.03] px-4 py-3 text-sm font-bold text-zinc-200"
                >
                  <RefreshCw className="h-4 w-4" />
                  {t("devicePair.retryDiagnostics")}
                </button>
              </div>
            </div>
          ) : confirmedDevice ? (
            <div className="text-center">
              <CheckCircle2 className="w-16 h-16 text-emerald-300 mx-auto mb-5" />
              <h2 className="text-xl font-bold">{t("devicePair.successTitle")}</h2>
              <p className="text-sm text-zinc-400 mt-2">{t("devicePair.successBody", { name: confirmedDevice.name })}</p>
              <a href="/admin/dashboard" className="inline-flex mt-8 px-5 py-3 rounded-xl bg-cyan-500 text-[#061016] font-bold">
                {t("devicePair.viewConsole")}
              </a>
            </div>
          ) : session ? (
            <>
              {expiresIn > 0 ? (
                <div className="bg-white p-4 rounded-3xl mb-5">
                  <QRCodeSVG value={session.pairingUrl} size={260} />
                </div>
              ) : (
                <div aria-live="polite" className="mb-5 w-full rounded-2xl border border-amber-400/25 bg-amber-500/10 p-5 text-center">
                  <AlertTriangle className="mx-auto h-8 w-8 text-amber-300" />
                  <div className="mt-3 font-bold text-amber-100">{t("devicePair.expired")}</div>
                  <div className="mt-1 text-sm leading-relaxed text-amber-100/75">{t("devicePair.expiredBody")}</div>
                </div>
              )}
              <div className="flex items-center gap-2 text-sm text-zinc-400 mb-5">
                <Smartphone className="w-4 h-4" />
                {t("devicePair.qrExpires", { value: expiresIn > 0 ? t("devicePair.expiresIn", { seconds: expiresIn }) : t("devicePair.expired") })}
              </div>
              {pairingBaseUrl ? (
                <div className="mb-4 w-full rounded-2xl border border-white/[0.06] bg-white/[0.03] p-3 text-xs text-zinc-400">
                  <div className="flex flex-wrap items-center justify-center gap-2">
                    <span className="font-bold text-zinc-200">{t("devicePair.autoSelected")}</span>
                    {activeCandidate ? (
                      <>
                        <span className={`rounded-full px-2 py-0.5 text-[10px] font-bold ${activeCandidate.secure ? "bg-emerald-500/15 text-emerald-200" : "bg-amber-500/15 text-amber-100"}`}>
                          {activeCandidate.secure ? t("connection.secureRecommended") : t("connection.trustedNetworkOnly")}
                        </span>
                        {activeCandidate.requiresRestart ? <span className="rounded-full bg-blue-500/15 px-2 py-0.5 text-[10px] font-bold text-blue-100">{t("connection.restartBadge")}</span> : null}
                        <span className={`rounded-full px-2 py-0.5 text-[10px] font-bold ${activeCandidate.stability === "stable" ? "bg-emerald-500/15 text-emerald-200" : activeCandidate.stability === "temporary" ? "bg-amber-500/15 text-amber-100" : "bg-zinc-500/15 text-zinc-300"}`}>
                          {activeCandidate.stability === "stable" ? t("connection.stableAddress") : activeCandidate.stability === "temporary" ? t("connection.temporaryAddress") : t("connection.localAddress")}
                        </span>
                      </>
                    ) : null}
                  </div>
                  <div className="mt-2 text-center">{t("devicePair.currentAddress")}<span className="font-mono text-cyan-200">{pairingBaseUrl}</span></div>
                  {activeCandidate ? (
                    <div className="mt-2 text-center text-zinc-500">
                      {activeCandidateLabel} · {activeCandidateNote}
                    </div>
                  ) : null}
                  {activeCandidate?.mode === "tailscale" ? (
                    <div className="mt-3 rounded-xl border border-cyan-400/20 bg-cyan-500/10 p-3 text-left leading-relaxed text-cyan-50">
                      <div className="flex items-center gap-2 font-bold">
                        <Smartphone className="h-4 w-4" />
                        {t("devicePair.tailscalePhoneRequiredTitle")}
                      </div>
                      <div className="mt-1 text-cyan-50/80">{t("devicePair.tailscalePhoneRequiredBody")}</div>
                    </div>
                  ) : null}
                  {activeCandidate?.stability === "temporary" ? (
                    <div className="mt-3 rounded-xl border border-amber-400/20 bg-amber-500/10 p-2 text-left leading-relaxed text-amber-100">
                      <div className="font-bold">{t("devicePair.temporaryTitle")}</div>
                      <div className="mt-1 text-amber-100/75">{t("devicePair.temporaryBody")}</div>
                    </div>
                  ) : null}
                  {activeCandidate?.requiresRestart ? (
                    <div className="mt-3 rounded-xl border border-blue-400/20 bg-blue-500/10 p-2 text-left">
                      <div className="font-bold text-blue-100">{t("devicePair.restartTitle")}</div>
                      <div className="mt-1 text-blue-100/75">
                        {activeCandidate.requiresRestart ? t("devicePair.restartInstruction") : t("devicePair.addressAlreadyActive")}
                      </div>
                      <div className="mt-2 rounded-lg bg-black/15 p-2 font-mono text-[10px] leading-relaxed text-blue-100/80">{activeCandidate.envTemplate}</div>
                      <button
                        aria-label={t("devicePair.copyEnvAria")}
                        onClick={async () => {
                          await navigator.clipboard.writeText(activeCandidate.envTemplate).catch(() => null);
                          setCopiedEnv(true);
                          window.setTimeout(() => setCopiedEnv(false), 1200);
                        }}
                        className="mt-2 inline-flex w-full items-center justify-center gap-2 rounded-lg border border-blue-100/20 bg-[#061016]/35 px-3 py-2 text-xs font-bold text-blue-50"
                      >
                        <Copy className="h-3.5 w-3.5" />
                        {copiedEnv ? t("devicePair.copiedEnv") : t("devicePair.copyEnv")}
                      </button>
                    </div>
                  ) : null}
                  <button
                    onClick={() => handleTestPairingAddress()}
                    disabled={testingConnection}
                    className="mt-3 inline-flex w-full items-center justify-center gap-2 rounded-xl border border-cyan-400/20 bg-cyan-500/10 px-3 py-2 text-xs font-bold text-cyan-200 disabled:opacity-50"
                  >
                    <PlugZap className="h-3.5 w-3.5" />
                    {testingConnection ? t("connection.testing") : t("devicePair.testCurrent")}
                  </button>
                  {connectionTestResult ? <DevicePairConnectionTestResult result={connectionTestResult} /> : null}
                </div>
              ) : null}
              {expiresIn > 0 ? (
                <button
                  onClick={async () => {
                    await navigator.clipboard.writeText(session.pairingUrl).catch(() => null);
                    setCopied(true);
                    window.setTimeout(() => setCopied(false), 1200);
                  }}
                  className="w-full flex items-center justify-center gap-2 rounded-xl border border-white/[0.08] bg-white/[0.03] py-3 text-sm font-bold text-zinc-200 hover:bg-white/[0.06]"
                >
                  <Copy className="w-4 h-4" />
                  {copied ? t("devicePair.copiedLink") : t("devicePair.copyLink")}
                </button>
              ) : null}
              <button
                onClick={() => createSession()}
                className={`w-full flex items-center justify-center gap-2 rounded-xl border py-3 text-sm font-bold ${
                  expiresIn > 0
                    ? "mt-3 border-cyan-400/20 bg-cyan-500/10 text-cyan-200 hover:bg-cyan-500/15"
                    : "border-cyan-300 bg-cyan-400 text-[#061016] hover:bg-cyan-300"
                }`}
              >
                <RefreshCw className="w-4 h-4" />
                {t("devicePair.regenerate")}
              </button>
            </>
          ) : (
            <div className="flex items-center gap-2 text-zinc-400">
              <Loader2 className="w-4 h-4 animate-spin" />
              {t("devicePair.creating")}
            </div>
          )}
        </section>
      </div>
    </div>
  );
}
