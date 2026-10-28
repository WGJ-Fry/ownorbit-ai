import { useEffect, useMemo, useState } from "react";
import { CheckCircle2, Loader2, RefreshCw, ShieldCheck, Smartphone, XCircle } from "lucide-react";
import { confirmBinding, confirmDeviceMigration, reportMobileConnectivity, saveStoredDeviceCredential } from "../../services/lifeosApi";
import { isDeviceSignatureAvailable } from "../../services/deviceKeyStore";
import { testMobileRemoteConnectivity } from "../../services/pwaCapabilities";
import type { MobileConnectivityResult } from "../../services/pwaCapabilities";
import {
  clearPendingPairingToken,
  consumePendingPairingTokenAsync,
  extractPairingToken,
  pairingInstallPath,
  resolvePairingInputDestination,
  savePendingPairingToken,
  setPairingManifestToken,
} from "../../services/mobilePairingIntent";
import { getMobilePairingErrorCopy } from "../../services/mobilePairingErrors";
import type { MobilePairingErrorCopy } from "../../services/mobilePairingErrors";
import { useI18n } from "../../i18n/I18nProvider";
import MobileConnectivityCard from "./MobileConnectivityCard";
import { handleMobileIcloudHandoffLaunch } from "../../services/mobileIcloudHandoff";

function extractMigrationToken(raw: string) {
  try {
    const parsed = new URL(raw, window.location.origin);
    const value = String(parsed.searchParams.get("migrate") || "").trim();
    return /^migrate_[A-Za-z0-9_-]{16,64}$/.test(value) ? value : "";
  } catch {
    return "";
  }
}

// The voucher is single-use and redemption rotates the device credential
// server-side, so the redeem request must run exactly once per token even
// when React StrictMode mounts the effect twice. The credential is also saved
// inside this shared promise: a cancelled first mount must never discard an
// already-rotated credential.
let migrationRedeemInFlight: { token: string; promise: Promise<Awaited<ReturnType<typeof confirmDeviceMigration>>> } | null = null;

function redeemMigrationOnce(token: string) {
  if (migrationRedeemInFlight?.token !== token) {
    migrationRedeemInFlight = {
      token,
      promise: confirmDeviceMigration(token).then(async (credential) => {
        await saveStoredDeviceCredential(credential);
        return credential;
      }),
    };
  }
  return migrationRedeemInFlight.promise;
}

export default function MobilePairPage() {
  const { t } = useI18n();
  const token = useMemo(() => extractPairingToken(window.location.href), []);
  const migrationToken = useMemo(() => extractMigrationToken(window.location.href), []);
  const [deviceName, setDeviceName] = useState(() => {
    const platform = navigator.platform || "Mobile";
    return t("mobilePair.defaultDeviceName", { platform });
  });
  const [status, setStatus] = useState<"idle" | "binding" | "bound" | "error">("idle");
  const [error, setError] = useState<MobilePairingErrorCopy | null>(null);
  const [pairingLinkInput, setPairingLinkInput] = useState("");
  const [connectivityTest, setConnectivityTest] = useState<MobileConnectivityResult | null>(null);
  const [connectivityBusy, setConnectivityBusy] = useState(false);
  const signatureAvailable = isDeviceSignatureAvailable();

  useEffect(() => {
    void handleMobileIcloudHandoffLaunch();
  }, []);

  // Arriving with a migration voucher: redeem it immediately — the user
  // already confirmed the move on the old origin. On failure fall back to the
  // normal QR flow with actionable copy.
  useEffect(() => {
    if (!migrationToken) return;
    let cancelled = false;
    setStatus("binding");
    // redeemMigrationOnce dedupes the request across StrictMode double-mounts
    // and persists the credential inside the shared promise, so `cancelled`
    // only ever gates UI state — never the save of a rotated credential.
    redeemMigrationOnce(migrationToken)
      .then(() => {
        if (cancelled) return;
        window.history.replaceState(null, "", "/mobile/pair");
        setStatus("bound");
        setConnectivityBusy(true);
        testMobileRemoteConnectivity()
          .then(async (result) => {
            if (cancelled) return;
            setConnectivityTest(result);
            await reportMobileConnectivity(result).catch(() => null);
          })
          .catch(() => null)
          .finally(() => {
            if (!cancelled) setConnectivityBusy(false);
          });
      })
      .catch((err: any) => {
        if (cancelled) return;
        setError(getMobilePairingErrorCopy(err));
        setStatus("error");
      });
    return () => {
      cancelled = true;
    };
  }, [migrationToken]);

  useEffect(() => {
    if (migrationToken) return;
    if (!token) {
      let cancelled = false;
      void consumePendingPairingTokenAsync().then((pendingToken) => {
        if (cancelled || !pendingToken) return;
        savePendingPairingToken(pendingToken);
        window.location.replace(pairingInstallPath(pendingToken));
      });
      return () => {
        cancelled = true;
      };
    }
    savePendingPairingToken(token);
    const installPath = pairingInstallPath(token);
    if (window.location.pathname !== installPath) {
      window.history.replaceState(null, "", installPath);
    }
    return setPairingManifestToken(token);
  }, [token, migrationToken]);

  const handleConfirm = async () => {
    if (!token || !deviceName.trim()) return;
    setStatus("binding");
    setError(null);
    try {
      const credential = await confirmBinding(token, deviceName.trim());
      await saveStoredDeviceCredential(credential);
      clearPendingPairingToken();
      setStatus("bound");
      setConnectivityBusy(true);
      testMobileRemoteConnectivity()
        .then(async (result) => {
          setConnectivityTest(result);
          await reportMobileConnectivity(result).catch(() => null);
        })
        .catch(() => null)
        .finally(() => setConnectivityBusy(false));
    } catch (err: any) {
      setError(getMobilePairingErrorCopy(err));
      setStatus("error");
    }
  };

  const handlePairingLinkSubmit = () => {
    const destination = resolvePairingInputDestination(pairingLinkInput, window.location.origin);
    if (!destination) {
      setError({
        titleKey: "mobilePair.recoveryInvalidTitle",
        bodyKey: "mobilePair.recoveryInvalidBody",
      });
      return;
    }
    // An intent saved here only helps a pairing on this origin; another
    // origin reads the token from the link itself.
    if (!destination.crossOrigin) savePendingPairingToken(destination.token);
    window.location.assign(destination.href);
  };

  const handleConnectivityTest = async () => {
    setConnectivityBusy(true);
    try {
      const result = await testMobileRemoteConnectivity();
      setConnectivityTest(result);
      await reportMobileConnectivity(result).catch(() => null);
    } finally {
      setConnectivityBusy(false);
    }
  };

  return (
    <div className="min-h-screen bg-[#060a10] text-zinc-100 flex items-center justify-center p-5">
      <div className="w-full max-w-sm rounded-[28px] border border-white/[0.08] bg-[#101722] p-6 shadow-2xl">
        {status === "bound" ? (
          <div className="text-center py-8">
            <CheckCircle2 className="w-16 h-16 text-emerald-300 mx-auto mb-5" />
            <h1 className="text-xl font-bold">{t("mobilePair.doneTitle")}</h1>
            <p className="text-sm text-zinc-400 mt-2">{t("mobilePair.doneBody")}</p>
            <div className="mt-5 rounded-2xl border border-emerald-400/20 bg-emerald-500/10 p-4 text-left text-xs leading-relaxed text-emerald-100/80">
              {t("mobilePair.homeScreenHint")}
            </div>
            <button
              onClick={handleConnectivityTest}
              disabled={connectivityBusy}
              className="mt-5 inline-flex w-full items-center justify-center gap-2 rounded-xl border border-cyan-400/20 bg-cyan-500/10 px-4 py-3 text-sm font-bold text-cyan-200 disabled:opacity-50"
            >
              <RefreshCw className="h-4 w-4" />
              {connectivityBusy ? t("mobilePair.connectivityTesting") : t("mobilePair.connectivityTest")}
            </button>
            {connectivityTest ? <MobileConnectivityCard result={connectivityTest} onRetry={handleConnectivityTest} /> : null}
            <a href="/mobile/chat" className="mt-8 inline-flex w-full justify-center rounded-xl bg-cyan-500 py-3 font-bold text-[#061016]">
              {t("mobilePair.enterMobileAi")}
            </a>
          </div>
        ) : migrationToken && status === "binding" ? (
          // Migration in flight: never show the missing-QR error or the
          // recovery form — its hard navigation would unload the page while
          // the single-use voucher is being redeemed.
          <div className="text-center py-8">
            <Loader2 className="w-12 h-12 animate-spin text-cyan-300 mx-auto mb-5" />
            <h1 className="text-xl font-bold">{t("mobilePair.migratingTitle")}</h1>
            <p className="text-sm text-zinc-400 mt-2">{t("mobilePair.migratingBody")}</p>
          </div>
        ) : (
          <>
            <div className="w-12 h-12 rounded-2xl bg-cyan-500/10 border border-cyan-400/20 flex items-center justify-center mb-5">
              <Smartphone className="w-5 h-5 text-cyan-300" />
            </div>
            <h1 className="text-xl font-bold">{t("mobilePair.confirmTitle")}</h1>
            <p className="text-sm text-zinc-400 mt-2 leading-relaxed">
              {t("mobilePair.confirmBody")}
            </p>
            <div className="mt-5 rounded-2xl border border-amber-400/20 bg-amber-500/10 p-4 text-xs leading-relaxed text-amber-100/80">
              {t("mobilePair.installFirstHint")}
            </div>

            {!token && (
              <div className="mt-5 rounded-2xl border border-red-500/20 bg-red-500/10 p-4 text-sm text-red-200 flex gap-2">
                <XCircle className="w-4 h-4 mt-0.5 flex-shrink-0" />
                {t("mobilePair.missingToken")}
              </div>
            )}

            {error && (
              <div className="mt-5 rounded-2xl border border-red-500/20 bg-red-500/10 p-4 text-sm text-red-100">
                <div className="flex gap-2">
                  <XCircle className="mt-0.5 h-4 w-4 flex-shrink-0" />
                  <div>
                    <div className="font-bold">{t(error.titleKey)}</div>
                    <div className="mt-1 text-red-100/75">{t(error.bodyKey)}</div>
                  </div>
                </div>
              </div>
            )}

            {(!token || error) && (
              <div className="mt-5 rounded-2xl border border-white/[0.06] bg-white/[0.03] p-4">
                <div className="text-sm font-bold text-zinc-100">{t("mobilePair.recoveryTitle")}</div>
                <p className="mt-1 text-xs leading-relaxed text-zinc-400">{t("mobilePair.recoveryBody")}</p>
                <input
                  value={pairingLinkInput}
                  onChange={(event) => setPairingLinkInput(event.target.value)}
                  className="mt-3 w-full rounded-xl border border-white/[0.08] bg-[#060a10] px-4 py-3 text-sm outline-none focus:border-cyan-400/60"
                  placeholder={t("mobilePair.recoveryPlaceholder")}
                />
                <button
                  type="button"
                  onClick={handlePairingLinkSubmit}
                  className="mt-3 w-full rounded-xl border border-cyan-400/20 bg-cyan-500/10 px-4 py-3 text-sm font-bold text-cyan-200"
                >
                  {t("mobilePair.recoverySubmit")}
                </button>
              </div>
            )}

            <label className="block mt-6 text-xs font-bold text-zinc-500 uppercase tracking-wider">{t("mobilePair.deviceName")}</label>
            <input
              value={deviceName}
              onChange={(event) => setDeviceName(event.target.value)}
              className="mt-2 w-full rounded-xl border border-white/[0.08] bg-[#060a10] px-4 py-3 text-sm outline-none focus:border-cyan-400/60"
              placeholder={t("mobilePair.placeholder")}
            />

            <div className="mt-5 rounded-2xl border border-white/[0.06] bg-white/[0.03] p-4 flex gap-3">
              <ShieldCheck className="w-5 h-5 text-emerald-300 flex-shrink-0 mt-0.5" />
              <div>
                <div className="text-sm font-bold">{signatureAvailable ? t("mobilePair.securityTip") : t("mobilePair.lanCompatMode")}</div>
                <p className="text-xs text-zinc-400 mt-1 leading-relaxed">
                  {signatureAvailable
                    ? t("mobilePair.securityBody")
                    : t("mobilePair.lanCompatBody")}
                </p>
              </div>
            </div>

            <button
              onClick={handleConfirm}
              disabled={!token || !deviceName.trim() || status === "binding"}
              className="mt-6 w-full rounded-xl bg-cyan-500 py-3 font-bold text-[#061016] disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
            >
              {status === "binding" && <Loader2 className="w-4 h-4 animate-spin" />}
              {t("mobilePair.confirmButton")}
            </button>
          </>
        )}
      </div>
    </div>
  );
}
