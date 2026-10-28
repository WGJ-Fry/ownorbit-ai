import { useEffect, useMemo, useState } from "react";
import { AlertTriangle, CheckCircle2, RefreshCw, ShieldCheck, Smartphone } from "lucide-react";
import {
  approveCloudKitChatDevice,
  getCloudKitChatDevices,
  getCloudKitDeviceTrustMetadata,
  revokeCloudKitChatDevice,
} from "../../../services/lifeosApi";
import type {
  CloudKitChatDeviceItem,
  CloudKitDeviceTrustMetadataItem,
  CloudKitDeviceTrustMetadataSummary,
} from "../../../services/lifeosApi";
import { useI18n } from "../../../i18n/I18nProvider";
import type { TranslationKey } from "../../../i18n/translations";

type DeviceTrustResponse = Awaited<ReturnType<typeof getCloudKitDeviceTrustMetadata>>["deviceTrust"];
type ChatDevicesResponse = Awaited<ReturnType<typeof getCloudKitChatDevices>>["devices"];

const nextActionKeys: Record<CloudKitDeviceTrustMetadataItem["nextAction"], TranslationKey> = {
  "rebind-device": "settings.cloudKitDeviceTrustNextRebind",
  "review-revoked-device": "settings.cloudKitDeviceTrustNextReviewRevoked",
  "keep-for-reference": "settings.cloudKitDeviceTrustNextKeep",
};

const reviewStatusKeys: Record<CloudKitDeviceTrustMetadataItem["reviewStatus"], TranslationKey> = {
  "needs-rebind": "settings.cloudKitDeviceTrustReviewNeedsRebind",
  reviewed: "settings.cloudKitDeviceTrustReviewReviewed",
  ignored: "settings.cloudKitDeviceTrustReviewIgnored",
};

function formatTime(value: number | null | undefined, locale: string) {
  if (!value) return "-";
  return new Intl.DateTimeFormat(locale, {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(value));
}

function TrustSummary({ summary }: { summary: CloudKitDeviceTrustMetadataSummary }) {
  const { t } = useI18n();
  const tone = summary.needsRebind > 0 ? "border-amber-400/20 bg-amber-500/10 text-amber-100" : "border-emerald-400/20 bg-emerald-500/10 text-emerald-100";
  const Icon = summary.needsRebind > 0 ? AlertTriangle : CheckCircle2;

  return (
    <div className={`flex flex-col gap-3 rounded-2xl border p-4 sm:flex-row sm:items-start sm:justify-between ${tone}`}>
      <div className="flex gap-3">
        <Icon className="mt-0.5 h-5 w-5 flex-shrink-0" />
        <div>
          <div className="text-sm font-bold">
            {summary.needsRebind > 0
              ? t("settings.cloudKitDeviceTrustNeedsRebind", { count: summary.needsRebind })
              : t("settings.cloudKitDeviceTrustReady")}
          </div>
          <div className="mt-1 text-xs opacity-75">{t("settings.cloudKitDeviceTrustSafeBoundary")}</div>
        </div>
      </div>
      <div className="grid grid-cols-3 gap-2 text-center text-xs sm:min-w-[220px]">
        <div>
          <div className="font-bold">{summary.total}</div>
          <div className="opacity-70">{t("settings.cloudKitDeviceTrustTotal")}</div>
        </div>
        <div>
          <div className="font-bold">{summary.revoked}</div>
          <div className="opacity-70">{t("settings.cloudKitDeviceTrustRevoked")}</div>
        </div>
        <div>
          <div className="font-bold">{summary.accessGranted}</div>
          <div className="opacity-70">{t("settings.cloudKitDeviceTrustGranted")}</div>
        </div>
      </div>
    </div>
  );
}

export default function CloudKitDeviceTrustPanel() {
  const { locale, t } = useI18n();
  const [deviceTrust, setDeviceTrust] = useState<DeviceTrustResponse | null>(null);
  const [chatDevices, setChatDevices] = useState<ChatDevicesResponse | null>(null);
  const [updatingDeviceId, setUpdatingDeviceId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refresh = async () => {
    setLoading(true);
    setError(null);
    try {
      const [trustResult, chatResult] = await Promise.all([
        getCloudKitDeviceTrustMetadata(20),
        getCloudKitChatDevices(20),
      ]);
      setDeviceTrust(trustResult.deviceTrust);
      setChatDevices(chatResult.devices);
    } catch (err: any) {
      setError(err?.message || t("settings.cloudKitDeviceTrustLoadFailed"));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void refresh();
  }, []);

  const newestApplied = useMemo(() => formatTime(deviceTrust?.summary.newestAppliedAt, locale), [deviceTrust?.summary.newestAppliedAt, locale]);

  const updateChatDevice = async (item: CloudKitChatDeviceItem, action: "approve" | "revoke") => {
    if (action === "revoke" && !window.confirm(t("settings.cloudKitChatDeviceRevokeConfirm"))) return;
    setUpdatingDeviceId(item.id);
    setError(null);
    try {
      if (action === "approve") await approveCloudKitChatDevice(item.id);
      else await revokeCloudKitChatDevice(item.id);
      await refresh();
    } catch (err: any) {
      setError(err?.message || t("settings.cloudKitChatDeviceUpdateFailed"));
    } finally {
      setUpdatingDeviceId(null);
    }
  };

  return (
    <section id="cloudkit-device-trust" className="mb-6 rounded-[28px] border border-white/[0.08] bg-[#101722] p-5">
      <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="flex gap-3">
          <div className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-2xl border border-cyan-400/20 bg-cyan-500/10 text-cyan-300">
            <ShieldCheck className="h-5 w-5" />
          </div>
          <div>
            <h2 className="font-bold">{t("settings.cloudKitDeviceTrustTitle")}</h2>
            <p className="mt-1 max-w-2xl text-sm text-zinc-400">{t("settings.cloudKitDeviceTrustDescription")}</p>
            <p className="mt-2 text-xs text-zinc-500">{t("settings.cloudKitDeviceTrustNewest", { time: newestApplied })}</p>
          </div>
        </div>
        <button
          onClick={refresh}
          disabled={loading}
          className="inline-flex items-center justify-center gap-2 rounded-xl border border-white/[0.08] bg-white/[0.03] px-4 py-2 text-sm font-bold disabled:cursor-not-allowed disabled:opacity-60"
        >
          <RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} />
          {t("common.refresh")}
        </button>
      </div>

      {error ? <div className="mb-4 rounded-2xl border border-red-500/20 bg-red-500/10 p-4 text-sm text-red-200">{error}</div> : null}

      {chatDevices && chatDevices.items.length > 0 ? (
        <div className="mb-4 space-y-3">
          {chatDevices.summary.pending > 0 ? (
            <div className="rounded-2xl border border-amber-400/20 bg-amber-500/10 p-4 text-sm text-amber-100">
              <div className="font-bold">{t("settings.cloudKitChatDevicePending", { count: chatDevices.summary.pending })}</div>
              <div className="mt-1 text-xs text-amber-100/75">{t("settings.cloudKitChatDevicePendingBody")}</div>
            </div>
          ) : null}
          {chatDevices.items.map((item) => (
            <div key={item.id} className="flex flex-col gap-3 rounded-2xl border border-white/[0.08] bg-black/20 p-4 sm:flex-row sm:items-center sm:justify-between">
              <div className="flex items-center gap-3">
                <Smartphone className="h-5 w-5 text-cyan-300" />
                <div>
                  <div className="font-bold text-zinc-100">{item.displayName}</div>
                  <div className="mt-1 text-xs text-zinc-500">
                    {t(`settings.cloudKitChatDeviceState.${item.state}` as TranslationKey)}
                    {" · "}
                    {t("settings.cloudKitDeviceTrustFingerprint")} {item.publicKeyFingerprintShort}
                  </div>
                </div>
              </div>
              {item.state === "pending" ? (
                <button
                  onClick={() => void updateChatDevice(item, "approve")}
                  disabled={updatingDeviceId === item.id}
                  className="rounded-xl bg-cyan-400 px-4 py-2 text-sm font-bold text-[#061016] disabled:opacity-50"
                >
                  {t("settings.cloudKitChatDeviceApprove")}
                </button>
              ) : item.state === "approved" ? (
                <button
                  onClick={() => void updateChatDevice(item, "revoke")}
                  disabled={updatingDeviceId === item.id}
                  className="rounded-xl border border-red-400/20 bg-red-500/10 px-4 py-2 text-sm font-bold text-red-200 disabled:opacity-50"
                >
                  {t("settings.cloudKitChatDeviceRevoke")}
                </button>
              ) : null}
            </div>
          ))}
        </div>
      ) : null}

      {deviceTrust ? <TrustSummary summary={deviceTrust.summary} /> : null}

      {deviceTrust && deviceTrust.items.length === 0 ? (
        <div className="mt-4 rounded-2xl border border-white/[0.08] bg-black/20 p-4 text-sm text-zinc-400">
          {t("settings.cloudKitDeviceTrustEmpty")}
        </div>
      ) : null}

      {deviceTrust && deviceTrust.items.length > 0 ? (
        <div className="mt-4 space-y-3">
          {deviceTrust.items.map((item) => (
            <div key={item.id} className="rounded-2xl border border-white/[0.08] bg-black/20 p-4">
              <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                <div className="flex gap-3">
                  <div className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-xl border border-white/[0.08] bg-white/[0.03] text-zinc-300">
                    <Smartphone className="h-4 w-4" />
                  </div>
                  <div>
                    <div className="font-bold text-zinc-100">{item.displayName}</div>
                    <div className="mt-1 text-xs text-zinc-500">
                      {item.deviceType} · {item.trustState} · {t(reviewStatusKeys[item.reviewStatus])}
                    </div>
                  </div>
                </div>
                <a href="/admin/devices/pair" className="inline-flex items-center justify-center rounded-xl bg-cyan-400 px-3 py-2 text-xs font-bold text-[#061016]">
                  {t("settings.cloudKitDeviceTrustRebindCta")}
                </a>
              </div>
              <div className="mt-4 grid gap-3 text-xs text-zinc-400 sm:grid-cols-3">
                <div>
                  <div className="text-zinc-500">{t("settings.cloudKitDeviceTrustFingerprint")}</div>
                  <div className="mt-1 font-mono text-zinc-200">{item.publicKeyFingerprintShort || "-"}</div>
                </div>
                <div>
                  <div className="text-zinc-500">{t("settings.cloudKitDeviceTrustAppliedAt")}</div>
                  <div className="mt-1 text-zinc-200">{formatTime(item.appliedAt, locale)}</div>
                </div>
                <div>
                  <div className="text-zinc-500">{t("settings.cloudKitDeviceTrustNextAction")}</div>
                  <div className="mt-1 font-bold text-amber-100">{t(nextActionKeys[item.nextAction])}</div>
                </div>
              </div>
            </div>
          ))}
        </div>
      ) : null}
    </section>
  );
}
