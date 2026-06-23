import { useEffect, useState } from "react";
import { Command, Download, Link2, RefreshCw, ShieldCheck, Smartphone, X } from "lucide-react";
import App from "../../App";
import { useLifeOSRealtime } from "../../hooks/useLifeOSRealtime";
import { getMobilePairingIntent, getStoredDeviceCredential, getStoredDeviceCredentialAsync } from "../../services/lifeosApi";
import { consumePendingPairingToken, extractPairingToken, pairingInstallPath, peekPendingPairingToken, savePendingPairingToken, setPairingManifestToken } from "../../services/mobilePairingIntent";
import { loadMobileInstallHintDismissed, saveMobileInstallHintDismissed } from "../../services/mobileInstallHintStorage";
import LanguageSwitcher from "../../i18n/LanguageSwitcher";
import { useI18n } from "../../i18n/I18nProvider";
import type { TranslationKey } from "../../i18n/translations";

const STATUS_CLASS = {
  unbound: "border-amber-400/20 bg-amber-500/10 text-amber-200",
  connecting: "border-cyan-400/20 bg-cyan-500/10 text-cyan-200",
  connected: "border-emerald-400/20 bg-emerald-500/10 text-emerald-200",
  offline: "border-red-400/20 bg-red-500/10 text-red-200",
};

export default function MobileChatPage() {
  const { t } = useI18n();
  const { lastError, lastEventAt, nextReconnectAt, retryAttempt, status } = useLifeOSRealtime();
  const [credential, setCredential] = useState(() => getStoredDeviceCredential());
  const [loadedCredential, setLoadedCredential] = useState(Boolean(credential));
  const [pairingInput, setPairingInput] = useState("");
  const [pairingInputError, setPairingInputError] = useState<string | null>(null);
  const [installPrompt, setInstallPrompt] = useState<any>(null);
  const [installHintDismissed, setInstallHintDismissed] = useState(() => loadMobileInstallHintDismissed());
  const [recoveringPairingIntent, setRecoveringPairingIntent] = useState(() => Boolean(peekPendingPairingToken()));
  const isStandalone =
    window.matchMedia("(display-mode: standalone)").matches || Boolean((window.navigator as any).standalone);
  const shouldShowInstallHint = !isStandalone && !installHintDismissed;
  const launchPairingToken = extractPairingToken(new URLSearchParams(window.location.search).get("pairingToken") || "");

  useEffect(() => {
    let cancelled = false;
    getStoredDeviceCredentialAsync()
      .then((next) => {
        if (!cancelled) setCredential(next);
      })
      .finally(() => {
        if (!cancelled) setLoadedCredential(true);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    const handleBeforeInstallPrompt = (event: Event) => {
      event.preventDefault();
      setInstallPrompt(event);
    };
    window.addEventListener("beforeinstallprompt", handleBeforeInstallPrompt);
    return () => window.removeEventListener("beforeinstallprompt", handleBeforeInstallPrompt);
  }, []);

  useEffect(() => {
    if (!loadedCredential || credential) return;
    const pendingPairingToken = launchPairingToken || consumePendingPairingToken();
    if (pendingPairingToken) {
      setRecoveringPairingIntent(true);
      savePendingPairingToken(pendingPairingToken);
      window.location.replace(pairingInstallPath(pendingPairingToken));
    }
  }, [credential, launchPairingToken, loadedCredential]);

  useEffect(() => {
    if (!loadedCredential || credential || launchPairingToken) return;
    let cancelled = false;
    getMobilePairingIntent()
      .then((intent) => {
        if (cancelled) return;
        const token = extractPairingToken(intent.token || "");
        if (!token) {
          setRecoveringPairingIntent(false);
          return;
        }
        setRecoveringPairingIntent(true);
        savePendingPairingToken(token);
        window.location.replace(pairingInstallPath(token));
      })
      .catch(() => {
        if (!cancelled) setRecoveringPairingIntent(false);
      });
    return () => {
      cancelled = true;
    };
  }, [credential, launchPairingToken, loadedCredential]);

  useEffect(() => {
    if (!launchPairingToken) return undefined;
    savePendingPairingToken(launchPairingToken);
    return setPairingManifestToken(launchPairingToken);
  }, [launchPairingToken]);

  useEffect(() => {
    if (!loadedCredential || !credential || !launchPairingToken) return;
    window.history.replaceState(null, "", "/mobile/chat");
  }, [credential, launchPairingToken, loadedCredential]);

  const handleInstall = async () => {
    if (!installPrompt) return;
    installPrompt.prompt();
    await installPrompt.userChoice.catch(() => null);
    setInstallPrompt(null);
  };

  const dismissInstallHint = () => {
    saveMobileInstallHintDismissed();
    setInstallHintDismissed(true);
  };

  const openPairingInput = () => {
    const raw = pairingInput.trim();
    let token = "";
    token = extractPairingToken(raw);
    if (!token) {
      setPairingInputError(t("mobile.pairingInvalid"));
      return;
    }
    window.location.href = pairingInstallPath(token);
  };

  if (!loadedCredential) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-[#060a10] px-5 py-8 text-zinc-100">
        <div className="rounded-2xl border border-white/[0.08] bg-white/[0.03] px-4 py-3 text-sm text-zinc-300">
          {t("mobile.loadingCredential")}
        </div>
      </div>
    );
  }

  if (!credential) {
    return (
      <div className="min-h-screen bg-[#060a10] text-zinc-100 px-5 py-8 flex items-center justify-center">
        <div className="w-full max-w-sm">
          <div className="w-14 h-14 rounded-2xl bg-cyan-500/10 border border-cyan-400/20 flex items-center justify-center mb-6">
            <Smartphone className="w-6 h-6 text-cyan-300" />
          </div>
          <div className="mb-4 flex justify-end">
            <LanguageSwitcher compact />
          </div>
          <h1 className="text-2xl font-bold tracking-tight">{t("mobile.title")}</h1>
          <p className="mt-3 text-sm leading-relaxed text-zinc-400">
            {recoveringPairingIntent
              ? t("mobile.recoveringPairing")
              : t("mobile.unboundDescription")}
          </p>

          <div className="mt-7 rounded-2xl border border-white/[0.08] bg-white/[0.03] p-4">
            <div className="flex gap-3">
              <ShieldCheck className="w-5 h-5 text-emerald-300 flex-shrink-0 mt-0.5" />
              <div>
                <div className="text-sm font-bold">{t("mobile.credentialSavedTitle")}</div>
                <p className="mt-1 text-xs leading-relaxed text-zinc-500">
                  {t("mobile.credentialSavedBody")}
                </p>
              </div>
            </div>
          </div>

          <div className="mt-6 rounded-2xl border border-white/[0.08] bg-white/[0.03] p-4">
            <label className="text-xs font-bold text-zinc-500">{t("mobile.pastePairing")}</label>
            <input
              value={pairingInput}
              onChange={(event) => {
                setPairingInput(event.target.value);
                setPairingInputError(null);
              }}
              className="mt-2 w-full rounded-xl border border-white/[0.08] bg-[#060a10] px-3 py-3 text-sm outline-none focus:border-cyan-400/60"
              placeholder={t("mobile.pairingPlaceholder")}
            />
            {pairingInputError ? <div className="mt-2 text-xs leading-relaxed text-red-200">{pairingInputError}</div> : null}
            <button
              onClick={openPairingInput}
              className="mt-3 inline-flex w-full items-center justify-center gap-2 rounded-xl bg-cyan-500 px-4 py-3 text-sm font-bold text-[#061016]"
            >
              <Link2 className="w-4 h-4" />
              {t("mobile.usePairingLink")}
            </button>
          </div>
          <button
            onClick={() => window.location.reload()}
            className="mt-3 inline-flex w-full items-center justify-center gap-2 rounded-xl border border-white/[0.08] bg-white/[0.03] px-4 py-3 text-sm font-bold text-zinc-200"
          >
            <RefreshCw className="w-4 h-4" />
            {t("mobile.refreshConnection")}
          </button>
        </div>
      </div>
    );
  }

  return (
    <>
      <div className={`fixed left-1/2 top-2 z-[100] max-w-[calc(100vw-6.5rem)] -translate-x-1/2 rounded-2xl border px-3 py-1 text-center text-[11px] font-bold backdrop-blur-xl ${STATUS_CLASS[status]}`}>
        <div>{t(`mobile.status.${status}` as TranslationKey)}</div>
        {status === "offline" && nextReconnectAt ? (
          <div className="mt-0.5 text-[10px] font-medium opacity-80">
            {t("mobile.realtimeNextRetry", { attempt: retryAttempt, time: new Date(nextReconnectAt).toLocaleTimeString() })}
          </div>
        ) : status === "connected" && lastEventAt ? (
          <div className="mt-0.5 text-[10px] font-medium opacity-80">
            {t("mobile.realtimeLastEvent", { time: new Date(lastEventAt).toLocaleTimeString() })}
          </div>
        ) : null}
        {status === "offline" && lastError ? <div className="mt-0.5 max-w-56 truncate text-[10px] font-medium opacity-75">{lastError}</div> : null}
      </div>
      <a
        href="/mobile/actions"
        className="fixed right-3 top-2 z-[100] flex h-8 w-8 items-center justify-center rounded-full border border-white/[0.12] bg-[#101722]/90 text-zinc-200 shadow-xl backdrop-blur-xl"
        title={t("mobile.localActions")}
      >
        <Command className="w-4 h-4 text-cyan-300" />
      </a>
      <a
        href="/mobile/device"
        className="fixed left-3 top-2 z-[100] flex h-8 w-8 items-center justify-center rounded-full border border-white/[0.12] bg-[#101722]/90 text-zinc-200 shadow-xl backdrop-blur-xl"
        title={t("mobile.deviceConnection")}
      >
        <Smartphone className="w-4 h-4 text-cyan-300" />
      </a>
      {shouldShowInstallHint && (
        <div className="fixed bottom-4 left-3 right-3 z-[100] mx-auto max-w-md rounded-2xl border border-white/[0.12] bg-[#101722]/95 p-3 text-xs text-zinc-200 shadow-2xl backdrop-blur-xl">
          <div className="flex items-start gap-3">
            <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border border-cyan-400/20 bg-cyan-500/10">
              <Download className="h-4 w-4 text-cyan-300" />
            </div>
            <div className="min-w-0 flex-1">
              <div className="font-bold text-zinc-100">{t("mobile.addHomeScreen")}</div>
              <div className="mt-1 leading-relaxed text-zinc-400">
                {installPrompt ? t("mobile.installReady") : t("mobile.installManual")}
              </div>
              {installPrompt ? (
                <button onClick={handleInstall} className="mt-3 inline-flex items-center gap-2 rounded-xl bg-cyan-500 px-3 py-2 font-bold text-[#061016]">
                  <Download className="h-3.5 w-3.5" />
                  {t("mobile.install")}
                </button>
              ) : null}
            </div>
            <button aria-label={t("mobile.closeInstallHint")} onClick={dismissInstallHint} className="flex h-8 w-8 shrink-0 items-center justify-center rounded-xl border border-white/[0.08] bg-white/[0.03] text-zinc-400">
              <X className="h-4 w-4" />
            </button>
          </div>
        </div>
      )}
      <App />
    </>
  );
}
