import { useEffect, useState } from "react";
import type { ReactNode } from "react";
import { Activity, AlertTriangle, Brain, DatabaseBackup, Download, Eye, KeyRound, LogOut, MessageSquareText, Plus, RefreshCw, Server, Settings, Smartphone, Wifi } from "lucide-react";
import { BoundDevice, ChatSession, MemoryRecord, backupDownloadUrl, createBackup, getHealth, listBackups, listChatSessions, listDevices, listMemories, logoutAdmin, previewBackup, requestDeviceTokenRotation, restoreBackup, revokeDevice } from "../../services/lifeosApi";
import type { BackupPreview } from "../../services/lifeosApi";
import { buildRestoreConfirmMessage } from "../../services/backupRestoreUi";
import LanguageSwitcher from "../../i18n/LanguageSwitcher";
import { useI18n } from "../../i18n/I18nProvider";
import DeviceConnectivityStatus from "./DeviceConnectivityStatus";

type Health = Awaited<ReturnType<typeof getHealth>>;
type BackupItem = Awaited<ReturnType<typeof listBackups>>["backups"][number];

export default function AdminDashboardPage() {
  const { t } = useI18n();
  const [health, setHealth] = useState<Health | null>(null);
  const [devices, setDevices] = useState<BoundDevice[]>([]);
  const [sessions, setSessions] = useState<ChatSession[]>([]);
  const [memories, setMemories] = useState<MemoryRecord[]>([]);
  const [backups, setBackups] = useState<BackupItem[]>([]);
  const [backupPreview, setBackupPreview] = useState<BackupPreview | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busyDeviceId, setBusyDeviceId] = useState<string | null>(null);
  const [busyBackupFile, setBusyBackupFile] = useState<string | null>(null);
  const onlyPasswordRisk = Boolean(health?.publicRisk?.items?.length) && health!.publicRisk.items.every((item) => item.id === "password");

  const refresh = async () => {
    setError(null);
    try {
      const [healthData, deviceData, sessionData, memoryData, backupData] = await Promise.all([getHealth(), listDevices(), listChatSessions(), listMemories(), listBackups()]);
      setHealth(healthData);
      setDevices(deviceData.devices);
      setSessions(sessionData.sessions);
      setMemories(memoryData.memories);
      setBackups(backupData.backups);
    } catch (err: any) {
      setError(err.message || "Failed to load console status");
    }
  };

  useEffect(() => {
    refresh();
    const interval = window.setInterval(refresh, 5000);
    return () => window.clearInterval(interval);
  }, []);

  const loadBackupPreview = async (backup: BackupItem) => {
    setBusyBackupFile(`preview-${backup.file}`);
    setError(null);
    try {
      const result = await previewBackup(backup.file);
      setBackupPreview(result.preview);
      return result.preview;
    } catch (err: any) {
      setError(err.message || t("dashboard.backupPreviewFailed"));
      return null;
    } finally {
      setBusyBackupFile(null);
    }
  };

  const restoreWithPreview = async (backup: BackupItem) => {
    const preview = await loadBackupPreview(backup);
    if (!preview) return;
    const confirmed = window.confirm(buildRestoreConfirmMessage(backup.file, preview));
    if (!confirmed) return;
    setBusyBackupFile(`restore-${backup.file}`);
    try {
      const result = await restoreBackup(backup.file);
      window.alert(t("dashboard.restoreAlert", { file: result.restore.preRestoreBackup.file }));
      await refresh();
    } catch (err: any) {
      setError(err.message || t("dashboard.restoreFailed"));
    } finally {
      setBusyBackupFile(null);
    }
  };
  return (
    <div className="min-h-screen bg-[#060a10] text-zinc-100 p-6">
      <div className="max-w-6xl mx-auto">
        <header className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between mb-6">
          <div>
            <h1 className="text-2xl font-bold">LifeOS Local Core</h1>
            <p className="text-sm text-zinc-400 mt-1">{t("dashboard.subtitle")}</p>
          </div>
          <div className="flex flex-wrap gap-2">
            <LanguageSwitcher compact />
            <a href={sessions.length === 0 ? "/chat" : "/admin/chat"} className="inline-flex items-center gap-2 rounded-xl border border-white/[0.08] bg-white/[0.03] px-4 py-2 text-sm font-bold hover:bg-white/[0.06]">
              <MessageSquareText className="w-4 h-4" />
              {sessions.length === 0 ? t("dashboard.startFirstChat") : t("dashboard.chatHistory")}
            </a>
            <a href="/admin/memory" className="inline-flex items-center gap-2 rounded-xl border border-white/[0.08] bg-white/[0.03] px-4 py-2 text-sm font-bold hover:bg-white/[0.06]">
              <Brain className="w-4 h-4" />
              {t("dashboard.memory")}
            </a>
            <a href="/admin/settings" className="inline-flex items-center gap-2 rounded-xl border border-white/[0.08] bg-white/[0.03] px-4 py-2 text-sm font-bold hover:bg-white/[0.06]">
              <Settings className="w-4 h-4" />
              {t("common.settings")}
            </a>
            <button onClick={refresh} className="inline-flex items-center gap-2 rounded-xl border border-white/[0.08] bg-white/[0.03] px-4 py-2 text-sm font-bold">
              <RefreshCw className="w-4 h-4" />
              {t("common.refresh")}
            </button>
            <button
              onClick={async () => {
                await logoutAdmin();
                window.location.href = "/admin/login";
              }}
              className="inline-flex items-center gap-2 rounded-xl border border-white/[0.08] bg-white/[0.03] px-4 py-2 text-sm font-bold"
            >
              <LogOut className="w-4 h-4" />
              {t("common.logout")}
            </button>
            <a href="/admin/devices/pair" className="inline-flex items-center gap-2 rounded-xl bg-cyan-500 px-4 py-2 text-sm font-bold text-[#061016]">
              <Plus className="w-4 h-4" />
              {t("dashboard.bindPhone")}
            </a>
          </div>
        </header>

        {error && (
          <div className="mb-6 rounded-2xl border border-red-500/20 bg-red-500/10 p-4 text-sm text-red-200">
            {error}
            {error.includes("authentication") || error.includes("Authentication") ? (
              <a href="/admin/login" className="ml-3 font-bold text-cyan-200 underline">
                {t("dashboard.loginLink")}
              </a>
            ) : null}
          </div>
        )}

        {health?.publicAccessWarning && onlyPasswordRisk && health.publicSetupRisk ? (
          <div className="mb-6 rounded-2xl border border-amber-400/25 bg-amber-500/10 p-4 text-sm text-amber-100">
            <div className="flex gap-3">
              <AlertTriangle className="mt-0.5 h-4 w-4 flex-shrink-0 text-amber-300" />
              <div className="min-w-0 flex-1">
                <div className="font-bold">{t("dashboard.updatePasswordTitle")}</div>
                <div className="mt-1 text-amber-100/80">{t("dashboard.updatePasswordBody")}</div>
                <a href="/admin/settings#admin-password-strength" className="mt-3 inline-flex items-center gap-2 rounded-xl border border-amber-100/20 bg-black/15 px-3 py-2 text-xs font-bold text-amber-50">
                  <KeyRound className="h-3.5 w-3.5" />
                  {t("dashboard.updatePasswordAction")}
                </a>
              </div>
            </div>
          </div>
        ) : health?.publicAccessWarning ? (
          <div className={`mb-6 rounded-2xl border p-4 text-sm ${health.publicSetupRisk ? "border-red-400/25 bg-red-500/10 text-red-100" : "border-amber-400/20 bg-amber-500/10 text-amber-100"}`}>
            <div className="flex gap-3">
              <AlertTriangle className={`mt-0.5 h-4 w-4 flex-shrink-0 ${health.publicSetupRisk ? "text-red-300" : "text-amber-300"}`} />
              <div className="min-w-0 flex-1">
                <div className="font-bold">{health.publicSetupRisk ? t("dashboard.publicRiskTitle") : t("dashboard.publicAccessTitle")}</div>
                <div className={`mt-1 ${health.publicSetupRisk ? "text-red-100/75" : "text-amber-100/75"}`}>
                  LIFEOS_HOST={health.host || "-"}{health.publicBaseUrl ? `, PUBLIC_BASE_URL=${health.publicBaseUrl}` : ""}. {health.publicSetupRisk ? t("dashboard.publicRiskBody") : t("dashboard.publicSafeBody")}
                </div>
                {health.publicRisk?.items?.length ? (
                  <div className="mt-3 grid gap-2 md:grid-cols-2">
                    {health.publicRisk.items.map((item) => (
                      <div key={item.id} className="rounded-xl border border-white/[0.08] bg-black/15 p-3">
                        <div className="flex items-center justify-between gap-3">
                          <div className="font-bold text-zinc-100">{item.label}</div>
                          <span className={`rounded-full px-2 py-0.5 text-[10px] font-bold ${item.status === "critical" ? "bg-red-500/15 text-red-100" : "bg-amber-500/15 text-amber-100"}`}>
                            {item.status === "critical" ? t("dashboard.mustFix") : t("dashboard.shouldFix")}
                          </span>
                        </div>
                        <div className="mt-1 text-xs leading-relaxed text-zinc-300">{item.message}</div>
                        <div className="mt-1 text-xs leading-relaxed text-zinc-500">{item.action}</div>
                      </div>
                    ))}
                  </div>
                ) : null}
                <div className="mt-3 flex flex-wrap gap-2">
                  <a href="/admin/settings" className="inline-flex items-center gap-2 rounded-xl border border-white/[0.08] bg-white/[0.04] px-3 py-2 text-xs font-bold text-zinc-100">
                    <Settings className="h-3.5 w-3.5" />
                    {t("dashboard.openSecuritySettings")}
                  </a>
                  <a href="/admin/settings#backup-schedule" className="inline-flex items-center gap-2 rounded-xl border border-cyan-400/20 bg-cyan-500/10 px-3 py-2 text-xs font-bold text-cyan-100">
                    <DatabaseBackup className="h-3.5 w-3.5" />
                    {t("dashboard.enableAutoBackup")}
                  </a>
                  <button
                    onClick={async () => {
                      await createBackup();
                      await refresh();
                    }}
                    className="inline-flex items-center gap-2 rounded-xl border border-emerald-400/20 bg-emerald-500/10 px-3 py-2 text-xs font-bold text-emerald-100"
                  >
                    <DatabaseBackup className="h-3.5 w-3.5" />
                    {t("dashboard.createBackupNow")}
                  </button>
                </div>
              </div>
            </div>
          </div>
        ) : null}

        {sessions.length === 0 && (
          <section className="mb-6 rounded-[28px] border border-cyan-400/20 bg-cyan-500/10 p-5">
            <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
              <div className="min-w-0">
                <div className="text-xs font-bold uppercase tracking-[0.18em] text-cyan-200/80">{t("dashboard.firstChatReady")}</div>
                <h2 className="mt-2 text-xl font-bold text-zinc-50">{t("dashboard.startFirstChat")}</h2>
                <p className="mt-2 max-w-2xl text-sm leading-relaxed text-cyan-50/85">
                  {health?.aiConfigured ? t("dashboard.startFirstChatBody") : t("dashboard.startFirstChatNeedsAi")}
                </p>
              </div>
              <div className="flex flex-wrap gap-3">
                <a href={health?.aiConfigured ? "/chat" : "/admin/onboarding"} className="inline-flex items-center justify-center gap-2 rounded-xl bg-white px-4 py-3 text-sm font-bold text-[#061016]">
                  <MessageSquareText className="h-4 w-4" />
                  {health?.aiConfigured ? t("dashboard.startFirstChat") : t("dashboard.configureAiFirst")}
                </a>
                <a href="/admin/devices/pair" className="inline-flex items-center justify-center gap-2 rounded-xl border border-white/[0.12] bg-[#060a10]/40 px-4 py-3 text-sm font-bold text-zinc-100">
                  <Smartphone className="h-4 w-4" />
                  {t("dashboard.bindPhone")}
                </a>
              </div>
            </div>
          </section>
        )}

        <section className="grid md:grid-cols-4 gap-4 mb-6">
          <Metric icon={<Server className="w-5 h-5" />} label={t("dashboard.serviceStatus")} value={health?.ok ? "Online" : "Unknown"} tone="cyan" />
          <Metric icon={<Smartphone className="w-5 h-5" />} label={t("dashboard.boundDevices")} value={String(health?.deviceCount ?? "-")} tone="blue" />
          <Metric icon={<Wifi className="w-5 h-5" />} label={t("dashboard.onlineDevices")} value={String(health?.onlineDeviceCount ?? "-")} tone="green" />
          <Metric icon={<MessageSquareText className="w-5 h-5" />} label={t("dashboard.networkMode")} value={health?.networkMode === "lan" ? "LAN" : "Local"} tone={health?.networkMode === "lan" ? "amber" : "cyan"} />
        </section>

        <section className="grid md:grid-cols-3 gap-4 mb-6">
          <a href={sessions.length === 0 ? "/chat" : "/admin/chat"} className="rounded-3xl border border-white/[0.08] bg-[#101722] p-5 hover:bg-white/[0.04] transition-colors">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-2xl border border-cyan-400/20 bg-cyan-500/10 text-cyan-300 flex items-center justify-center">
                <MessageSquareText className="w-5 h-5" />
              </div>
              <div>
                <div className="font-bold">{sessions.length === 0 ? t("dashboard.startFirstChat") : t("dashboard.viewLongChats")}</div>
                <div className="text-sm text-zinc-500 mt-1">{sessions.length === 0 ? t("dashboard.startFirstChatBody") : t("dashboard.viewLongChatsBody")}</div>
              </div>
            </div>
          </a>
          <a href="/admin/memory" className="rounded-3xl border border-white/[0.08] bg-[#101722] p-5 hover:bg-white/[0.04] transition-colors">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-2xl border border-emerald-400/20 bg-emerald-500/10 text-emerald-300 flex items-center justify-center">
                <Brain className="w-5 h-5" />
              </div>
              <div>
                <div className="font-bold">{t("dashboard.manageMemory")}</div>
                <div className="text-sm text-zinc-500 mt-1">{t("dashboard.memoryContext", { count: memories.length })}</div>
              </div>
            </div>
          </a>
          <div className="rounded-3xl border border-white/[0.08] bg-[#101722] p-5">
            <div className="flex items-center gap-3">
              <div className={`w-10 h-10 rounded-2xl border flex items-center justify-center ${health?.aiConfigured ? "border-emerald-400/20 bg-emerald-500/10 text-emerald-300" : "border-amber-400/20 bg-amber-500/10 text-amber-300"}`}>
                <KeyRound className="w-5 h-5" />
              </div>
              <div>
                <div className="font-bold">{health?.aiConfigured ? t("dashboard.aiKeyConfigured") : t("dashboard.aiKeyMissing")}</div>
                <div className="text-sm text-zinc-500 mt-1">{t("dashboard.aiKeyMissingBody")}</div>
              </div>
            </div>
          </div>
        </section>

        <section className="rounded-[28px] border border-white/[0.08] bg-[#101722] overflow-hidden mb-6">
          <div className="flex items-center justify-between px-5 py-4 border-b border-white/[0.06]">
            <div className="font-bold flex items-center gap-2">
              <DatabaseBackup className="w-4 h-4 text-emerald-300" />
              {t("dashboard.databaseBackups")}
            </div>
            <button
              onClick={async () => {
                await createBackup();
                await refresh();
              }}
              className="inline-flex items-center gap-2 rounded-xl border border-emerald-400/20 bg-emerald-500/10 px-3 py-2 text-xs font-bold text-emerald-200"
            >
              <Plus className="w-3.5 h-3.5" />
              {t("backup.create")}
            </button>
          </div>
          {backups.length === 0 ? (
            <div className="p-6 text-sm text-zinc-400">{t("dashboard.noBackups")}</div>
          ) : (
            <div className="divide-y divide-white/[0.06]">
              {backups.slice(0, 5).map((backup) => (
                <div key={backup.file} className="p-4 flex items-center justify-between gap-4">
                  <div className="min-w-0">
                    <div className="font-mono text-xs text-zinc-200 truncate">{backup.file}</div>
                    <div className="text-xs text-zinc-500 mt-1">{new Date(backup.createdAt).toLocaleString()} · {(backup.size / 1024).toFixed(1)} KB</div>
                  </div>
                  <div className="flex items-center gap-3">
                    <a href={backupDownloadUrl(backup.file)} className="inline-flex items-center gap-1.5 text-xs font-bold text-cyan-300 hover:text-cyan-200">
                      <Download className="h-3.5 w-3.5" />
                      {t("dashboard.download")}
                    </a>
                    <button
                      onClick={() => loadBackupPreview(backup)}
                      className="inline-flex items-center gap-1.5 text-xs font-bold text-zinc-300 hover:text-zinc-100"
                    >
                      <Eye className="h-3.5 w-3.5" />
                      {busyBackupFile === `preview-${backup.file}` ? t("common.reading") : t("common.preview")}
                    </button>
                    <button
                      onClick={() => restoreWithPreview(backup)}
                      className="text-xs font-bold text-amber-300 hover:text-amber-200"
                    >
                      {busyBackupFile === `restore-${backup.file}` ? t("dashboard.scheduling") : t("dashboard.restore")}
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
          {backupPreview ? (
            <div className="border-t border-white/[0.06] bg-[#0b111a] p-4">
              <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
                <div>
                  <div className="font-bold text-zinc-100">{t("dashboard.preRestorePreview", { file: backupPreview.backup.file })}</div>
                  <div className="mt-1 text-xs text-zinc-500">
                    {t("dashboard.backupMeta", { size: (backupPreview.backup.size / 1024).toFixed(1), time: backupPreview.backup.createdAt ? new Date(backupPreview.backup.createdAt).toLocaleString() : t("dashboard.unknown") })}
                  </div>
                </div>
                <div className="rounded-full border border-white/[0.08] bg-white/[0.03] px-3 py-1 text-xs font-bold text-zinc-300">
                  {t("dashboard.migrationCount", { count: backupPreview.migrations.length })}
                </div>
              </div>
              <div className="mt-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
                {Object.entries(backupPreview.tables).map(([table, count]) => (
                  <div key={table} className="rounded-2xl border border-white/[0.06] bg-white/[0.03] p-3">
                    <div className="font-mono text-[11px] text-zinc-400">{table}</div>
                    <div className="mt-1 text-lg font-bold text-zinc-100">{count ?? "-"}</div>
                  </div>
                ))}
              </div>
              {backupPreview.sensitiveData ? (
                <div className={`mt-3 rounded-2xl border p-3 text-xs leading-relaxed ${backupPreview.sensitiveData.ordinaryBackupExcludesSecrets ? "border-emerald-400/20 bg-emerald-500/10 text-emerald-100" : "border-red-400/20 bg-red-500/10 text-red-100"}`}>
                  <div className="font-bold">{backupPreview.sensitiveData.ordinaryBackupExcludesSecrets ? t("dashboard.ordinaryBackupSafe") : t("dashboard.backupHasSensitive")}</div>
                  <div className="mt-1">
                    {t("dashboard.sensitiveRows", { keys: backupPreview.sensitiveData.appSecretsRows, states: backupPreview.sensitiveData.sensitiveClientStateRows })}
                    {backupPreview.sensitiveData.ordinaryBackupExcludesSecrets ? t("dashboard.reconfigureAiKeyAfterRestore") : t("dashboard.useEncryptedBackup")}
                  </div>
                </div>
              ) : null}
              <div className="mt-3 rounded-2xl border border-amber-400/20 bg-amber-500/10 p-3 text-xs leading-relaxed text-amber-100">
                <div className="font-bold">{t("dashboard.restoreRisk")}</div>
                <ul className="mt-1 list-disc space-y-1 pl-4">
                  {backupPreview.warnings.map((warning) => (
                    <li key={warning}>{warning}</li>
                  ))}
                </ul>
              </div>
            </div>
          ) : null}
        </section>

        <section className="rounded-[28px] border border-white/[0.08] bg-[#101722] overflow-hidden">
          <div className="flex items-center justify-between px-5 py-4 border-b border-white/[0.06]">
            <div className="font-bold flex items-center gap-2">
              <Activity className="w-4 h-4 text-cyan-300" />
              {t("dashboard.boundDevices")}
            </div>
            <div className="text-xs text-zinc-500">{t("dashboard.autoRefresh")}</div>
          </div>

          {devices.length === 0 ? (
            <div className="p-10 text-center text-sm text-zinc-400">
              {t("dashboard.noDevices")}
            </div>
          ) : (
            <div className="divide-y divide-white/[0.06]">
              {devices.map((device) => (
                <div key={device.id} className="p-5 flex items-center justify-between gap-4">
                  <div className="min-w-0">
                    <div className="font-bold truncate">{device.name}</div>
                    <div className="text-xs text-zinc-500 mt-1">
                      {device.type} · {t("dashboard.lastSeen", { time: new Date(device.lastSeenAt).toLocaleString() })}
                    </div>
                    <DeviceConnectivityStatus report={device.connectivityReport} />
                  </div>
                  <div className="flex items-center gap-3">
                    <span className={`text-xs font-bold rounded-full px-2.5 py-1 border ${device.status === "online" ? "bg-emerald-500/10 border-emerald-400/20 text-emerald-300" : "bg-white/[0.03] border-white/[0.08] text-zinc-400"}`}>
                      {device.status === "online" ? t("dashboard.online") : t("dashboard.offline")}
                    </span>
                    <button
                      disabled={busyDeviceId === device.id}
                      onClick={async () => {
                        setBusyDeviceId(device.id);
                        try {
                          const result = await requestDeviceTokenRotation(device.id);
                          if (!result.delivered) {
                            window.alert(t("dashboard.deviceOfflineRotate"));
                          }
                        } finally {
                          setBusyDeviceId(null);
                          await refresh();
                        }
                      }}
                      className="text-xs font-bold text-cyan-300 hover:text-cyan-200 disabled:opacity-50"
                    >
                      {t("dashboard.refreshCredential")}
                    </button>
                    <button
                      onClick={async () => {
                        await revokeDevice(device.id);
                        await refresh();
                      }}
                      className="text-xs font-bold text-red-300 hover:text-red-200"
                    >
                      {t("dashboard.revoke")}
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </section>
      </div>
    </div>
  );
}

function Metric({ icon, label, value, tone }: { icon: ReactNode; label: string; value: string; tone: "cyan" | "blue" | "green" | "amber" }) {
  const toneClass = {
    cyan: "text-cyan-300 bg-cyan-500/10 border-cyan-400/20",
    blue: "text-blue-300 bg-blue-500/10 border-blue-400/20",
    green: "text-emerald-300 bg-emerald-500/10 border-emerald-400/20",
    amber: "text-amber-300 bg-amber-500/10 border-amber-400/20",
  }[tone];

  return (
    <div className="rounded-3xl border border-white/[0.08] bg-[#101722] p-5">
      <div className={`w-10 h-10 rounded-2xl border flex items-center justify-center mb-4 ${toneClass}`}>{icon}</div>
      <div className="text-xs font-bold text-zinc-500 uppercase tracking-wider">{label}</div>
      <div className="text-2xl font-bold mt-2">{value}</div>
    </div>
  );
}
