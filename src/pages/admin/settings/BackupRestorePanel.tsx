import { useEffect, useState } from "react";
import { AlertTriangle, DatabaseBackup, Download, LockKeyhole, Plus, Sparkles, Upload, XCircle } from "lucide-react";
import { backupDownloadUrl, cancelPendingRestore, cleanupData, createBackup, dataExportDownloadUrl, exportEncryptedBackup, getBackupSchedule, importEncryptedBackup, listBackups, previewBackup, previewDataCleanup, restoreBackup, runBackupScheduleNow, updateBackupSchedule } from "../../../services/lifeosApi";
import type { BackupPreview, BackupSchedule, DataExportScope, PendingRestore } from "../../../services/lifeosApi";
import { buildCleanupConfirmMessage, buildCleanupPolicyOptions, buildRestoreConfirmMessage, formatCleanupSummary, getBackupPassphraseStrength, validateBackupExportPassphrase } from "../../../services/backupRestoreUi";
import { useI18n } from "../../../i18n/I18nProvider";
import type { TranslationKey } from "../../../i18n/translations";
import { BackupList } from "./BackupList";
import { BackupPreviewCard } from "./BackupPreviewCard";
import { BackupScheduleCard } from "./BackupScheduleCard";
type BackupItem = Awaited<ReturnType<typeof listBackups>>["backups"][number];
const dataExportScopeIds: DataExportScope[] = ["chat", "memories", "devices", "auditLogs"];

export default function BackupRestorePanel({
  backups,
  pendingRestore,
  onChanged,
}: {
  backups: BackupItem[];
  pendingRestore: PendingRestore | null;
  onChanged: () => Promise<void>;
}) {
  const { t } = useI18n();
  const [busy, setBusy] = useState<string | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const [preview, setPreview] = useState<BackupPreview | null>(null);
  const [schedule, setSchedule] = useState<BackupSchedule | null>(null);
  const [scheduleEnabled, setScheduleEnabled] = useState(false);
  const [scheduleInterval, setScheduleInterval] = useState(24);
  const [cleanupBackupKeepCount, setCleanupBackupKeepCount] = useState(20);
  const [cleanupAuditDays, setCleanupAuditDays] = useState(180);
  const [cleanupChatDays, setCleanupChatDays] = useState(365);
  const [cleanupPreview, setCleanupPreview] = useState<Awaited<ReturnType<typeof previewDataCleanup>>["cleanup"] | null>(null);
  const [exportScopes, setExportScopes] = useState<DataExportScope[]>(dataExportScopeIds);
  const [encryptionPassphrase, setEncryptionPassphrase] = useState("");
  const [encryptionPassphraseConfirm, setEncryptionPassphraseConfirm] = useState("");
  const [importPassphrase, setImportPassphrase] = useState("");
  const exportHref = dataExportDownloadUrl(exportScopes);
  const exportPassphraseStrength = getBackupPassphraseStrength(encryptionPassphrase);

  useEffect(() => {
    getBackupSchedule()
      .then((result) => {
        setSchedule(result.schedule);
        setScheduleEnabled(result.schedule.enabled);
        setScheduleInterval(result.schedule.intervalHours);
      })
      .catch((error) => setStatus(error.message || t("backup.loadScheduleFailed")));
  }, []);

  const handleCreateBackup = async () => {
    setBusy("create");
    setStatus(null);
    try {
      const result = await createBackup();
      setStatus(t("backup.created", { file: result.backup.file }));
      await onChanged();
    } catch (error: any) {
      setStatus(error.message || t("backup.createFailed"));
    } finally {
      setBusy(null);
    }
  };

  const handleRestore = async (backup: BackupItem) => {
    setBusy(`preview-${backup.file}`);
    setStatus(null);
    let backupPreview: BackupPreview | null = null;
    try {
      backupPreview = (await previewBackup(backup.file)).preview;
      setPreview(backupPreview);
    } catch (error: any) {
      setBusy(null);
      setStatus(error.message || t("backup.previewFailed"));
      return;
    }
    const confirmed = window.confirm(buildRestoreConfirmMessage(backup.file, backupPreview));
    if (!confirmed) {
      setBusy(null);
      return;
    }
    setBusy(backup.file);
    setStatus(null);
    try {
      const result = await restoreBackup(backup.file);
      setStatus(t("backup.restoreScheduled", { file: result.restore.preRestoreBackup.file }));
      await onChanged();
    } catch (error: any) {
      setStatus(error.message || t("backup.restoreFailed"));
    } finally {
      setBusy(null);
    }
  };

  const handlePreview = async (backup: BackupItem) => {
    setBusy(`preview-${backup.file}`);
    setStatus(null);
    try {
      const result = await previewBackup(backup.file);
      setPreview(result.preview);
      setStatus(t("backup.previewLoaded", { file: backup.file }));
    } catch (error: any) {
      setStatus(error.message || t("backup.previewFailed"));
    } finally {
      setBusy(null);
    }
  };

  const handleCleanup = async () => {
    const cleanupPolicy = buildCleanupPolicyOptions({
      backupKeepCount: cleanupBackupKeepCount,
      auditOlderThanDays: cleanupAuditDays,
      chatOlderThanDays: cleanupChatDays,
    });
    if (!cleanupPolicy.ok) {
      setStatus(cleanupPolicy.error);
      return;
    }
    setBusy("cleanup");
    setStatus(null);
    try {
      const previewResult = await previewDataCleanup(cleanupPolicy.options);
      setCleanupPreview(previewResult.cleanup);
      if (!window.confirm(buildCleanupConfirmMessage({
        ...cleanupPolicy.options,
        cleanup: previewResult.cleanup,
      }))) {
        setBusy(null);
        return;
      }
      const result = await cleanupData(cleanupPolicy.options);
      setStatus(result.cleanup.protectionBackup
        ? t("backup.cleanupDoneWithProtection", { backups: result.cleanup.backupsDeleted, auditLogs: result.cleanup.auditLogsDeleted, sessions: result.cleanup.chatSessionsDeleted, file: result.cleanup.protectionBackup.file })
        : t("backup.cleanupDone", { backups: result.cleanup.backupsDeleted, auditLogs: result.cleanup.auditLogsDeleted, sessions: result.cleanup.chatSessionsDeleted }));
      await onChanged();
    } catch (error: any) {
      setStatus(error.message || t("backup.cleanupFailed"));
    } finally {
      setBusy(null);
    }
  };

  const handlePreviewCleanup = async () => {
    const cleanupPolicy = buildCleanupPolicyOptions({
      backupKeepCount: cleanupBackupKeepCount,
      auditOlderThanDays: cleanupAuditDays,
      chatOlderThanDays: cleanupChatDays,
    });
    if (!cleanupPolicy.ok) {
      setStatus(cleanupPolicy.error);
      return;
    }
    setBusy("cleanup-preview");
    setStatus(null);
    try {
      const result = await previewDataCleanup(cleanupPolicy.options);
      setCleanupPreview(result.cleanup);
      setStatus(t("backup.cleanupPreview", { summary: formatCleanupSummary(result.cleanup) }));
    } catch (error: any) {
      setStatus(error.message || t("backup.cleanupPreviewFailed"));
    } finally {
      setBusy(null);
    }
  };

  const handleCancelRestore = async () => {
    if (!window.confirm(t("backup.cancelRestoreConfirm"))) return;
    setBusy("cancel-restore");
    setStatus(null);
    try {
      await cancelPendingRestore();
      setStatus(t("backup.cancelRestoreDone"));
      await onChanged();
    } catch (error: any) {
      setStatus(error.message || t("backup.cancelRestoreFailed"));
    } finally {
      setBusy(null);
    }
  };

  const handleSaveSchedule = async () => {
    setBusy("schedule");
    setStatus(null);
    try {
      const result = await updateBackupSchedule({ enabled: scheduleEnabled, intervalHours: scheduleInterval });
      setSchedule(result.schedule);
      setStatus(result.schedule.enabled ? t("backup.scheduleEnabled", { hours: result.schedule.intervalHours }) : t("backup.scheduleDisabled"));
      await onChanged();
    } catch (error: any) {
      setStatus(error.message || t("backup.scheduleSaveFailed"));
    } finally {
      setBusy(null);
    }
  };

  const handleRunScheduleNow = async () => {
    setBusy("schedule-run-now");
    setStatus(null);
    try {
      const result = await runBackupScheduleNow();
      setSchedule(result.schedule);
      setScheduleEnabled(result.schedule.enabled);
      setScheduleInterval(result.schedule.intervalHours);
      setStatus(t("backup.scheduleRunNowDone", { file: result.backup.file }));
      await onChanged();
    } catch (error: any) {
      setStatus(error.message || t("backup.scheduleRunNowFailed"));
    } finally {
      setBusy(null);
    }
  };

  const handleEncryptedExport = async (backup: BackupItem) => {
    const passphraseValidation = validateBackupExportPassphrase(encryptionPassphrase, encryptionPassphraseConfirm);
    if (!passphraseValidation.ok) {
      setStatus(t(`backup.exportPassphrase.${passphraseValidation.reason}` as TranslationKey));
      return;
    }
    setBusy(`encrypt-${backup.file}`);
    setStatus(null);
    try {
      const result = await exportEncryptedBackup(backup.file, encryptionPassphrase);
      const blob = new Blob([JSON.stringify(result.payload, null, 2)], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = backup.file.replace(/\.db$/, ".lifeos-backup.json");
      link.click();
      URL.revokeObjectURL(url);
      setEncryptionPassphrase("");
      setEncryptionPassphraseConfirm("");
      setStatus(t("backup.encryptedExportDone", { file: link.download }));
    } catch (error: any) {
      setStatus(error.message || t("backup.encryptedExportFailed"));
    } finally {
      setBusy(null);
    }
  };

  const handleEncryptedImport = async (file: File | null) => {
    if (!file) return;
    if (importPassphrase.length < 10) {
      setStatus(t("backup.importPassphraseShort"));
      return;
    }
    setBusy("encrypted-import");
    setStatus(null);
    try {
      const payload = JSON.parse(await file.text());
      const result = await importEncryptedBackup(payload, importPassphrase);
      setPreview(result.preview);
      setImportPassphrase("");
      setStatus(t("backup.encryptedImportDone", { file: result.backup.file }));
      await onChanged();
    } catch (error: any) {
      setStatus(error.message || t("backup.encryptedImportFailed"));
    } finally {
      setBusy(null);
    }
  };

  return (
    <section className="mb-6 rounded-[28px] border border-white/[0.08] bg-[#101722] p-5">
      <div className="mb-4 flex items-center justify-between gap-3">
        <div className="flex items-center gap-2 font-bold">
          <DatabaseBackup className="h-4 w-4 text-blue-300" />
          {t("backup.title")}
        </div>
        <div className="flex flex-wrap items-center justify-end gap-2">
          <a
            href={exportHref}
            aria-disabled={!exportScopes.length}
            onClick={(event) => {
              if (!exportScopes.length) event.preventDefault();
            }}
            className={`inline-flex items-center gap-2 rounded-xl border px-3 py-2 text-xs font-bold ${exportScopes.length ? "border-cyan-400/20 bg-cyan-500/10 text-cyan-200" : "pointer-events-none border-white/[0.08] bg-white/[0.03] text-zinc-500"}`}
          >
            <Download className="h-3.5 w-3.5" />
            {t("backup.exportData")}
          </a>
          {backups[0] ? (
            <a href={backupDownloadUrl(backups[0].file)} className="inline-flex items-center gap-2 rounded-xl border border-white/[0.08] bg-white/[0.03] px-3 py-2 text-xs font-bold text-zinc-200 hover:bg-white/[0.06]">
              <Download className="h-3.5 w-3.5" />
              {t("backup.downloadLatest")}
            </a>
          ) : null}
          <button
            onClick={handleCreateBackup}
            disabled={Boolean(busy)}
            className="inline-flex items-center gap-2 rounded-xl border border-emerald-400/20 bg-emerald-500/10 px-3 py-2 text-xs font-bold text-emerald-200 disabled:cursor-not-allowed disabled:opacity-50"
          >
            <Plus className="h-3.5 w-3.5" />
            {busy === "create" ? t("backup.creating") : t("backup.create")}
          </button>
        </div>
      </div>

      {pendingRestore ? (
        <div className="mb-4 rounded-2xl border border-amber-400/20 bg-amber-500/10 p-4 text-sm text-amber-100">
          <div className="flex gap-3">
            <AlertTriangle className="mt-0.5 h-4 w-4 flex-shrink-0 text-amber-300" />
            <div>
              <div className="font-bold">{t("backup.pendingRestoreTitle")}</div>
              <div className="mt-1 text-amber-100/75">
                {t("backup.pendingRestoreBody", { source: pendingRestore.restoredFrom, file: pendingRestore.preRestoreBackup.file })}
              </div>
              <div className="mt-3 grid gap-2 text-xs text-amber-50/80 sm:grid-cols-3">
                <RestoreDetail label={t("backup.pendingScheduledAt")} value={new Date(pendingRestore.scheduledAt).toLocaleString()} />
                <RestoreDetail label={t("backup.pendingPreRestore")} value={pendingRestore.preRestoreBackup.file} />
                <RestoreDetail label={t("backup.pendingRestartRequired")} value={pendingRestore.restartRequired ? t("common.yes") : t("common.no")} />
              </div>
              <button
                onClick={handleCancelRestore}
                disabled={Boolean(busy)}
                className="mt-3 inline-flex items-center gap-2 rounded-xl border border-amber-200/25 bg-amber-200/10 px-3 py-2 text-xs font-bold text-amber-100 disabled:cursor-not-allowed disabled:opacity-50"
              >
                <XCircle className="h-3.5 w-3.5" />
                {busy === "cancel-restore" ? t("backup.canceling") : t("backup.cancelRestore")}
              </button>
            </div>
          </div>
        </div>
      ) : (
        <div className="mb-4 rounded-2xl border border-white/[0.06] bg-white/[0.03] p-4 text-sm leading-relaxed text-zinc-400">
          {t("backup.restoreNotice")}
        </div>
      )}

      {status ? <div className="mb-4 rounded-xl border border-white/[0.08] bg-white/[0.03] p-3 text-sm text-zinc-300">{status}</div> : null}

      <div id="backup-export-scope" className="mb-4 scroll-mt-6 rounded-2xl border border-white/[0.06] bg-white/[0.03] p-4">
        <div className="mb-3 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <div className="text-sm font-bold text-zinc-100">{t("backup.exportScopeTitle")}</div>
            <div className="mt-1 text-xs text-zinc-500">{t("backup.exportScopeBody")}</div>
          </div>
          <button
            type="button"
            onClick={() => setExportScopes(dataExportScopeIds)}
            className="inline-flex items-center justify-center rounded-xl border border-white/[0.08] bg-white/[0.04] px-3 py-2 text-xs font-bold text-zinc-200"
          >
            {t("backup.selectAll")}
          </button>
        </div>
        <div className="grid gap-2 sm:grid-cols-4">
          {dataExportScopeIds.map((scope) => (
            <label key={scope} className="flex items-center gap-3 rounded-xl border border-white/[0.06] bg-[#060a10] px-3 py-2 text-sm text-zinc-300">
              <input
                type="checkbox"
                checked={exportScopes.includes(scope)}
                onChange={(event) => {
                  setExportScopes((current) => event.target.checked
                    ? Array.from(new Set([...current, scope]))
                    : current.filter((value) => value !== scope));
                }}
                className="h-4 w-4 accent-cyan-400"
              />
              {t(`backup.scope.${scope}` as TranslationKey)}
            </label>
          ))}
        </div>
        <div className="mt-2 truncate font-mono text-xs text-cyan-200">{exportHref}</div>
      </div>

      <BackupScheduleCard
        busy={busy}
        schedule={schedule}
        scheduleEnabled={scheduleEnabled}
        scheduleInterval={scheduleInterval}
        onRunNow={handleRunScheduleNow}
        onSave={handleSaveSchedule}
        onToggleEnabled={setScheduleEnabled}
        onIntervalChange={setScheduleInterval}
      />

      <div className="mb-4 rounded-2xl border border-white/[0.06] bg-white/[0.03] p-4">
        <div className="mb-3 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <div className="text-sm font-bold text-zinc-100">{t("backup.cleanupTitle")}</div>
            <div className="mt-1 text-xs text-zinc-500">{t("backup.cleanupBody")}</div>
          </div>
          <div className="flex flex-wrap gap-2">
            <button
              onClick={handlePreviewCleanup}
              disabled={Boolean(busy)}
              className="inline-flex items-center justify-center gap-2 rounded-xl border border-cyan-400/20 bg-cyan-500/10 px-3 py-2 text-xs font-bold text-cyan-200 disabled:cursor-not-allowed disabled:opacity-50"
            >
              <Sparkles className="h-3.5 w-3.5" />
              {busy === "cleanup-preview" ? t("backup.previewing") : t("backup.previewCleanup")}
            </button>
            <button
              onClick={handleCleanup}
              disabled={Boolean(busy)}
              className="inline-flex items-center justify-center gap-2 rounded-xl border border-white/[0.08] bg-white/[0.03] px-3 py-2 text-xs font-bold text-zinc-200 disabled:cursor-not-allowed disabled:opacity-50"
            >
              <Sparkles className="h-3.5 w-3.5" />
              {busy === "cleanup" ? t("backup.cleaning") : t("backup.cleanupByPolicy")}
            </button>
          </div>
        </div>
        <div className="grid gap-3 sm:grid-cols-3">
          <NumberField
            label={t("backup.keepBackups")}
            suffix={t("backup.countUnit")}
            value={cleanupBackupKeepCount}
            min={1}
            onChange={setCleanupBackupKeepCount}
          />
          <NumberField
            label={t("backup.auditOlderThan")}
            suffix={t("backup.days")}
            value={cleanupAuditDays}
            min={0}
            onChange={setCleanupAuditDays}
          />
          <NumberField
            label={t("backup.chatOlderThan")}
            suffix={t("backup.days")}
            value={cleanupChatDays}
            min={0}
            onChange={setCleanupChatDays}
          />
        </div>
        {cleanupPreview ? (
          <div className="mt-3 grid gap-2 rounded-2xl border border-cyan-400/20 bg-cyan-500/10 p-3 text-center text-xs sm:grid-cols-4">
            <MetricPill label={t("backup.metricBackups")} value={cleanupPreview.backupsDeleted} />
            <MetricPill label={t("backup.metricAudit")} value={cleanupPreview.auditLogsDeleted} />
            <MetricPill label={t("backup.metricSessions")} value={cleanupPreview.chatSessionsDeleted} />
            <MetricPill label={t("backup.metricMessages")} value={cleanupPreview.messagesDeleted} />
          </div>
        ) : null}
      </div>

      <div className="mb-4 grid gap-4 lg:grid-cols-2">
        <div className="rounded-2xl border border-white/[0.06] bg-white/[0.03] p-4">
          <div className="mb-3 flex items-center gap-2 text-sm font-bold text-zinc-100">
            <LockKeyhole className="h-4 w-4 text-emerald-300" />
            {t("backup.encryptedExportTitle")}
          </div>
          <div className="mb-3 text-xs leading-relaxed text-zinc-500">
            {t("backup.encryptedExportBody")}
          </div>
          <div className="grid gap-2">
            <div className="grid gap-2 sm:grid-cols-2">
              <input
                type="password"
                value={encryptionPassphrase}
                onChange={(event) => setEncryptionPassphrase(event.target.value)}
                placeholder={t("backup.exportPassphrasePlaceholder")}
                className="min-w-0 rounded-xl border border-white/[0.08] bg-[#060a10] px-3 py-2 text-sm text-zinc-100 outline-none"
              />
              <input
                type="password"
                value={encryptionPassphraseConfirm}
                onChange={(event) => setEncryptionPassphraseConfirm(event.target.value)}
                placeholder={t("backup.exportPassphraseConfirmPlaceholder")}
                className="min-w-0 rounded-xl border border-white/[0.08] bg-[#060a10] px-3 py-2 text-sm text-zinc-100 outline-none"
              />
            </div>
            <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
              <div className="text-xs text-zinc-500">
                {t("backup.exportPassphraseStrength", { strength: t(`backup.passphraseStrength.${exportPassphraseStrength}` as TranslationKey) })}
              </div>
              <button
                onClick={() => backups[0] && handleEncryptedExport(backups[0])}
                disabled={Boolean(busy) || !backups[0]}
                className="inline-flex items-center justify-center gap-2 rounded-xl border border-emerald-400/20 bg-emerald-500/10 px-3 py-2 text-xs font-bold text-emerald-200 disabled:cursor-not-allowed disabled:opacity-50"
              >
                <Download className="h-3.5 w-3.5" />
                {busy?.startsWith("encrypt-") ? t("backup.encrypting") : t("backup.exportLatest")}
              </button>
            </div>
          </div>
        </div>
        <div className="rounded-2xl border border-white/[0.06] bg-white/[0.03] p-4">
          <div className="mb-3 flex items-center gap-2 text-sm font-bold text-zinc-100">
            <Upload className="h-4 w-4 text-blue-300" />
            {t("backup.encryptedImportTitle")}
          </div>
          <div className="mb-3 text-xs leading-relaxed text-zinc-500">
            {t("backup.encryptedImportBody")}
          </div>
          <div className="flex flex-col gap-2 sm:flex-row">
            <input
              type="password"
              value={importPassphrase}
              onChange={(event) => setImportPassphrase(event.target.value)}
              placeholder={t("backup.importPassphrasePlaceholder")}
              className="min-w-0 flex-1 rounded-xl border border-white/[0.08] bg-[#060a10] px-3 py-2 text-sm text-zinc-100 outline-none"
            />
            <label className="inline-flex cursor-pointer items-center justify-center gap-2 rounded-xl border border-blue-400/20 bg-blue-500/10 px-3 py-2 text-xs font-bold text-blue-200">
              <Upload className="h-3.5 w-3.5" />
              {busy === "encrypted-import" ? t("backup.importing") : t("backup.chooseFile")}
              <input
                type="file"
                accept=".json,.lifeos-backup"
                className="hidden"
                disabled={Boolean(busy)}
                onChange={(event) => {
                  void handleEncryptedImport(event.target.files?.[0] || null);
                  event.currentTarget.value = "";
                }}
              />
            </label>
          </div>
        </div>
      </div>

      {preview ? <BackupPreviewCard preview={preview} /> : null}

      <BackupList backups={backups} busy={busy} onPreview={handlePreview} onRestore={handleRestore} />
    </section>
  );
}

function NumberField({
  label,
  suffix,
  value,
  min,
  onChange,
}: {
  label: string;
  suffix: string;
  value: number;
  min: number;
  onChange: (value: number) => void;
}) {
  return (
    <label className="flex items-center gap-2 rounded-xl border border-white/[0.06] bg-[#060a10] px-3 py-2 text-sm text-zinc-300">
      <span className="shrink-0 text-xs text-zinc-500">{label}</span>
      <input
        type="number"
        min={min}
        value={value}
        onChange={(event) => onChange(Number(event.target.value))}
        className="min-w-0 flex-1 bg-transparent text-right font-mono outline-none"
      />
      <span className="shrink-0 text-xs text-zinc-500">{suffix}</span>
    </label>
  );
}
function MetricPill({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-xl border border-cyan-200/10 bg-black/10 px-3 py-2">
      <div className="text-cyan-100/60">{label}</div>
      <div className="mt-1 font-mono text-cyan-50">{value}</div>
    </div>
  );
}

function RestoreDetail({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0 rounded-xl border border-amber-200/10 bg-black/10 px-3 py-2">
      <div className="text-amber-100/55">{label}</div>
      <div className="mt-1 truncate font-mono text-amber-50" title={value}>{value}</div>
    </div>
  );
}
