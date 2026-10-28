import { CloudOff } from "lucide-react";
import { useI18n } from "../../i18n/I18nProvider";

const RENEW_STEP_KEYS = [
  "mobileDevice.temporaryEntryRenewStepStart",
  "mobileDevice.temporaryEntryRenewStepScan",
  "mobileDevice.temporaryEntryRenewStepHomeScreen",
  "mobileDevice.temporaryEntryRenewStepCleanup",
] as const;

// Shown whenever this page was opened from a trycloudflare address. The chat
// page's connection pill only has room for a one-line hint and links here,
// so the full order lives on this card: the cheap check (a sleeping or
// offline Mac comes back on the same address) before the costly one (new
// tunnel, new QR, new Home Screen icon), and what happens to chats.
export default function MobileTemporaryEntryCard() {
  const { t } = useI18n();
  return (
    <section data-testid="mobile-temporary-entry-card" className="mb-4 rounded-[28px] border border-amber-400/20 bg-amber-500/10 p-5 text-amber-100">
      <div className="flex items-start gap-3">
        <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl border border-amber-400/20 bg-amber-500/10">
          <CloudOff className="h-5 w-5 text-amber-300" />
        </div>
        <div className="min-w-0">
          <h2 className="text-[15px] font-semibold">{t("mobileDevice.temporaryEntryTitle")}</h2>
          <p className="mt-1 text-[13px] leading-relaxed text-amber-100/80">{t("mobileDevice.temporaryEntryBody")}</p>
        </div>
      </div>
      <div className="mt-4 text-[13px] font-semibold">{t("mobileDevice.temporaryEntryStepsTitle")}</div>
      <ol className="mt-2 space-y-3 text-[13px] leading-relaxed">
        <li className="rounded-2xl border border-white/[0.08] bg-black/10 p-3">
          <div className="font-semibold">{t("mobileDevice.temporaryEntryWakeTitle")}</div>
          <div className="mt-1 text-amber-100/80">{t("mobileDevice.temporaryEntryWakeBody")}</div>
        </li>
        <li className="rounded-2xl border border-white/[0.08] bg-black/10 p-3">
          <div className="font-semibold">{t("mobileDevice.temporaryEntryRenewTitle")}</div>
          <div className="mt-1 text-amber-100/80">{t("mobileDevice.temporaryEntryRenewBody")}</div>
          <ol className="mt-2 list-decimal space-y-1 pl-5 text-amber-100/80">
            {RENEW_STEP_KEYS.map((key) => <li key={key}>{t(key)}</li>)}
          </ol>
        </li>
        <li className="rounded-2xl border border-white/[0.08] bg-black/10 p-3">
          <div className="font-semibold">{t("mobileDevice.temporaryEntryChatsTitle")}</div>
          <div className="mt-1 text-amber-100/80">{t("mobileDevice.temporaryEntryChatsBody")}</div>
        </li>
      </ol>
    </section>
  );
}
