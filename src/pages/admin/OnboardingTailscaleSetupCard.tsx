import { CheckCircle2, Copy, Download, ExternalLink, Loader2, Play, ShieldCheck } from "lucide-react";
import type { NetworkDiagnostics } from "../../services/lifeosApi";
import { useI18n } from "../../i18n/I18nProvider";

export default function OnboardingTailscaleSetupCard({
  busy,
  diagnostics,
  onInstall,
  onStartServe,
}: {
  busy: string | null;
  diagnostics: NetworkDiagnostics | null;
  onInstall: () => void;
  onStartServe: () => void;
}) {
  const { t } = useI18n();
  const tailscale = diagnostics?.tailscale;
  const installCommand = tailscale?.installCommand || "brew install --cask tailscale-app";
  const installUrl = tailscale?.installUrl || "https://tailscale.com/download";
  const canAutoInstall = Boolean(tailscale?.autoInstall?.available && !tailscale.installed);
  const canStartServe = Boolean(tailscale?.installed && tailscale.online && tailscale.magicDnsEnabled && tailscale.httpsServeReady);
  const setupDone = Boolean(tailscale?.serveRunning && tailscale.httpsServeUrl);

  const copyInstallCommand = async () => {
    await navigator.clipboard.writeText(installCommand).catch(() => null);
  };

  const copyLoginCommand = async () => {
    await navigator.clipboard.writeText(tailscale?.loginCommand || "tailscale up").catch(() => null);
  };

  return (
    <section className="mt-5 rounded-2xl border border-blue-400/20 bg-blue-500/10 p-4">
      <div className="flex items-start gap-3">
        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl border border-blue-300/20 bg-blue-400/10">
          <ShieldCheck className="h-5 w-5 text-blue-100" />
        </div>
        <div>
          <div className="text-sm font-bold text-blue-50">{t("onboarding.tailscaleTitle")}</div>
          <p className="mt-1 text-xs leading-relaxed text-blue-100/75">{t("onboarding.tailscaleBody")}</p>
        </div>
      </div>

      <div className="mt-4 grid gap-2 text-xs sm:grid-cols-3">
        <StatusPill ok={Boolean(tailscale?.installed)} label={t("onboarding.tailscaleStepInstall")} />
        <StatusPill ok={Boolean(tailscale?.online)} label={t("onboarding.tailscaleStepLogin")} />
        <StatusPill ok={setupDone} label={t("onboarding.tailscaleStepServe")} />
      </div>

      {setupDone ? (
        <div className="mt-4 rounded-xl border border-emerald-400/20 bg-emerald-500/10 p-3 text-xs leading-relaxed text-emerald-100">
          {t("onboarding.tailscaleReady", { url: tailscale?.httpsServeUrl || "-" })}
        </div>
      ) : null}

      {!tailscale?.installed ? (
        <div className="mt-4 grid gap-2 sm:grid-cols-2">
          <button
            onClick={onInstall}
            disabled={!canAutoInstall || busy === "tailscale-install"}
            className="inline-flex items-center justify-center gap-2 rounded-xl border border-blue-100/20 bg-[#061016]/35 px-3 py-2 text-xs font-bold text-blue-50 disabled:opacity-50"
          >
            {busy === "tailscale-install" ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Download className="h-3.5 w-3.5" />}
            {canAutoInstall ? t("onboarding.tailscaleAutoInstall") : t("onboarding.tailscaleAutoUnavailable")}
          </button>
          <a
            href={installUrl}
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center justify-center gap-2 rounded-xl border border-blue-100/20 bg-[#061016]/35 px-3 py-2 text-xs font-bold text-blue-50"
          >
            <ExternalLink className="h-3.5 w-3.5" />
            {t("onboarding.tailscaleOpenDownload")}
          </a>
          <button
            onClick={copyInstallCommand}
            className="sm:col-span-2 inline-flex items-center justify-center gap-2 rounded-xl border border-blue-100/20 bg-[#061016]/35 px-3 py-2 text-xs font-bold text-blue-50"
          >
            <Copy className="h-3.5 w-3.5" />
            {t("onboarding.tailscaleCopyInstall", { command: installCommand })}
          </button>
          <div className="sm:col-span-2 rounded-xl border border-amber-400/20 bg-amber-500/10 p-3 text-xs leading-relaxed text-amber-100">
            {tailscale?.autoInstall?.reason === "homebrew-missing"
              ? t("onboarding.tailscaleHomebrewMissing")
              : t("onboarding.tailscaleInstallSafeNote")}
          </div>
        </div>
      ) : !tailscale.online ? (
        <div className="mt-4 grid gap-2 sm:grid-cols-2">
          <a
            href="tailscale://"
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center justify-center gap-2 rounded-xl border border-blue-100/20 bg-[#061016]/35 px-3 py-2 text-xs font-bold text-blue-50"
          >
            <ExternalLink className="h-3.5 w-3.5" />
            {t("onboarding.tailscaleOpenApp")}
          </a>
          <button onClick={copyLoginCommand} className="inline-flex items-center justify-center gap-2 rounded-xl border border-blue-100/20 bg-[#061016]/35 px-3 py-2 text-xs font-bold text-blue-50">
            <Copy className="h-3.5 w-3.5" />
            {t("onboarding.tailscaleCopyLogin")}
          </button>
        </div>
      ) : (
        <button
          onClick={onStartServe}
          disabled={!canStartServe || busy === "remote-tailscale"}
          className="mt-4 inline-flex w-full items-center justify-center gap-2 rounded-xl border border-emerald-400/20 bg-emerald-500/10 px-3 py-2 text-xs font-bold text-emerald-100 disabled:opacity-50"
        >
          {busy === "remote-tailscale" ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Play className="h-3.5 w-3.5" />}
          {canStartServe ? t("onboarding.tailscaleStartServe") : t("onboarding.tailscaleServeNeedsMagicDns")}
        </button>
      )}
    </section>
  );
}

function StatusPill({ ok, label }: { ok: boolean; label: string }) {
  return (
    <div className={`flex items-center gap-2 rounded-xl border px-3 py-2 ${ok ? "border-emerald-400/20 bg-emerald-500/10 text-emerald-100" : "border-white/[0.08] bg-[#061016]/35 text-blue-100/75"}`}>
      <CheckCircle2 className={`h-3.5 w-3.5 ${ok ? "text-emerald-200" : "text-zinc-500"}`} />
      <span className="font-bold">{label}</span>
    </div>
  );
}
