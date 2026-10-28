import { Smartphone } from "lucide-react";
import { useI18n } from "../../i18n/I18nProvider";

export default function PendingCloudKitDeviceApproval({ count }: { count: number }) {
  const { t } = useI18n();

  if (count <= 0) return null;

  return (
    <section data-testid="dashboard-cloudkit-phone-approval" className="mb-6 border-y border-amber-300/20 bg-amber-400/10 px-4 py-4 text-amber-50">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-start gap-3">
          <Smartphone className="mt-0.5 h-5 w-5 shrink-0" />
          <div>
            <div className="font-bold">{t("dashboard.pendingIphoneTitle", { count })}</div>
            <p className="mt-1 text-xs leading-relaxed text-amber-50/75">{t("dashboard.pendingIphoneBody")}</p>
          </div>
        </div>
        <a href="/admin/onboarding#onboarding-cloudkit-phone-approval" className="inline-flex shrink-0 items-center justify-center rounded-xl bg-amber-200 px-4 py-2 text-sm font-bold text-[#1d1304]">
          {t("dashboard.pendingIphoneAction")}
        </a>
      </div>
    </section>
  );
}
