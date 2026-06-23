import { AlertTriangle, CheckCircle2, KeyRound, Link2 } from "lucide-react";
import type { DeviceCredentialExpiryStatus, DeviceCredentialStorageStatus } from "../../services/lifeosApi";
import { useI18n } from "../../i18n/I18nProvider";

export function CapabilityRow({ label, ok, value }: { label: string; ok: boolean; value: string }) {
  return (
    <div className="flex items-center justify-between gap-3 rounded-2xl border border-white/[0.06] bg-white/[0.03] px-3 py-2">
      <span className="text-zinc-400">{label}</span>
      <span className={`text-right text-xs font-bold ${ok ? "text-emerald-200" : "text-amber-200"}`}>{value}</span>
    </div>
  );
}

export function PairingLinkPanel({
  value,
  error,
  onChange,
  onSubmit,
  buttonLabel,
  title,
  body,
}: {
  value: string;
  error: string | null;
  onChange: (value: string) => void;
  onSubmit: () => void;
  buttonLabel: string;
  title?: string;
  body?: string;
}) {
  const { t } = useI18n();
  return (
    <div className="mt-5 rounded-2xl border border-white/[0.08] bg-white/[0.03] p-4 text-left">
      {title || body ? (
        <div className="mb-3">
          {title ? <div className="text-sm font-bold text-zinc-100">{title}</div> : null}
          {body ? <div className="mt-1 text-xs leading-relaxed text-zinc-500">{body}</div> : null}
        </div>
      ) : null}
      <label className="text-xs font-bold text-zinc-500">{t("mobileDevice.pastePairingLink")}</label>
      <input
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className="mt-2 w-full rounded-xl border border-white/[0.08] bg-[#060a10] px-3 py-3 text-sm outline-none focus:border-cyan-400/60"
        placeholder={t("mobileDevice.pairingPlaceholder")}
      />
      {error ? <div className="mt-2 text-xs leading-relaxed text-red-200">{error}</div> : null}
      <button onClick={onSubmit} className="mt-3 inline-flex w-full items-center justify-center gap-2 rounded-xl bg-cyan-500 px-4 py-3 text-sm font-bold text-[#061016]">
        <Link2 className="h-4 w-4" />
        {buttonLabel}
      </button>
    </div>
  );
}

export function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between gap-3">
      <span className="text-zinc-500">{label}</span>
      <span className="max-w-[62%] truncate text-right font-mono text-xs text-zinc-200">{value}</span>
    </div>
  );
}

export function CredentialStorageCard({ storage }: { storage: DeviceCredentialStorageStatus }) {
  const { t } = useI18n();
  const storageLabel = storage.storage === "indexeddb" ? t("mobileDevice.storageIndexedDb") : storage.storage === "memory" ? t("mobileDevice.storageMemory") : t("mobileDevice.storageNone");
  const tone = storage.storage === "indexeddb" && !storage.legacyLocalStoragePresent
    ? "border-emerald-400/20 bg-emerald-500/10 text-emerald-100"
    : "border-amber-400/20 bg-amber-500/10 text-amber-100";
  return (
    <div className={`mt-4 rounded-2xl border p-4 text-sm ${tone}`}>
      <div className="flex gap-3">
        <KeyRound className="mt-0.5 h-4 w-4 flex-shrink-0" />
        <div>
          <div className="font-bold">{t("mobileDevice.storageTitle", { storage: storageLabel })}</div>
          <p className="mt-1 leading-relaxed opacity-80">
            {storage.storage === "indexeddb"
              ? t("mobileDevice.indexedDbBody")
              : t("mobileDevice.memoryBody")}
          </p>
          <div className="mt-2 grid gap-1 text-xs opacity-80">
            <div>{t("mobileDevice.indexedDb")}：{storage.indexedDbAvailable ? t("mobileDevice.available") : t("mobileDevice.unavailable")}</div>
            <div>{t("mobileDevice.legacyCredential")}：{storage.legacyLocalStoragePresent ? t("mobileDevice.pendingMigration") : t("mobileDevice.cleaned")}</div>
            <div>{t("mobileDevice.authMethod")}：{storage.authMethod === "signature" ? t("mobileDevice.webCryptoSignature") : storage.authMethod === "token" ? t("mobileDevice.deviceToken") : "-"}</div>
          </div>
        </div>
      </div>
    </div>
  );
}

export function CredentialExpiryCard({
  status,
  onRefresh,
  onFocusPairing,
}: {
  status: DeviceCredentialExpiryStatus;
  onRefresh: () => void;
  onFocusPairing: () => void;
}) {
  const { t } = useI18n();
  const tone = status.tone === "ok"
    ? "border-emerald-400/20 bg-emerald-500/10 text-emerald-100"
    : status.tone === "warn"
      ? "border-amber-400/20 bg-amber-500/10 text-amber-100"
      : "border-red-400/20 bg-red-500/10 text-red-100";
  const Icon = status.tone === "ok" ? CheckCircle2 : AlertTriangle;
  const titleKey = `mobileDevice.credentialHealth.${status.state}.title`;
  const bodyKey = `mobileDevice.credentialHealth.${status.state}.body`;
  return (
    <div className={`mt-4 rounded-2xl border p-4 text-sm ${tone}`}>
      <div className="flex gap-3">
        <Icon className="mt-0.5 h-4 w-4 flex-shrink-0" />
        <div className="min-w-0 flex-1">
          <div className="font-bold">{t(titleKey as any)}</div>
          <p className="mt-1 leading-relaxed opacity-80">{t(bodyKey as any)}</p>
          {status.expiresAt ? (
            <div className="mt-2 rounded-xl border border-white/[0.08] bg-black/10 px-3 py-2 text-xs opacity-90">
              {t("mobileDevice.credentialHealth.expiresAt", { time: new Date(status.expiresAt).toLocaleString() })}
            </div>
          ) : null}
          {status.rotationRecommended || status.rebindRecommended ? (
            <div className="mt-3 grid gap-2 sm:grid-cols-2">
              {status.rotationRecommended ? (
                <button onClick={onRefresh} className="rounded-xl border border-white/[0.12] bg-white/[0.08] px-3 py-2 text-xs font-bold">
                  {t("mobileDevice.credentialHealth.refreshAction")}
                </button>
              ) : null}
              {status.rebindRecommended ? (
                <button onClick={onFocusPairing} className="rounded-xl border border-white/[0.12] bg-white/[0.08] px-3 py-2 text-xs font-bold">
                  {t("mobileDevice.credentialHealth.rebindAction")}
                </button>
              ) : null}
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
}

export function Metric({ label, value, tone }: { label: string; value: number; tone: string }) {
  return (
    <div className="rounded-2xl border border-white/[0.06] bg-white/[0.03] px-2 py-3">
      <div className={`text-lg font-black ${tone}`}>{value}</div>
      <div className="mt-1 text-[10px] font-bold text-zinc-500">{label}</div>
    </div>
  );
}
