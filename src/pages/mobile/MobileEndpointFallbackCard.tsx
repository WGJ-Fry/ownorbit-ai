import { useEffect, useState } from "react";
import { Compass, ExternalLink, RefreshCw } from "lucide-react";
import { findReachableFallbackCandidate } from "../../services/endpointCandidates";
import type { ReachableFallback } from "../../services/endpointCandidates";
import { useI18n } from "../../i18n/I18nProvider";

// Shown only after an in-session connectivity test actually failed. Probes the
// stored candidate list for another address where the desktop still answers,
// and offers a guided jump with an honest confidence level: "verified" means
// the desktop identified itself over CORS, "reachable-unverified" means
// something answered HTTP there, "unprobeable" means the browser blocked the
// probe (plain-http candidate under an https page) so only a manual try can
// tell. Web credentials are origin-scoped, so the jump always lands on the
// pairing page of the new origin rather than pretending the session moves.
export default function MobileEndpointFallbackCard({ active }: { active: boolean }) {
  const { t } = useI18n();
  const [probing, setProbing] = useState(false);
  const [fallback, setFallback] = useState<ReachableFallback | null>(null);
  const [probed, setProbed] = useState(false);

  useEffect(() => {
    if (!active) {
      setFallback(null);
      setProbed(false);
      return;
    }
    let cancelled = false;
    setProbing(true);
    findReachableFallbackCandidate()
      .then((found) => {
        if (cancelled) return;
        setFallback(found);
        setProbed(true);
      })
      .catch(() => {
        if (cancelled) return;
        setFallback(null);
        setProbed(true);
      })
      .finally(() => {
        if (!cancelled) setProbing(false);
      });
    return () => {
      cancelled = true;
    };
  }, [active]);

  if (!active) return null;
  if (probed && !fallback) return null;
  if (!probing && !fallback) return null;

  const bodyKey = fallback?.outcome === "verified"
    ? "mobileDevice.endpointFallbackBody"
    : fallback?.outcome === "unprobeable"
    ? "mobileDevice.endpointFallbackBodyUnprobeable"
    : "mobileDevice.endpointFallbackBodyUnverified";

  return (
    <section className="rounded-[28px] border border-sky-400/20 bg-sky-500/10 p-5">
      <div className="flex items-start gap-3">
        <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl border border-sky-400/20 bg-sky-500/10">
          {probing ? <RefreshCw className="h-5 w-5 animate-spin text-sky-300" /> : <Compass className="h-5 w-5 text-sky-300" />}
        </div>
        <div className="min-w-0">
          <h2 className="text-[15px] font-semibold text-sky-100">
            {probing ? t("mobileDevice.endpointFallbackProbing") : t("mobileDevice.endpointFallbackTitle")}
          </h2>
          <p className="mt-1 text-[13px] leading-relaxed text-sky-100/80">
            {probing
              ? t("mobileDevice.endpointFallbackProbingBody")
              : t(bodyKey, { baseUrl: fallback?.candidate.baseUrl || "" })}
          </p>
          {!probing && fallback ? (
            <a
              className="mt-3 inline-flex items-center gap-2 rounded-2xl border border-sky-400/30 bg-sky-500/20 px-4 py-2.5 text-[13px] font-semibold text-sky-100"
              href={fallback.pairUrl}
            >
              <ExternalLink className="h-4 w-4" />
              {t("mobileDevice.endpointFallbackOpen")}
            </a>
          ) : null}
          {!probing && fallback ? (
            <p className="mt-2 text-[12px] leading-relaxed text-sky-100/60">
              {t("mobileDevice.endpointFallbackRepairNote")}
            </p>
          ) : null}
        </div>
      </div>
    </section>
  );
}
