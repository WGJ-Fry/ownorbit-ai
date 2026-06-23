import { ArrowRight, KeyRound, ShieldAlert } from "lucide-react";
import type { ConfigDiagnostics } from "../../../services/lifeosApi";
import { useI18n } from "../../../i18n/I18nProvider";
import DiagnosticCard from "./DiagnosticCard";

function formatAiSource(diagnostics: ConfigDiagnostics, t: ReturnType<typeof useI18n>["t"]) {
  if (diagnostics.ai.source === "system_secure_store") return t("diagnostics.source.system");
  if (diagnostics.ai.source === "encrypted_store") return t("diagnostics.source.encrypted");
  if (diagnostics.ai.source === "environment") return diagnostics.ai.envVar;
  return t("diagnostics.source.unconfigured");
}

function securityFixHref(itemId: string) {
  if (itemId === "admin" || itemId === "password") return "/admin/settings#admin-password-strength";
  if (itemId === "ai") return "/admin/settings#ai-provider";
  if (itemId === "backup" || itemId === "backupFreshness" || itemId === "backupSchedule") return "/admin/settings#backup-schedule";
  if (["https", "publicBaseUrlInput", "publicOptIn", "sessionCookies", "trustedProxy"].includes(itemId)) return "/admin/settings#mobile-connect";
  return "/admin/settings";
}

export default function ConfigDiagnosticsPanel({ diagnostics }: { diagnostics: ConfigDiagnostics }) {
  const { t } = useI18n();
  const latestArtifact = diagnostics.release.artifacts[0];
  const releaseReady = diagnostics.release.manifestAvailable && diagnostics.release.checksumAvailable && diagnostics.release.artifactCount > 0;
  return (
    <section className="mb-6 rounded-[28px] border border-white/[0.08] bg-[#101722] p-5">
      <div className="mb-4 flex items-center gap-2 font-bold">
        <KeyRound className="h-4 w-4 text-cyan-300" />
        {t("diagnostics.title")}
      </div>
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        <DiagnosticCard
          title={t("diagnostics.aiService")}
          status={diagnostics.ai.configured ? t("diagnostics.configured") : t("diagnostics.needsConfig")}
          tone={diagnostics.ai.configured ? "green" : "amber"}
          rows={[
            [t("diagnostics.provider"), diagnostics.ai.provider],
            [t("diagnostics.source"), formatAiSource(diagnostics, t)],
            [t("diagnostics.secureStorage"), diagnostics.ai.secureStorage?.label || "-"],
            [t("diagnostics.envVar"), diagnostics.ai.envVar],
            [t("diagnostics.restartRequired"), diagnostics.ai.restartRequired ? t("diagnostics.required") : t("diagnostics.notRequired")],
          ]}
          recommendations={diagnostics.ai.recommendations}
        />
        <DiagnosticCard
          title={t("diagnostics.networkAccess")}
          status={diagnostics.network.publicAccessWarning ? t("diagnostics.externalAccess") : t("diagnostics.localAccess")}
          tone={diagnostics.network.publicAccessWarning ? "amber" : "green"}
          rows={[
            [t("diagnostics.listenAddress"), diagnostics.network.host || "-"],
            [t("diagnostics.publicAddress"), diagnostics.network.publicBaseUrl || "-"],
            [t("diagnostics.explicitAuth"), diagnostics.network.publicAccessAllowed ? t("diagnostics.authorized") : t("diagnostics.unauthorized")],
          ]}
          recommendations={diagnostics.network.recommendations}
        />
        <DiagnosticCard
          title={t("diagnostics.dataStorage")}
          status="SQLite"
          tone="blue"
          rows={[
            [t("diagnostics.dataDir"), diagnostics.storage.dataDir],
            [t("diagnostics.backupRetention"), diagnostics.storage.backupRetentionCount],
            [t("diagnostics.autoBackup"), diagnostics.storage.backupSchedule.enabled ? t("diagnostics.everyHours", { hours: diagnostics.storage.backupSchedule.intervalHours }) : t("diagnostics.disabled")],
            [t("diagnostics.nextBackup"), diagnostics.storage.backupSchedule.nextRunAt ? new Date(diagnostics.storage.backupSchedule.nextRunAt).toLocaleString() : "-"],
          ]}
          recommendations={diagnostics.storage.recommendations}
        />
        <DiagnosticCard
          title={t("diagnostics.releasePackage")}
          status={releaseReady ? t("diagnostics.verifiable") : t("diagnostics.pending")}
          tone={releaseReady ? "green" : "amber"}
          rows={[
            [t("diagnostics.version"), diagnostics.release.version || "-"],
            ["Manifest", diagnostics.release.manifestAvailable ? t("diagnostics.exists") : t("diagnostics.missing")],
            ["SHA256SUMS", diagnostics.release.checksumAvailable ? t("diagnostics.exists") : t("diagnostics.missing")],
            [t("diagnostics.artifactCount"), String(diagnostics.release.artifactCount)],
            [t("diagnostics.latestArtifact"), latestArtifact?.fileName || "-"],
          ]}
          recommendations={diagnostics.release.recommendations}
        />
      </div>
      <div className="mt-4 rounded-2xl border border-white/[0.06] bg-white/[0.03] p-4">
        <div className="mb-3 flex items-center justify-between gap-3">
          <div className="flex items-center gap-2 text-sm font-bold">
            <ShieldAlert className="h-4 w-4 text-amber-300" />
            {t("diagnostics.publicSecurity")}
          </div>
          <span className={`rounded-full px-3 py-1 text-[11px] font-bold ${
            diagnostics.securityCheck.overall === "critical"
              ? "bg-red-500/10 text-red-200"
              : diagnostics.securityCheck.overall === "warning"
                ? "bg-amber-500/10 text-amber-200"
                : "bg-emerald-500/10 text-emerald-200"
          }`}>
            {diagnostics.securityCheck.overall === "critical" ? t("diagnostics.needsAction") : diagnostics.securityCheck.overall === "warning" ? t("diagnostics.checkRecommended") : t("diagnostics.passed")}
          </span>
        </div>
        <div className="grid gap-2 md:grid-cols-2">
          {diagnostics.securityCheck.items.map((item) => (
            <div key={item.id} className="rounded-xl border border-white/[0.06] bg-[#060a10] p-3 text-xs">
              <div className="flex items-center justify-between gap-2">
                <span className="font-bold text-zinc-200">{item.label}</span>
                <span className={`rounded-full px-2 py-0.5 text-[10px] font-bold ${
                  item.status === "critical"
                    ? "bg-red-500/10 text-red-200"
                    : item.status === "warning"
                      ? "bg-amber-500/10 text-amber-200"
                      : "bg-emerald-500/10 text-emerald-200"
                }`}>
                  {item.status === "critical" ? t("diagnostics.risk") : item.status === "warning" ? t("diagnostics.notice") : "OK"}
                </span>
              </div>
                  <div className="mt-2 text-zinc-400">{item.message}</div>
                  <div className="mt-1 text-zinc-500">{item.action}</div>
                  {item.status !== "ok" ? (
                    <a href={securityFixHref(item.id)} className="mt-3 inline-flex items-center gap-1.5 rounded-lg border border-cyan-300/20 bg-cyan-500/10 px-2.5 py-1.5 text-[11px] font-bold text-cyan-100">
                      {t("diagnostics.fixAction")}
                      <ArrowRight className="h-3 w-3" />
                    </a>
                  ) : null}
                </div>
              ))}
            </div>
      </div>
    </section>
  );
}
