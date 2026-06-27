import { useEffect, useState } from "react";
import { AlertTriangle, ArrowLeft, DatabaseBackup, Download, KeyRound, RefreshCw, Server, ShieldCheck } from "lucide-react";
import { diagnosticBundleDownloadUrl, getConfigDiagnostics, getHealth, getPendingRestore, getReleaseUpdateCheck, listAuditLogs, listBackups } from "../../services/lifeosApi";
import type { AuditLogRecord, ConfigDiagnostics, PendingRestore, ReleaseUpdateCheck } from "../../services/lifeosApi";
import ConnectionGuide from "./ConnectionGuide";
import AuditLogPanel from "./settings/AuditLogPanel";
import BackupRestorePanel from "./settings/BackupRestorePanel";
import CalendarSyncControlPanel from "./settings/CalendarSyncControlPanel";
import ConfigDiagnosticsPanel from "./settings/ConfigDiagnosticsPanel";
import NativeAutomationControlPanel from "./settings/NativeAutomationControlPanel";
import StatusPanel from "./settings/StatusPanel";
import AiKeyPanel from "./settings/AiKeyPanel";
import AdminPasswordPanel from "./settings/AdminPasswordPanel";
import LanguageSwitcher from "../../i18n/LanguageSwitcher";
import { useI18n } from "../../i18n/I18nProvider";

type Health = Awaited<ReturnType<typeof getHealth>>;
type BackupItem = Awaited<ReturnType<typeof listBackups>>["backups"][number];

export default function AdminSettingsPage() {
  const { t } = useI18n();
  const [health, setHealth] = useState<Health | null>(null);
  const [backups, setBackups] = useState<BackupItem[]>([]);
  const [pendingRestore, setPendingRestore] = useState<PendingRestore | null>(null);
  const [logs, setLogs] = useState<AuditLogRecord[]>([]);
  const [diagnostics, setDiagnostics] = useState<ConfigDiagnostics | null>(null);
  const [releaseUpdate, setReleaseUpdate] = useState<ReleaseUpdateCheck | null>(null);
  const [error, setError] = useState<string | null>(null);

  const refresh = async () => {
    setError(null);
    setReleaseUpdate(null);
    void getReleaseUpdateCheck()
      .then(setReleaseUpdate)
      .catch(() => setReleaseUpdate(null));
    try {
      const [healthData, backupData, pendingRestoreData, auditData, diagnosticsData] = await Promise.allSettled([
        getHealth(),
        listBackups(),
        getPendingRestore(),
        listAuditLogs(),
        getConfigDiagnostics(),
      ]);
      if (healthData.status === "fulfilled") setHealth(healthData.value);
      if (backupData.status === "fulfilled") setBackups(backupData.value.backups);
      if (pendingRestoreData.status === "fulfilled") setPendingRestore(pendingRestoreData.value.pendingRestore);
      if (auditData.status === "fulfilled") setLogs(auditData.value.logs);
      if (diagnosticsData.status === "fulfilled") setDiagnostics(diagnosticsData.value);
      if (diagnosticsData.status === "rejected") throw diagnosticsData.reason;
    } catch (err: any) {
      setError(err.message || "Failed to load settings");
    }
  };

  useEffect(() => {
    refresh();
  }, []);

  return (
    <div className="min-h-screen bg-[#060a10] p-6 text-zinc-100">
      <div className="mx-auto max-w-5xl">
        <header className="mb-6 flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <a href="/admin/dashboard" className="mb-3 inline-flex items-center gap-2 text-sm font-bold text-zinc-400 hover:text-cyan-200">
              <ArrowLeft className="h-4 w-4" />
              {t("settings.backDashboard")}
            </a>
            <h1 className="text-2xl font-bold">{t("settings.title")}</h1>
            <p className="mt-1 text-sm text-zinc-400">{t("settings.description")}</p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <LanguageSwitcher compact />
            <a href={diagnosticBundleDownloadUrl()} className="inline-flex items-center gap-2 rounded-xl border border-cyan-400/20 bg-cyan-500/10 px-4 py-2 text-sm font-bold text-cyan-200">
              <Download className="h-4 w-4" />
              {t("settings.exportDiagnostics")}
            </a>
            <button onClick={refresh} className="inline-flex items-center gap-2 rounded-xl border border-white/[0.08] bg-white/[0.03] px-4 py-2 text-sm font-bold">
              <RefreshCw className="h-4 w-4" />
              {t("common.refresh")}
            </button>
          </div>
        </header>

        {error ? <div className="mb-6 rounded-2xl border border-red-500/20 bg-red-500/10 p-4 text-sm text-red-200">{error}</div> : null}

        <section className="mb-6 grid gap-4 md:grid-cols-2">
          <StatusPanel
            icon={<Server className="h-5 w-5" />}
            title={t("settings.localCore")}
            tone="cyan"
            rows={[
              [t("settings.status"), health?.ok ? "Online" : "Unknown"],
              [t("settings.listenAddress"), health?.host || "-"],
              [t("settings.networkMode"), health?.networkMode === "lan" ? "LAN" : "Local"],
            ]}
          />
          <StatusPanel
            icon={<ShieldCheck className="h-5 w-5" />}
            title={t("settings.security")}
            tone={health?.publicAccessWarning ? "amber" : "green"}
            rows={[
              [t("settings.publicLanExposure"), health?.publicAccessWarning ? t("settings.publicEnabled") : t("settings.publicDisabled")],
              [t("settings.publicAuth"), health?.publicAccessAllowed ? "LIFEOS_ALLOW_PUBLIC=1" : t("settings.unauthorized")],
              ["PUBLIC_BASE_URL", health?.publicBaseUrl || "-"],
            ]}
          />
          <StatusPanel
            icon={<KeyRound className="h-5 w-5" />}
            title="AI"
            tone={health?.aiConfigured ? "green" : "amber"}
            rows={[
              [t("settings.aiProvider"), health?.aiConfigured ? t("settings.aiConfiguredSome") : t("settings.aiUnconfigured")],
              [t("settings.serviceVersion"), health?.version || "-"],
              [t("settings.uptime"), health ? t("settings.seconds", { seconds: Math.round(health.uptime) }) : "-"],
            ]}
          />
          <StatusPanel
            icon={<DatabaseBackup className="h-5 w-5" />}
            title={t("settings.data")}
            tone="blue"
            rows={[
              [t("settings.backupCount"), String(backups.length)],
              [t("settings.latestBackup"), backups[0]?.file || "-"],
              [t("settings.restoreTask"), pendingRestore ? t("settings.restoreWaiting", { source: pendingRestore.restoredFrom }) : t("settings.none")],
            ]}
          />
        </section>

        {diagnostics ? <AdminPasswordPanel diagnostics={diagnostics} onChanged={refresh} /> : null}

        {diagnostics ? <AiKeyPanel diagnostics={diagnostics} onChanged={refresh} /> : null}

        {diagnostics ? <ConfigDiagnosticsPanel diagnostics={diagnostics} updateCheck={releaseUpdate} /> : null}

        {diagnostics ? <CalendarSyncControlPanel initialPreview={diagnostics.calendarSync} onChanged={refresh} /> : null}

        <NativeAutomationControlPanel />

        <ConnectionGuide health={health} />

        <BackupRestorePanel backups={backups} pendingRestore={pendingRestore} onChanged={refresh} />

        {health?.publicAccessWarning ? (
          <div className="mb-6 rounded-2xl border border-amber-400/20 bg-amber-500/10 p-4 text-sm text-amber-100">
            <div className="flex gap-3">
              <AlertTriangle className="mt-0.5 h-4 w-4 flex-shrink-0 text-amber-300" />
              <div>
                <div className="font-bold">{t("settings.externalAccessTitle")}</div>
                <div className="mt-1 text-amber-100/75">{t("settings.externalAccessBody")}</div>
              </div>
            </div>
          </div>
        ) : null}

        <AuditLogPanel logs={logs} />
      </div>
    </div>
  );
}
