import { useEffect, useMemo, useState } from "react";
import type React from "react";
import { AlertTriangle, ArrowRight, CheckCircle2, DatabaseBackup, KeyRound, Loader2, ShieldAlert, Sparkles } from "lucide-react";
import { completeOnboarding, createBackup, getBackupSchedule, getConfigDiagnostics, getOnboardingStatus, listAiProviders, listBackups, listDevices, saveAiProviderKey, testAiProvider, updateActiveAiProvider, updateAiProviderModel, updateBackupSchedule } from "../../services/lifeosApi";
import type { AiProviderId, AiProviderStatus, BackupRecord, BackupSchedule, BoundDevice, ConfigDiagnostics, OnboardingStatus } from "../../services/lifeosApi";
import LanguageSwitcher from "../../i18n/LanguageSwitcher";
import { useI18n } from "../../i18n/I18nProvider";
import OnboardingMobileCard from "./OnboardingMobileCard";
import OnboardingRecoveryCard from "./OnboardingRecoveryCard";

const providerLabels: Record<AiProviderId, string> = {
  gemini: "Google Gemini",
  openai: "OpenAI",
  openrouter: "OpenRouter",
  local: "Local Model",
};

export default function AdminOnboardingPage() {
  const { t } = useI18n();
  const [diagnostics, setDiagnostics] = useState<ConfigDiagnostics | null>(null);
  const [providers, setProviders] = useState<AiProviderStatus[]>([]);
  const [selectedProvider, setSelectedProvider] = useState<AiProviderId>("gemini");
  const [selectedModel, setSelectedModel] = useState("");
  const [apiKey, setApiKey] = useState("");
  const [backups, setBackups] = useState<BackupRecord[]>([]);
  const [backupSchedule, setBackupSchedule] = useState<BackupSchedule | null>(null);
  const [devices, setDevices] = useState<BoundDevice[]>([]);
  const [onboarding, setOnboarding] = useState<OnboardingStatus | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const [desktopBridgeAvailable, setDesktopBridgeAvailable] = useState(false);

  const activeProvider = useMemo(() => providers.find((provider) => provider.id === selectedProvider), [providers, selectedProvider]);
  const isLocalProvider = selectedProvider === "local";
  const aiConfigured = providers.some((provider) => provider.configured);
  const latestBackup = backups[0];
  const hasBackup = backups.length > 0;
  const hasDevice = devices.some((device) => device.status !== "revoked");
  const completedSteps = [aiConfigured, hasBackup, hasDevice, onboarding?.steps.find((step) => step.id === "security")?.done].filter(Boolean).length;
  const nextStep = onboarding?.steps.find((step) => !step.done) || null;
  const securityItems = diagnostics?.securityCheck.items || [];
  const securityRiskCount = securityItems.filter((item) => item.status !== "ok").length;
  const localizedStepMeta = (stepId: OnboardingStatus["steps"][number]["id"], done: boolean) => {
    switch (stepId) {
      case "ai":
        return {
          label: t("onboarding.aiTitle").replace(/^\d+\.\s*/, ""),
          message: done ? t("onboarding.stepAiDone") : t("onboarding.stepAiTodo"),
        };
      case "backup":
        return {
          label: t("onboarding.backupTitle").replace(/^\d+\.\s*/, ""),
          message: done ? t("onboarding.stepBackupDone", { count: backups.length }) : t("onboarding.stepBackupTodo"),
        };
      case "device":
        return {
          label: t("onboarding.mobileTitle").replace(/^\d+\.\s*/, ""),
          message: done ? t("onboarding.stepDeviceDone", { count: devices.filter((device) => device.status !== "revoked").length }) : t("onboarding.stepDeviceTodo"),
        };
      default:
        return {
          label: t("onboarding.securityCheck"),
          message: done ? t("onboarding.stepSecurityDone") : t("onboarding.stepSecurityTodo"),
        };
    }
  };
  const incompleteStepLabels = onboarding?.steps
    .filter((step) => !step.done)
    .map((step) => localizedStepMeta(step.id, step.done).label) || [];
  const finishHint = onboarding?.completed
    ? t("onboarding.finishReady")
    : t("onboarding.finishBlocked", { steps: incompleteStepLabels.join(t("onboarding.stepSeparator")) || t("onboarding.unknownStep") });

  const refresh = async () => {
    const [providerData, diagnosticsData, backupData, scheduleData, deviceData, onboardingData] = await Promise.all([listAiProviders(), getConfigDiagnostics(), listBackups(), getBackupSchedule(), listDevices(), getOnboardingStatus()]);
    setProviders(providerData.providers);
    setDiagnostics(diagnosticsData);
    setBackups(backupData.backups);
    setBackupSchedule(scheduleData.schedule);
    setDevices(deviceData.devices);
    setOnboarding(onboardingData.onboarding);
  };

  useEffect(() => {
    refresh().catch((error) => setStatus(error.message || t("onboarding.loadFailed")));
    setDesktopBridgeAvailable(Boolean((window as any).lifeosDesktop));
  }, []);

  useEffect(() => {
    setSelectedModel(activeProvider?.selectedModel || activeProvider?.defaultModel || activeProvider?.models?.[0] || "");
  }, [activeProvider?.id, activeProvider?.selectedModel, activeProvider?.defaultModel, activeProvider?.models]);

  const handleSaveAiKey = async () => {
    if (!apiKey.trim()) {
      setStatus(t("onboarding.enterAiKey"));
      return;
    }
    setBusy("ai");
    setStatus(null);
    try {
      if (selectedModel.trim()) {
        await updateAiProviderModel(selectedProvider, selectedModel.trim());
      }
      await saveAiProviderKey(selectedProvider, apiKey.trim());
      await updateActiveAiProvider(selectedProvider);
      const result = await testAiProvider(selectedProvider, selectedProvider === "local" ? "live" : "configuration");
      const testDetails = result.mode === "live" ? t("aiKey.testLiveOk", { count: result.modelCount ?? 0 }) : t("aiKey.testConfigOnly");
      const catalogDetails = result.modelCatalogUpdated ? ` ${t("aiKey.modelCatalogUpdated", { count: result.discoveredModelCount || result.modelCount || 0 })}` : "";
      setApiKey("");
      setStatus(result.ok
        ? `${t("aiKey.testConfigOk", { provider: result.provider.provider, model: result.selectedModel || result.provider.selectedModel || result.provider.defaultModel || "-" })} ${testDetails}${catalogDetails} ${t("onboarding.alreadyDefault")}`
        : result.message);
      await refresh();
    } catch (error: any) {
      setStatus(error.message || t("onboarding.aiFailed"));
    } finally {
      setBusy(null);
    }
  };

  const handleSetDefaultProvider = async () => {
    setBusy("ai-default");
    setStatus(null);
    try {
      const result = await updateActiveAiProvider(selectedProvider);
      setStatus(`${result.provider.provider} ${t("onboarding.alreadyDefault")}`);
      await refresh();
    } catch (error: any) {
      setStatus(error.message || t("onboarding.defaultProviderFailed"));
    } finally {
      setBusy(null);
    }
  };

  const handleCreateBackup = async () => {
    setBusy("backup");
    setStatus(null);
    try {
      const result = await createBackup();
      setStatus(t("onboarding.backupCreated", { file: result.backup.file }));
      await refresh();
    } catch (error: any) {
      setStatus(error.message || t("onboarding.backupFailed"));
    } finally {
      setBusy(null);
    }
  };

  const handleEnableDailyBackup = async () => {
    setBusy("backup-schedule");
    setStatus(null);
    try {
      const result = await updateBackupSchedule({ enabled: true, intervalHours: 24 });
      setBackupSchedule(result.schedule);
      setStatus(t("onboarding.dailyBackupStatus"));
      await refresh();
    } catch (error: any) {
      setStatus(error.message || t("onboarding.dailyBackupFailed"));
    } finally {
      setBusy(null);
    }
  };

  const handleCompleteOnboarding = async () => {
    setBusy("complete");
    setStatus(null);
    try {
      const result = await completeOnboarding();
      setOnboarding(result.onboarding);
      setStatus(t("onboarding.doneStatus"));
      window.location.href = result.onboarding.nextPath || "/chat";
    } catch (error: any) {
      setStatus(error.message || t("onboarding.doneFailed"));
      await refresh().catch(() => null);
    } finally {
      setBusy(null);
    }
  };

  const handleDesktopRecoveryAction = async (action: "logs" | "copyLogs" | "copyAddress" | "diagnostics") => {
    const desktop = (window as any).lifeosDesktop;
    if (!desktop) {
      setStatus(t("onboarding.desktopActionsUnavailable"));
      return;
    }
    setBusy(`desktop-${action}`);
    setStatus(null);
    try {
      if (action === "logs") {
        await desktop.openLogsFolder();
        setStatus(t("onboarding.logsOpened"));
      } else if (action === "copyLogs") {
        const logsPath = await desktop.copyLogsPath();
        setStatus(t("onboarding.logsPathCopied", { path: logsPath || "-" }));
      } else if (action === "copyAddress") {
        const localAddress = await desktop.copyLocalAddress();
        setStatus(t("onboarding.localAddressCopied", { address: localAddress || "-" }));
      } else {
        const outputPath = await desktop.exportDiagnostics();
        setStatus(outputPath ? t("onboarding.diagnosticsExported", { path: outputPath }) : t("onboarding.diagnosticsCancelled"));
      }
    } catch (error: any) {
      setStatus(error.message || t("onboarding.desktopActionFailed"));
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="min-h-screen bg-[#060a10] p-5 text-zinc-100">
      <main className="mx-auto flex min-h-[calc(100vh-40px)] max-w-5xl flex-col justify-center">
        <div className="mb-8">
          <div className="mb-4 flex items-center justify-between gap-3">
            <div className="inline-flex items-center gap-2 rounded-full border border-cyan-400/20 bg-cyan-500/10 px-3 py-1 text-xs font-bold text-cyan-200">
              <Sparkles className="h-3.5 w-3.5" />
              {t("onboarding.badge")}
            </div>
            <LanguageSwitcher compact />
          </div>
          <h1 className="text-3xl font-bold tracking-tight">{t("onboarding.title")}</h1>
          <p className="mt-3 max-w-2xl text-sm leading-relaxed text-zinc-400">
            {t("onboarding.description")}
          </p>
          <div className="mt-5 max-w-xl rounded-2xl border border-white/[0.08] bg-white/[0.03] p-4">
            <div className="flex items-center justify-between text-xs font-bold text-zinc-400">
              <span>{t("onboarding.progress")}</span>
              <span>{completedSteps} / 4</span>
            </div>
            <div className="mt-3 h-2 overflow-hidden rounded-full bg-white/[0.06]">
              <div className="h-full rounded-full bg-cyan-400 transition-all" style={{ width: `${(completedSteps / 4) * 100}%` }} />
            </div>
            {onboarding?.completed ? (
              <div className="mt-3 text-xs font-bold text-emerald-300">
                {onboarding.completedAt ? t("onboarding.completedAt", { time: new Date(onboarding.completedAt).toLocaleString() }) : t("onboarding.completed")}
              </div>
            ) : (
              <div className="mt-3 text-xs text-zinc-500">{t("onboarding.progressHint")}</div>
            )}
          </div>
        </div>

        {status ? <div className="mb-5 rounded-2xl border border-white/[0.08] bg-white/[0.03] p-4 text-sm text-zinc-300">{status}</div> : null}

        {onboarding ? (
          <section className="mb-5 grid gap-4 lg:grid-cols-[1.15fr_0.85fr]">
            <div className="rounded-[28px] border border-cyan-400/15 bg-cyan-500/10 p-5">
              <div className="text-xs font-bold uppercase tracking-[0.18em] text-cyan-200/75">{t("onboarding.nextStepTitle")}</div>
              <h2 className="mt-2 text-xl font-bold text-zinc-50">
                {nextStep ? localizedStepMeta(nextStep.id, nextStep.done).label : t("onboarding.completed")}
              </h2>
              <p className="mt-2 max-w-2xl text-sm leading-relaxed text-cyan-50/85">
                {nextStep ? localizedStepMeta(nextStep.id, nextStep.done).message : t("onboarding.doneStatus")}
              </p>
              <div className="mt-4 flex flex-wrap gap-3">
                <a
                  href={nextStep?.actionPath || "/chat"}
                  className="inline-flex items-center justify-center gap-2 rounded-xl bg-white px-4 py-3 text-sm font-bold text-[#061016]"
                >
                  {nextStep ? t("onboarding.goNextStep") : t("onboarding.startFirstChat")}
                  <ArrowRight className="h-4 w-4" />
                </a>
                <a
                  href={nextStep ? "/admin/settings" : "/admin/dashboard"}
                  className="inline-flex items-center justify-center gap-2 rounded-xl border border-white/[0.12] bg-[#060a10]/40 px-4 py-3 text-sm font-bold text-zinc-100"
                >
                  {nextStep ? t("onboarding.continueSettings") : t("onboarding.enterDashboard")}
                </a>
              </div>
            </div>

            <div className="rounded-[28px] border border-white/[0.08] bg-[#101722] p-5">
              <div className="text-sm font-bold text-zinc-100">{t("onboarding.checklistTitle")}</div>
              <div className="mt-3 grid gap-2">
                {onboarding.steps.map((step) => {
                  const localized = localizedStepMeta(step.id, step.done);
                  return (
                  <a
                    key={step.id}
                    href={step.actionPath}
                    className={`rounded-2xl border p-3 text-left text-sm transition-colors ${
                      step.done
                        ? "border-emerald-400/15 bg-emerald-500/10 text-emerald-100"
                        : "border-white/[0.06] bg-white/[0.03] text-zinc-200 hover:bg-white/[0.05]"
                    }`}
                  >
                    <div className="flex items-center justify-between gap-3">
                      <span className="font-bold">{localized.label}</span>
                      {step.done ? <CheckCircle2 className="h-4 w-4 text-emerald-300" /> : <ArrowRight className="h-4 w-4 text-zinc-500" />}
                    </div>
                    <div className={`mt-1 text-xs leading-relaxed ${step.done ? "text-emerald-100/80" : "text-zinc-400"}`}>{localized.message}</div>
                  </a>
                  );
                })}
              </div>
              <OnboardingRecoveryCard busy={busy} desktopBridgeAvailable={desktopBridgeAvailable} onDesktopRecoveryAction={handleDesktopRecoveryAction} />
            </div>
          </section>
        ) : null}

        {diagnostics ? (
          <section className={`mb-5 rounded-[28px] border p-5 ${
            diagnostics.securityCheck.overall === "critical"
              ? "border-red-400/25 bg-red-500/10"
              : diagnostics.securityCheck.overall === "warning"
                ? "border-amber-400/25 bg-amber-500/10"
                : "border-emerald-400/20 bg-emerald-500/10"
          }`}>
            <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
              <div className="flex gap-3">
                <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl border border-white/[0.08] bg-[#060a10]/60">
                  {securityRiskCount ? <ShieldAlert className="h-5 w-5 text-amber-200" /> : <CheckCircle2 className="h-5 w-5 text-emerald-200" />}
                </div>
                <div>
                  <div className="flex flex-wrap items-center gap-2">
                    <h2 className="font-bold">{t("onboarding.securityCheck")}</h2>
                    <span className="rounded-full border border-white/[0.08] bg-[#060a10]/50 px-2.5 py-1 text-[11px] font-bold text-zinc-200">
                      {securityRiskCount ? t("onboarding.securityTodo", { count: securityRiskCount }) : t("onboarding.securityPassed")}
                    </span>
                  </div>
                  <p className="mt-2 max-w-2xl text-sm leading-relaxed text-zinc-300/80">
                    {t("onboarding.securityDescription")}
                  </p>
                </div>
              </div>
              <a href="/admin/settings" className="inline-flex shrink-0 items-center justify-center gap-2 rounded-xl border border-white/[0.12] bg-[#060a10]/55 px-4 py-3 text-sm font-bold text-zinc-100 hover:bg-white/[0.08]">
                <ShieldAlert className="h-4 w-4" />
                {t("onboarding.handleSecurity")}
              </a>
            </div>
            <div className="mt-4 grid gap-2 md:grid-cols-2">
              {securityItems.map((item) => (
                <div key={item.id} className="rounded-2xl border border-white/[0.08] bg-[#060a10]/45 p-3 text-xs">
                  <div className="flex items-center justify-between gap-3">
                    <span className="font-bold text-zinc-100">{item.label}</span>
                    <span className={`rounded-full px-2 py-0.5 text-[10px] font-bold ${
                      item.status === "critical"
                        ? "bg-red-500/15 text-red-100"
                        : item.status === "warning"
                          ? "bg-amber-500/15 text-amber-100"
                          : "bg-emerald-500/15 text-emerald-100"
                    }`}>
                      {item.status === "critical" ? t("common.risk") : item.status === "warning" ? t("common.warning") : t("common.ok")}
                    </span>
                  </div>
                  <div className="mt-2 leading-relaxed text-zinc-300">{item.message}</div>
                  <div className="mt-1 flex gap-2 leading-relaxed text-zinc-500">
                    {item.status !== "ok" ? <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-amber-300" /> : null}
                    <span>{item.action}</span>
                  </div>
                </div>
              ))}
            </div>
          </section>
        ) : null}

        <div className="grid gap-4 lg:grid-cols-3">
          <section className="rounded-[28px] border border-white/[0.08] bg-[#101722] p-5">
            <StepHeader done={aiConfigured} icon={<KeyRound className="h-5 w-5" />} title={t("onboarding.aiTitle")} />
            <p className="mt-3 text-sm leading-relaxed text-zinc-400">
              {t("onboarding.aiDescription")}
            </p>
            <div className="mt-5 grid grid-cols-2 gap-2">
              {providers.map((provider) => (
                <button
                  key={provider.id}
                  type="button"
                  onClick={() => setSelectedProvider(provider.id)}
                  className={`rounded-2xl border px-3 py-2 text-left text-xs font-bold ${selectedProvider === provider.id ? "border-cyan-400/40 bg-cyan-500/10 text-cyan-100" : "border-white/[0.06] bg-white/[0.03] text-zinc-300"}`}
                >
                  <span className="block truncate">{providerLabels[provider.id]}</span>
                  <span className={`mt-1 block text-[10px] ${provider.configured ? "text-emerald-300" : "text-zinc-500"}`}>
                    {provider.active ? t("onboarding.activeDefault") : provider.configured ? t("onboarding.securityPassed") : t("common.warning")}
                  </span>
                </button>
              ))}
            </div>
            {activeProvider ? (
              <>
                <div className="mt-4 rounded-2xl border border-white/[0.06] bg-white/[0.03] p-3 text-xs leading-relaxed text-zinc-400">
                  <div className="flex items-center justify-between gap-3">
                    <span className="font-bold text-zinc-200">{t("onboarding.defaultProvider")}</span>
                    <span className={`rounded-full px-2 py-0.5 text-[10px] font-bold ${activeProvider.active ? "bg-emerald-500/15 text-emerald-200" : "bg-white/[0.06] text-zinc-400"}`}>
                      {activeProvider.active ? t("onboarding.activeDefault") : t("onboarding.notDefault")}
                    </span>
                  </div>
                  <p className="mt-2">{t("onboarding.providerHint")}</p>
                </div>
                <div className="mt-4">
                  <label className="mb-2 block text-xs font-bold uppercase tracking-wider text-zinc-500">{t("onboarding.modelLabel", { provider: providerLabels[selectedProvider] })}</label>
                  {selectedProvider === "local" ? (
                    <>
                      <input
                        value={selectedModel}
                        onChange={(event) => setSelectedModel(event.target.value)}
                        list="lifeos-onboarding-local-models"
                        aria-label={t("onboarding.modelLabel", { provider: providerLabels[selectedProvider] })}
                        disabled={busy === "ai"}
                        placeholder="llama3.2"
                        className="w-full rounded-xl border border-white/[0.08] bg-[#060a10] px-4 py-3 text-sm outline-none focus:border-cyan-400/60 disabled:opacity-55"
                      />
                      <datalist id="lifeos-onboarding-local-models">
                        {(activeProvider.models || []).map((model) => <option key={model} value={model} />)}
                      </datalist>
                    </>
                  ) : (
                    <select
                      value={selectedModel}
                      onChange={(event) => setSelectedModel(event.target.value)}
                      aria-label={t("onboarding.modelLabel", { provider: providerLabels[selectedProvider] })}
                      disabled={busy === "ai"}
                      className="w-full rounded-xl border border-white/[0.08] bg-[#060a10] px-4 py-3 text-sm outline-none focus:border-cyan-400/60 disabled:opacity-55"
                    >
                      {(activeProvider.models || []).map((model) => <option key={model} value={model}>{model}</option>)}
                    </select>
                  )}
                </div>
              </>
            ) : null}
            <label className="mt-5 block text-xs font-bold uppercase tracking-wider text-zinc-500">
              {isLocalProvider ? t("onboarding.localEndpointLabel") : t("onboarding.apiKeyLabel")}
            </label>
            <input
              value={apiKey}
              onChange={(event) => setApiKey(event.target.value)}
              type={isLocalProvider ? "url" : "password"}
              inputMode={isLocalProvider ? "url" : "text"}
              autoCapitalize="none"
              autoCorrect="off"
              disabled={busy === "ai" || activeProvider?.source === "environment"}
              placeholder={isLocalProvider ? "http://127.0.0.1:11434/v1" : activeProvider?.source === "environment" ? t("onboarding.envConfigured", { envVar: activeProvider.envVar }) : t("onboarding.apiKeyPlaceholder")}
              className="mt-2 w-full rounded-xl border border-white/[0.08] bg-[#060a10] px-4 py-3 text-sm outline-none focus:border-cyan-400/60 disabled:opacity-55"
            />
            <p className="mt-2 text-xs leading-relaxed text-zinc-500">
              {isLocalProvider ? t("onboarding.localEndpointHint") : t("onboarding.apiKeyHint")}
            </p>
            <button
              onClick={handleSaveAiKey}
              disabled={busy === "ai" || activeProvider?.source === "environment"}
              className="mt-3 inline-flex w-full items-center justify-center gap-2 rounded-xl bg-cyan-500 px-4 py-3 text-sm font-bold text-[#061016] disabled:opacity-50"
            >
              {busy === "ai" ? <Loader2 className="h-4 w-4 animate-spin" /> : <KeyRound className="h-4 w-4" />}
              {t("onboarding.saveAndTest")}
            </button>
            <button
              onClick={handleSetDefaultProvider}
              disabled={busy === "ai-default" || activeProvider?.active}
              className="mt-3 inline-flex w-full items-center justify-center gap-2 rounded-xl border border-white/[0.08] bg-white/[0.03] px-4 py-3 text-sm font-bold text-zinc-200 disabled:opacity-50"
            >
              {busy === "ai-default" ? <Loader2 className="h-4 w-4 animate-spin" /> : <CheckCircle2 className="h-4 w-4" />}
              {activeProvider?.active ? t("onboarding.alreadyDefault") : t("onboarding.setDefault")}
            </button>
          </section>

          <section className="rounded-[28px] border border-white/[0.08] bg-[#101722] p-5">
            <StepHeader done={hasBackup} icon={<DatabaseBackup className="h-5 w-5" />} title={t("onboarding.backupTitle")} />
            <p className="mt-3 text-sm leading-relaxed text-zinc-400">
              {t("onboarding.backupDescription")}
            </p>
            <div className="mt-5 rounded-2xl border border-white/[0.06] bg-white/[0.03] p-4 text-xs leading-relaxed text-zinc-400">
              <div>{t("onboarding.dataDir", { value: diagnostics?.storage.dataDir || "-" })}</div>
              <div>{t("onboarding.retention", { count: diagnostics?.storage.backupRetentionCount || "20" })}</div>
              <div>{t("onboarding.backupCount", { count: backups.length })}</div>
              <div>
                {backupSchedule?.enabled
                  ? t("onboarding.backupScheduleOn", { hours: backupSchedule.intervalHours })
                  : t("onboarding.backupScheduleOff")}
              </div>
              {backupSchedule?.nextRunAt ? <div>{t("onboarding.nextBackup", { time: new Date(backupSchedule.nextRunAt).toLocaleString() })}</div> : null}
              <div className="mt-2 truncate text-emerald-300">{latestBackup?.file || t("onboarding.noInitialBackup")}</div>
            </div>
            {hasBackup && !backupSchedule?.enabled ? (
              <div className="mt-3 rounded-2xl border border-amber-400/20 bg-amber-500/10 p-3 text-xs leading-relaxed text-amber-100">
                <div className="font-bold">{t("onboarding.longTermBackupReminderTitle")}</div>
                <div className="mt-1 text-amber-100/80">{t("onboarding.longTermBackupReminderBody")}</div>
              </div>
            ) : null}
            <div className="mt-5 grid gap-3">
              <button
                onClick={handleCreateBackup}
                disabled={busy === "backup"}
                className="inline-flex w-full items-center justify-center gap-2 rounded-xl border border-emerald-400/20 bg-emerald-500/10 px-4 py-3 text-sm font-bold text-emerald-200 disabled:opacity-50"
              >
                {busy === "backup" ? <Loader2 className="h-4 w-4 animate-spin" /> : <DatabaseBackup className="h-4 w-4" />}
                {t("onboarding.createBackup")}
              </button>
              <button
                onClick={handleEnableDailyBackup}
                disabled={busy === "backup-schedule" || backupSchedule?.enabled}
                className="inline-flex w-full items-center justify-center gap-2 rounded-xl border border-cyan-400/20 bg-cyan-500/10 px-4 py-3 text-sm font-bold text-cyan-200 disabled:opacity-50"
              >
                {busy === "backup-schedule" ? <Loader2 className="h-4 w-4 animate-spin" /> : <DatabaseBackup className="h-4 w-4" />}
                {backupSchedule?.enabled ? t("onboarding.dailyBackupEnabled") : t("onboarding.enableDailyBackup")}
              </button>
            </div>
          </section>

          <OnboardingMobileCard devices={devices} diagnostics={diagnostics?.network} done={hasDevice} />
        </div>

        <div className="mt-6 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <a href="/admin/settings" className="text-sm font-bold text-zinc-400 hover:text-cyan-200">
            {t("onboarding.continueSettings")}
          </a>
          <div className="flex flex-col gap-2 sm:items-end">
            <div className={`max-w-xl text-xs leading-relaxed ${onboarding?.completed ? "text-emerald-300" : "text-amber-200"}`}>
              {finishHint}
            </div>
            <div className="flex flex-col gap-2 sm:flex-row">
              <button
                onClick={handleCompleteOnboarding}
                disabled={!onboarding?.completed || busy === "complete"}
                className="inline-flex items-center justify-center gap-2 rounded-xl bg-white px-5 py-3 text-sm font-bold text-[#061016] disabled:cursor-not-allowed disabled:opacity-50"
              >
                {busy === "complete" ? <Loader2 className="h-4 w-4 animate-spin" /> : <CheckCircle2 className="h-4 w-4" />}
                {t("onboarding.finish")}
              </button>
              <a href="/admin/dashboard" className="inline-flex items-center justify-center gap-2 rounded-xl border border-white/[0.08] bg-white/[0.03] px-5 py-3 text-sm font-bold text-zinc-200">
                {t("onboarding.enterDashboard")}
                <ArrowRight className="h-4 w-4" />
              </a>
            </div>
          </div>
        </div>
      </main>
    </div>
  );
}

function StepHeader({ done, icon, title }: { done: boolean; icon: React.ReactNode; title: string }) {
  return (
    <div className="flex items-center justify-between gap-3">
      <div className="flex items-center gap-3">
        <div className="flex h-11 w-11 items-center justify-center rounded-2xl border border-cyan-400/20 bg-cyan-500/10 text-cyan-300">
          {icon}
        </div>
        <h2 className="font-bold">{title}</h2>
      </div>
      {done ? <CheckCircle2 className="h-5 w-5 text-emerald-300" /> : null}
    </div>
  );
}
