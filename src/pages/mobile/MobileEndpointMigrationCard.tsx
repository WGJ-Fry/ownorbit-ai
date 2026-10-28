import { useEffect, useState } from "react";
import { ArrowRightLeft, ExternalLink } from "lucide-react";
import { getStoredEndpointCandidates, normalizeOriginForComparison, probeEndpointCandidate } from "../../services/endpointCandidates";
import type { EndpointCandidate } from "../../services/endpointCandidates";
import { requestDeviceMigrationToken } from "../../services/lifeosApi";
import { useI18n } from "../../i18n/I18nProvider";

// Offered while the CURRENT origin still works: when the candidate list holds
// a higher-priority stable address (e.g. the phone is on a temporary
// trycloudflare URL but a Tailscale hostname exists), the phone can request a
// one-time voucher over the working origin and carry its binding to the
// better address without a new QR scan. Only a target that positively
// identified itself as this desktop (CORS-verified health) is offered.
export default function MobileEndpointMigrationCard({ active }: { active: boolean }) {
  const { t } = useI18n();
  const [target, setTarget] = useState<EndpointCandidate | null>(null);
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    if (!active) {
      setTarget(null);
      return;
    }
    let cancelled = false;
    (async () => {
      const stored = getStoredEndpointCandidates();
      if (!stored?.candidates.length || typeof window === "undefined") return;
      const currentOrigin = normalizeOriginForComparison(window.location.origin);
      const current = stored.candidates.find((item) => normalizeOriginForComparison(item.baseUrl) === currentOrigin);
      const best = stored.candidates.find((item) =>
        normalizeOriginForComparison(item.baseUrl) !== currentOrigin
          && item.stability === "stable"
          && item.secure
          && item.priority > (current?.priority ?? 0));
      if (!best) return;
      if (await probeEndpointCandidate(best.baseUrl) !== "verified") return;
      if (!cancelled) setTarget(best);
    })().catch(() => null);
    return () => {
      cancelled = true;
    };
  }, [active]);

  if (!active || !target) return null;

  const handleMigrate = async () => {
    setBusy(true);
    setFailed(false);
    try {
      // The mount-time probe may be minutes old — re-verify the target right
      // before minting a live voucher toward it.
      if (await probeEndpointCandidate(target.baseUrl) !== "verified") {
        setFailed(true);
        setBusy(false);
        return;
      }
      const voucher = await requestDeviceMigrationToken(target.baseUrl);
      window.location.href = `${target.baseUrl}/mobile/pair?migrate=${encodeURIComponent(voucher.token)}`;
    } catch {
      setFailed(true);
      setBusy(false);
    }
  };

  return (
    <section className="rounded-[28px] border border-emerald-400/20 bg-emerald-500/10 p-5">
      <div className="flex items-start gap-3">
        <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl border border-emerald-400/20 bg-emerald-500/10">
          <ArrowRightLeft className="h-5 w-5 text-emerald-300" />
        </div>
        <div className="min-w-0">
          <h2 className="text-[15px] font-semibold text-emerald-100">{t("mobileDevice.endpointMigrateTitle")}</h2>
          <p className="mt-1 text-[13px] leading-relaxed text-emerald-100/80">
            {t("mobileDevice.endpointMigrateBody", { baseUrl: target.baseUrl })}
          </p>
          <button
            className="mt-3 inline-flex items-center gap-2 rounded-2xl border border-emerald-400/30 bg-emerald-500/20 px-4 py-2.5 text-[13px] font-semibold text-emerald-100 disabled:opacity-50"
            disabled={busy}
            onClick={handleMigrate}
          >
            <ExternalLink className="h-4 w-4" />
            {busy ? t("mobileDevice.endpointMigrateBusy") : t("mobileDevice.endpointMigrateAction")}
          </button>
          {failed ? (
            <p className="mt-2 text-[12px] leading-relaxed text-emerald-100/60">{t("mobileDevice.endpointMigrateFailed")}</p>
          ) : null}
        </div>
      </div>
    </section>
  );
}
