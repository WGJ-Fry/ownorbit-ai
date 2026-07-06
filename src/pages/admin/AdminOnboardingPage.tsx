import { useEffect, useMemo, useState } from "react";
import type React from "react";
import { AlertTriangle, ArrowRight, CheckCircle2, DatabaseBackup, KeyRound, Loader2, QrCode, ShieldAlert, SlidersHorizontal, Sparkles } from "lucide-react";
import { cleanupIcloudHandoffEntries, completeOnboarding, createBackup, exportIcloudHandoff, getBackupSchedule, getConfigDiagnostics, getNetworkDiagnostics, getOnboardingStatus, listAiProviders, listBackups, listDevices, saveAiProviderKey, saveDesktopConnectionConfig, startCloudflareTunnel, startTailscaleHttpsServe, testAiProvider, testConnectionUrl, updateActiveAiProvider, updateAiProviderModel, updateBackupSchedule } from "../../services/lifeosApi";
import type { AiProviderId, AiProviderStatus, BackupRecord, BackupSchedule, BoundDevice, ConfigDiagnostics, NetworkDiagnostics, OnboardingStatus } from "../../services/lifeosApi";
import LanguageSwitcher from "../../i18n/LanguageSwitcher";
import { useI18n } from "../../i18n/I18nProvider";
import OnboardingAppleRemoteCard from "./OnboardingAppleRemoteCard";
import OnboardingHandoffCard from "./OnboardingHandoffCard";
import OnboardingRecoveryCard from "./OnboardingRecoveryCard";
import { buildOnboardingHandoffSummary } from "../../services/onboardingHandoffSummary";

const providerLabels: Record<string, string> = {
  gemini: "Google Gemini",
  openai: "OpenAI",
  openrouter: "OpenRouter",
  local: "Local Model",
};

export default function AdminOnboardingPage() {
  const { t } = useI18n();
  const [diagnostics, setDiagnostics] = useState<ConfigDiagnostics | null>(null);
  const [networkDiagnostics, setNetworkDiagnostics] = useState<NetworkDiagnostics | null>(null);
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
  const [autoIcloudExportAttempted, setAutoIcloudExportAttempted] = useState(false);

  const activeProvider = useMemo(() => providers.find((provider) => provider.id === selectedProvider), [providers, selectedProvider]);
  const isLocalProvider = selectedProvider === "local";
  const selectedProviderLabel = activeProvider?.provider || providerLabels[selectedProvider] || selectedProvider;
  const aiConfigured = providers.some((provider) => provider.configured);
  const latestBackup = backups[0];
  const hasBackup = backups.length > 0;
  const hasDevice = devices.some((device) => device.status !== "revoked");
  const onboardingSteps = Array.isArray(onboarding?.steps) ? onboarding.steps : [];
  const securityReady = onboardingSteps.find((step) => step.id === "security")?.done ?? diagnostics?.securityCheck.overall !== "critical";
  const primaryStep = !aiConfigured ? "ai" : !securityReady ? "security" : !hasDevice ? "device" : "chat";
  const primaryStepNumber = primaryStep === "ai" ? 1 : primaryStep === "device" ? 2 : 3;
  const primaryStepsTotal = 3;
  const primaryProgress = primaryStep === "chat" ? 3 : primaryStepNumber - 1;
  const securityItems = diagnostics?.securityCheck.items || [];
  const securityRiskCount = securityItems.filter((item) => item.status !== "ok").length;
  const remoteReady = networkDiagnostics?.remoteReadiness?.severity === "ok";
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
  const incompleteStepLabels = onboardingSteps
    .filter((step) => step.required !== false && !step.done)
    .map((step) => localizedStepMeta(step.id, step.done).label) || [];
  const finishHint = onboarding?.completed
    ? t("onboarding.finishReady")
    : t("onboarding.finishBlocked", { steps: incompleteStepLabels.join(t("onboarding.stepSeparator")) || t("onboarding.unknownStep") });

  const refresh = async () => {
    const [providerData, diagnosticsData, backupData, scheduleData, deviceData, onboardingData, networkData] = await Promise.all([
      listAiProviders(),
      getConfigDiagnostics(),
      listBackups(),
      getBackupSchedule(),
      listDevices(),
      getOnboardingStatus(),
      getNetworkDiagnostics().catch(() => null),
    ]);
    setProviders(providerData.providers);
    setDiagnostics(diagnosticsData);
    setNetworkDiagnostics(networkData);
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

  useEffect(() => {
    const icloud = networkDiagnostics?.icloud;
    if (primaryStep !== "device" || busy || autoIcloudExportAttempted || !icloud?.canExport || !icloud.handoffHealth?.needsRefresh) return;
    let cancelled = false;
    setAutoIcloudExportAttempted(true);
    setBusy("icloud-handoff-auto");
    setStatus(t("onboarding.appleRemoteIcloudAutoSyncing"));
    exportIcloudHandoff()
      .then((result) => {
        if (cancelled) return;
        setNetworkDiagnostics(result.diagnostics);
        setStatus(t("onboarding.appleRemoteIcloudAutoExported", { path: result.handoff.handoffFilePath || "-" }));
      })
      .catch(async (error: any) => {
        if (cancelled) return;
        setStatus(error.message || t("onboarding.appleRemoteIcloudExportFailed"));
        await getNetworkDiagnostics().then(setNetworkDiagnostics).catch(() => null);
      })
      .finally(() => {
        if (!cancelled) setBusy(null);
      });
    return () => {
      cancelled = true;
    };
  }, [primaryStep, busy, autoIcloudExportAttempted, networkDiagnostics?.icloud?.canExport, networkDiagnostics?.icloud?.handoffHealth?.status, t]);

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

  const handleStartTailscaleRemote = async () => {
    setBusy("remote-tailscale");
    setStatus(null);
    try {
      const result = await startTailscaleHttpsServe();
      setNetworkDiagnostics(result.diagnostics);
      setStatus(result.message || t("onboarding.appleRemoteTailscaleStarted"));
    } catch (error: any) {
      setStatus(error.message || t("onboarding.appleRemoteActionFailed"));
      await getNetworkDiagnostics().then(setNetworkDiagnostics).catch(() => null);
    } finally {
      setBusy(null);
    }
  };

  const handleStartCloudflareRemote = async () => {
    setBusy("remote-cloudflare");
    setStatus(null);
    try {
      const result = await startCloudflareTunnel();
      setNetworkDiagnostics(result.diagnostics);
      setStatus(result.message || t("onboarding.appleRemoteCloudflareStarted"));
    } catch (error: any) {
      setStatus(error.message || t("onboarding.appleRemoteActionFailed"));
      await getNetworkDiagnostics().then(setNetworkDiagnostics).catch(() => null);
    } finally {
      setBusy(null);
    }
  };

  const handleExportIcloudHandoff = async () => {
    setBusy("icloud-handoff");
    setStatus(null);
    try {
      const result = await exportIcloudHandoff();
      setNetworkDiagnostics(result.diagnostics);
      setStatus(t("onboarding.appleRemoteIcloudExported", { path: result.handoff.handoffFilePath || "-" }));
    } catch (error: any) {
      setStatus(error.message || t("onboarding.appleRemoteIcloudExportFailed"));
      await getNetworkDiagnostics().then(setNetworkDiagnostics).catch(() => null);
    } finally {
      setBusy(null);
    }
  };

  const handleCleanupIcloudHandoff = async () => {
    setBusy("icloud-handoff-cleanup");
    setStatus(null);
    try {
      const result = await cleanupIcloudHandoffEntries();
      setNetworkDiagnostics(result.diagnostics);
      setStatus(t("onboarding.appleRemoteIcloudCleanupDone", {
        entries: result.handoff.cleanup.removedEntryCount,
        files: result.handoff.cleanup.removedOrphanedFileCount,
      }));
    } catch (error: any) {
      setStatus(error.message || t("onboarding.appleRemoteIcloudCleanupFailed"));
      await getNetworkDiagnostics().then(setNetworkDiagnostics).catch(() => null);
    } finally {
      setBusy(null);
    }
  };

  const handleSaveRemoteCandidate = async (candidate: NetworkDiagnostics["connectionCandidates"][number]) => {
    setBusy("remote-save");
    setStatus(null);
    try {
      const result = await saveDesktopConnectionConfig({
        mode: candidate.mode,
        label: candidate.label,
        baseUrl: candidate.baseUrl,
      });
      setStatus(result.restartRequired ? t("onboarding.appleRemoteSavedRestart", { url: candidate.baseUrl }) : t("onboarding.appleRemoteSaved", { url: candidate.baseUrl }));
      const nextDiagnostics = await getNetworkDiagnostics();
      setNetworkDiagnostics(nextDiagnostics);
    } catch (error: any) {
      setStatus(error.message || t("onboarding.appleRemoteActionFailed"));
    } finally {
      setBusy(null);
    }
  };

  const handleTestRemoteCandidate = async (candidate: NetworkDiagnostics["connectionCandidates"][number]) => {
    setBusy("remote-test");
    setStatus(null);
    try {
      const result = await testConnectionUrl(candidate.baseUrl, { label: candidate.label });
      setStatus(result.result.ok ? t("onboarding.appleRemoteTestOk", { url: candidate.baseUrl }) : t("onboarding.appleRemoteTestFailed", { url: candidate.baseUrl }));
      await getNetworkDiagnostics().then(setNetworkDiagnostics).catch(() => null);
    } catch (error: any) {
      setStatus(error.message || t("onboarding.appleRemoteActionFailed"));
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

  const handleCopyHandoffSummary = async () => {
    const summary = buildOnboardingHandoffSummary({
      providers,
      backups,
      backupSchedule,
      devices,
      diagnostics,
      onboarding,
    });
    try {
      await navigator.clipboard.writeText(summary);
      setStatus(t("onboarding.handoffSummaryCopied"));
    } catch (error: any) {
      setStatus(error.message || t("onboarding.handoffSummaryCopyFailed"));
    }
  };

  return (
    <div className="min-h-screen bg-[#060a10] p-5 text-zinc-100">
      <main className="mx-auto flex min-h-[calc(100vh-40px)] max-w-3xl flex-col justify-center">
        <div className="mb-6">
          <div className="mb-4 flex items-center justify-between gap-3">
            <div className="inline-flex items-center gap-2 rounded-full border border-cyan-400/20 bg-cyan-500/10 px-3 py-1 text-xs font-bold text-cyan-200">
              <Sparkles className="h-3.5 w-3.5" />
              {t("onboarding.simpleEyebrow")}
            </div>
            <LanguageSwitcher compact />
          </div>
          <h1 className="text-3xl font-bold tracking-tight">{t("onboarding.simpleTitle")}</h1>
          <p className="mt-3 max-w-2xl text-sm leading-relaxed text-zinc-400">
            {t("onboarding.simpleBody")}
          </p>
          <div className="mt-5 rounded-2xl border border-white/[0.08] bg-white/[0.03] p-4">
            <div className="flex items-center justify-between text-xs font-bold text-zinc-400">
              <span>{t("onboarding.simpleProgress")}</span>
              <span data-testid="onboarding-progress-count">{primaryProgress} / {primaryStepsTotal}</span>
            </div>
            <div className="mt-3 h-2 overflow-hidden rounded-full bg-white/[0.06]">
              <div className="h-full rounded-full bg-cyan-400 transition-all" style={{ width: `${(primaryProgress / primaryStepsTotal) * 100}%` }} />
            </div>
          </div>
        </div>

        {status ? <div className="mb-5 rounded-2xl border border-white/[0.08] bg-white/[0.03] p-4 text-sm text-zinc-300">{status}</div> : null}

        {primaryStep === "ai" ? (
          <section id="onboarding-ai-key" className="scroll-mt-5 rounded-[28px] border border-cyan-400/20 bg-[#101722] p-5 shadow-2xl shadow-cyan-950/20">
            <StepHeader done={aiConfigured} icon={<KeyRound className="h-5 w-5" />} title={t("onboarding.simpleAiTitle")} />
            <p className="mt-3 text-sm leading-relaxed text-zinc-400">{t("onboarding.simpleAiBody")}</p>

            <label className="mt-5 block text-xs font-bold uppercase tracking-wider text-zinc-500">
              {t("onboarding.simpleProviderLabel")}
            </label>
            <select
              value={selectedProvider}
              onChange={(event) => setSelectedProvider(event.target.value as AiProviderId)}
              aria-label={t("onboarding.simpleProviderLabel")}
              disabled={busy === "ai"}
              className="mt-2 w-full rounded-xl border border-white/[0.08] bg-[#060a10] px-4 py-3 text-sm font-bold text-zinc-100 outline-none focus:border-cyan-400/60 disabled:opacity-55"
            >
              {providers.map((provider) => (
                <option key={provider.id} value={provider.id}>
                  {provider.provider || providerLabels[provider.id] || provider.id}
                </option>
              ))}
            </select>

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

            {activeProvider ? (
              <details className="mt-4 rounded-2xl border border-white/[0.06] bg-white/[0.03] p-3 text-sm">
                <summary className="cursor-pointer text-xs font-bold text-zinc-300">{t("onboarding.simpleModelOptional")}</summary>
                <label className="mt-4 block text-xs font-bold uppercase tracking-wider text-zinc-500">{t("onboarding.modelLabel", { provider: selectedProviderLabel })}</label>
                <input
                  value={selectedModel}
                  onChange={(event) => setSelectedModel(event.target.value)}
                  list={selectedProvider === "local" ? "lifeos-onboarding-local-models" : "lifeos-onboarding-cloud-models"}
                  aria-label={t("onboarding.modelLabel", { provider: selectedProviderLabel })}
                  disabled={busy === "ai"}
                  placeholder={activeProvider.defaultModel || (selectedProvider === "local" ? "llama3.2" : "model-id")}
                  className="mt-2 w-full rounded-xl border border-white/[0.08] bg-[#060a10] px-4 py-3 text-sm outline-none focus:border-cyan-400/60 disabled:opacity-55"
                />
                <datalist id="lifeos-onboarding-local-models">
                  {(activeProvider.models || []).map((model) => <option key={model} value={model} />)}
                </datalist>
                <datalist id="lifeos-onboarding-cloud-models">
                  {(activeProvider.models || []).map((model) => <option key={model} value={model} />)}
                </datalist>
              </details>
            ) : null}

            <button
              onClick={handleSaveAiKey}
              disabled={busy === "ai" || activeProvider?.source === "environment"}
              className="mt-5 inline-flex w-full items-center justify-center gap-2 rounded-xl bg-cyan-500 px-4 py-3 text-sm font-bold text-[#061016] disabled:opacity-50"
            >
              {busy === "ai" ? <Loader2 className="h-4 w-4 animate-spin" /> : <KeyRound className="h-4 w-4" />}
              {t("onboarding.simpleSaveAndContinue")}
            </button>
          </section>
        ) : null}

        {primaryStep === "security" ? (
          <section className="rounded-[28px] border border-red-400/25 bg-red-500/10 p-5">
            <StepHeader done={false} icon={<ShieldAlert className="h-5 w-5" />} title={t("onboarding.simpleSecurityTitle")} />
            <p className="mt-3 text-sm leading-relaxed text-red-50/80">{t("onboarding.simpleSecurityBody")}</p>
            <div className="mt-4 grid gap-2">
              {securityItems.filter((item) => item.status !== "ok").slice(0, 3).map((item) => (
                <div key={item.id} className="rounded-2xl border border-red-300/15 bg-[#060a10]/45 p-3 text-xs">
                  <div className="font-bold text-zinc-100">{item.label}</div>
                  <div className="mt-1 leading-relaxed text-zinc-300">{item.message}</div>
                  <div className="mt-1 flex gap-2 leading-relaxed text-red-100/80">
                    <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                    <span>{item.action}</span>
                  </div>
                </div>
              ))}
            </div>
            <a href="/admin/settings" className="mt-5 inline-flex w-full items-center justify-center gap-2 rounded-xl bg-white px-4 py-3 text-sm font-bold text-[#061016]">
              <ShieldAlert className="h-4 w-4" />
              {t("onboarding.handleSecurity")}
            </a>
          </section>
        ) : null}

        {primaryStep === "device" ? (
          <section className="rounded-[28px] border border-cyan-400/20 bg-[#101722] p-5 shadow-2xl shadow-cyan-950/20">
            <StepHeader done={hasDevice} icon={<QrCode className="h-5 w-5" />} title={t("onboarding.simpleDeviceTitle")} />
            <p className="mt-3 text-sm leading-relaxed text-zinc-400">{t("onboarding.simpleDeviceBody")}</p>
            <div className="mt-5 rounded-2xl border border-white/[0.06] bg-white/[0.03] p-4 text-xs leading-relaxed text-zinc-400">
              {remoteReady ? t("onboarding.simpleRemoteReady") : t("onboarding.simpleSameWifiHint")}
            </div>
            <div className="mt-5">
              <OnboardingAppleRemoteCard
                diagnostics={networkDiagnostics}
                busy={busy}
                onExportIcloud={handleExportIcloudHandoff}
                onCleanupIcloud={handleCleanupIcloudHandoff}
                onStartTailscale={handleStartTailscaleRemote}
                onStartCloudflare={handleStartCloudflareRemote}
                onSaveCandidate={handleSaveRemoteCandidate}
                onTestCandidate={handleTestRemoteCandidate}
              />
            </div>
          </section>
        ) : null}

        {primaryStep === "chat" ? (
          <section className="rounded-[28px] border border-emerald-400/20 bg-emerald-500/10 p-5 shadow-2xl shadow-emerald-950/20">
            <StepHeader done icon={<CheckCircle2 className="h-5 w-5" />} title={t("onboarding.simpleChatTitle")} />
            <p className="mt-3 text-sm leading-relaxed text-emerald-50/80">{t("onboarding.simpleChatBody")}</p>
            <div className="mt-4 rounded-2xl border border-white/[0.08] bg-[#060a10]/45 p-3 text-xs leading-relaxed text-emerald-50/75">
              {finishHint}
            </div>
            <button
              onClick={handleCompleteOnboarding}
              disabled={!onboarding?.completed || busy === "complete"}
              className="mt-5 inline-flex w-full items-center justify-center gap-2 rounded-xl bg-white px-4 py-3 text-sm font-bold text-[#061016] disabled:opacity-50"
            >
              {busy === "complete" ? <Loader2 className="h-4 w-4 animate-spin" /> : <ArrowRight className="h-4 w-4" />}
              {t("onboarding.simpleStartChat")}
            </button>
          </section>
        ) : null}

        <details className="mt-5 rounded-[24px] border border-white/[0.08] bg-white/[0.025] p-4">
          <summary className="flex cursor-pointer items-center gap-2 text-sm font-bold text-zinc-300">
            <SlidersHorizontal className="h-4 w-4 text-cyan-200" />
            {t("onboarding.simpleAdvancedSummary")}
          </summary>
          <div className="mt-4 grid gap-4">
            <section className="rounded-[22px] border border-white/[0.08] bg-[#101722] p-4">
              <StepHeader done={hasBackup} icon={<DatabaseBackup className="h-5 w-5" />} title={t("onboarding.backupTitle")} />
              <p className="mt-3 text-sm leading-relaxed text-zinc-400">{t("onboarding.backupDescription")}</p>
              <div className="mt-4 rounded-2xl border border-white/[0.06] bg-white/[0.03] p-3 text-xs leading-relaxed text-zinc-400">
                <div>{t("onboarding.dataDir", { value: diagnostics?.storage.dataDir || "-" })}</div>
                <div>{t("onboarding.backupCount", { count: backups.length })}</div>
                <div>{backupSchedule?.enabled ? t("onboarding.backupScheduleOn", { hours: backupSchedule.intervalHours }) : t("onboarding.backupScheduleOff")}</div>
                {backupSchedule?.nextRunAt ? <div>{t("onboarding.nextBackup", { time: new Date(backupSchedule.nextRunAt).toLocaleString() })}</div> : null}
                <div className="mt-2 truncate text-emerald-300">{latestBackup?.file || t("onboarding.noInitialBackup")}</div>
              </div>
              <div className="mt-4 grid gap-3 sm:grid-cols-2">
                <button onClick={handleCreateBackup} disabled={busy === "backup"} className="inline-flex items-center justify-center gap-2 rounded-xl border border-emerald-400/20 bg-emerald-500/10 px-4 py-3 text-sm font-bold text-emerald-200 disabled:opacity-50">
                  {busy === "backup" ? <Loader2 className="h-4 w-4 animate-spin" /> : <DatabaseBackup className="h-4 w-4" />}
                  {t("onboarding.createBackup")}
                </button>
                <button onClick={handleEnableDailyBackup} disabled={busy === "backup-schedule" || backupSchedule?.enabled} className="inline-flex items-center justify-center gap-2 rounded-xl border border-cyan-400/20 bg-cyan-500/10 px-4 py-3 text-sm font-bold text-cyan-200 disabled:opacity-50">
                  {busy === "backup-schedule" ? <Loader2 className="h-4 w-4 animate-spin" /> : <DatabaseBackup className="h-4 w-4" />}
                  {backupSchedule?.enabled ? t("onboarding.dailyBackupEnabled") : t("onboarding.enableDailyBackup")}
                </button>
              </div>
            </section>

            {primaryStep !== "device" ? (
              <OnboardingAppleRemoteCard
                diagnostics={networkDiagnostics}
                busy={busy}
                onExportIcloud={handleExportIcloudHandoff}
                onCleanupIcloud={handleCleanupIcloudHandoff}
                onStartTailscale={handleStartTailscaleRemote}
                onStartCloudflare={handleStartCloudflareRemote}
                onSaveCandidate={handleSaveRemoteCandidate}
                onTestCandidate={handleTestRemoteCandidate}
              />
            ) : null}

            {diagnostics ? (
              <section className={`rounded-[22px] border p-4 ${
                diagnostics.securityCheck.overall === "critical"
                  ? "border-red-400/25 bg-red-500/10"
                  : diagnostics.securityCheck.overall === "warning"
                    ? "border-amber-400/25 bg-amber-500/10"
                    : "border-emerald-400/20 bg-emerald-500/10"
              }`}>
                <StepHeader done={securityRiskCount === 0} icon={<ShieldAlert className="h-5 w-5" />} title={t("onboarding.securityCheck")} />
                <p className="mt-3 text-sm leading-relaxed text-zinc-300/80">{t("onboarding.securityDescription")}</p>
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

            {onboarding ? (
              <section className="rounded-[22px] border border-white/[0.08] bg-[#101722] p-4">
                <div className="text-sm font-bold text-zinc-100">{t("onboarding.checklistTitle")}</div>
                <div className="mt-3 grid gap-2">
                  {onboardingSteps.map((step) => {
                    const localized = localizedStepMeta(step.id, step.done);
                    return (
                      <a key={step.id} href={step.actionPath} className={`rounded-2xl border p-3 text-left text-sm transition-colors ${step.done ? "border-emerald-400/15 bg-emerald-500/10 text-emerald-100" : "border-white/[0.06] bg-white/[0.03] text-zinc-200 hover:bg-white/[0.05]"}`}>
                        <div className="flex items-center justify-between gap-3">
                          <span className="font-bold">{localized.label}{step.required === false ? <span className="ml-2 text-[10px] text-zinc-500">{t("onboarding.optionalStep")}</span> : null}</span>
                          {step.done ? <CheckCircle2 className="h-4 w-4 text-emerald-300" /> : <ArrowRight className="h-4 w-4 text-zinc-500" />}
                        </div>
                        <div className={`mt-1 text-xs leading-relaxed ${step.done ? "text-emerald-100/80" : "text-zinc-400"}`}>{localized.message}</div>
                      </a>
                    );
                  })}
                </div>
                <OnboardingRecoveryCard busy={busy} desktopBridgeAvailable={desktopBridgeAvailable} onDesktopRecoveryAction={handleDesktopRecoveryAction} />
              </section>
            ) : null}
          </div>
        </details>

        {onboarding?.completed ? <OnboardingHandoffCard onCopySummary={handleCopyHandoffSummary} /> : null}

        <div className="mt-6 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <a href="/admin/dashboard" className="text-sm font-bold text-zinc-400 hover:text-cyan-200">
            {t("onboarding.enterDashboard")}
          </a>
          <a href="/admin/settings" className="text-sm font-bold text-zinc-400 hover:text-cyan-200">
            {t("onboarding.continueSettings")}
          </a>
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
