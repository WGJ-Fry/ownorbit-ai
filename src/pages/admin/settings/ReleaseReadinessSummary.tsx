import { AlertTriangle, CheckCircle2, PackageCheck } from "lucide-react";
import type { ConfigDiagnostics } from "../../../services/lifeosApi";
import { useI18n } from "../../../i18n/I18nProvider";

export default function ReleaseReadinessSummary({ release }: { release: ConfigDiagnostics["release"] }) {
  const { t } = useI18n();
  const latestArtifact = release.artifacts[0];
  const ready = release.manifestAvailable && release.checksumAvailable && release.artifactCount > 0;
  const checks = [
    { ok: release.manifestAvailable, label: t("diagnostics.release.manifestAvailable") },
    { ok: release.checksumAvailable, label: t("diagnostics.release.checksumAvailable") },
    { ok: release.artifactCount > 0, label: t("diagnostics.release.artifactAvailable", { count: release.artifactCount }) },
  ];
  const Icon = ready ? CheckCircle2 : AlertTriangle;

  return (
    <div className={`mt-4 rounded-2xl border p-4 text-xs leading-relaxed ${ready ? "border-emerald-400/20 bg-emerald-500/10 text-emerald-100" : "border-amber-400/20 bg-amber-500/10 text-amber-100"}`}>
      <div className="flex items-start gap-3">
        <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border border-current/15 bg-black/10">
          <Icon className="h-4 w-4" />
        </div>
        <div className="min-w-0 flex-1">
          <div className="font-bold">{ready ? t("diagnostics.releaseReadyTitle") : t("diagnostics.releaseBlockedTitle")}</div>
          <div className="mt-1 opacity-80">
            {ready
              ? t("diagnostics.releaseReadyBody", { artifact: latestArtifact?.fileName || "-", version: release.version || "-" })
              : t("diagnostics.releaseBlockedBody")}
          </div>
          <div className="mt-3 grid gap-2 sm:grid-cols-3">
            {checks.map((check) => (
              <div key={check.label} className="flex items-center gap-2 rounded-xl border border-current/15 bg-black/10 px-3 py-2">
                {check.ok ? <CheckCircle2 className="h-3.5 w-3.5 shrink-0" /> : <PackageCheck className="h-3.5 w-3.5 shrink-0" />}
                <span className="truncate">{check.label}</span>
              </div>
            ))}
          </div>
          {!ready ? <div className="mt-3 font-semibold">{t("diagnostics.releaseBlockedAction")}</div> : null}
        </div>
      </div>
    </div>
  );
}
