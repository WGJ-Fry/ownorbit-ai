import { useState, useMemo, useEffect, useRef, DragEvent, ChangeEvent, KeyboardEvent } from "react";
import { CustomApp } from "../../types";
import { motion, AnimatePresence } from "motion/react";
import { useSyncedClientState } from "../../hooks/useSyncedClientState";
import { useI18n } from "../../i18n/I18nProvider";
import { deriveProblemBlueprint } from "../../services/problemBlueprint";
import { formatHtmlLikeCode } from "./studio/codeUtils";
import { analyzeFile, generateStudioApp, refineCode } from "./studio/api";
import StudioByokTab from "./studio/StudioByokTab";
import StudioSidebar, { StudioTab } from "./studio/StudioSidebar";
import StudioEditorHeader from "./studio/StudioEditorHeader";
import StudioShellHeader from "./studio/StudioShellHeader";
import StudioDragOverlay from "./studio/StudioDragOverlay";
import StudioDeveloperEditor from "./studio/StudioDeveloperEditor";
import StudioImportWizardModal from "./studio/StudioImportWizardModal";
import StudioMemoryTab from "./studio/StudioMemoryTab";
import StudioOverviewTab from "./studio/StudioOverviewTab";
import StudioProxyTab from "./studio/StudioProxyTab";
import StudioRefinePanel from "./studio/StudioRefinePanel";
import StudioResponsivePreview from "./studio/StudioResponsivePreview";
import StudioSettingsTab from "./studio/StudioSettingsTab";
import { useStudioSimulatorState } from "./studio/useStudioSimulatorState";
import { useStudioConnectionSettings } from "./studio/useStudioConnectionSettings";
import { useStudioProblemBlueprintHistory } from "./studio/useStudioProblemBlueprintHistory";
import { useStudioRuntimeDebug } from "./studio/useStudioRuntimeDebug";
import StudioWorkshopTab from "./studio/StudioWorkshopTab";
export default function StudioApp({ customApps, onClose, onUpdateCode, onDeleteApp, onOpenApp, onAddApp }: {
  customApps: CustomApp[];
  onClose: () => void;
  onUpdateCode: (id: string, code: string) => void;
  onDeleteApp?: (id: string) => void;
  onOpenApp?: (id: string) => void;
  onAddApp?: (app: CustomApp) => void;
}) {
  const { t } = useI18n();
  const [editingAppId, setEditingAppId] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<StudioTab>("overview");
  const [localCode, setLocalCode] = useState("");
  const [runningCode, setRunningCode] = useState("");
  const [editorActiveTab, setEditorActiveTab] = useState<"code" | "guide">("code");

  const [isImportWizardOpen, setIsImportWizardOpen] = useState(false);
  const [wizardAppName, setWizardAppName] = useState("");
  const [promptInput, setPromptInput] = useState("");
  const [problemInput, setProblemInput] = useState("");
  const [isGeneratingApp, setIsGeneratingApp] = useState(false);
  const [generationError, setGenerationError] = useState<string | null>(null);
  const problemBlueprint = useMemo(() => deriveProblemBlueprint(problemInput), [problemInput]);

  const [isDragging, setIsDragging] = useState(false);
  const [refineInstruction, setRefineInstruction] = useState("");
  const [isRefining, setIsRefining] = useState(false);
  const [isApplyingRuntimeRepair, setIsApplyingRuntimeRepair] = useState(false);
  const [refineError, setRefineError] = useState<string | null>(null);
  const [showRawEditor, setShowRawEditor] = useState<boolean>(false);
  const {
    appendSimulatorLog,
    captureRefineVersion,
    isLandscape,
    previewDevice,
    refineHistory,
    resetForSelectedApp,
    resetSimulatorLogs,
    setIsLandscape,
    setPreviewDevice,
    showConsole,
    simulatorLogs,
    toggleConsole,
  } = useStudioSimulatorState();
  const {
    isLoadingRuntimeEvents,
    isRequestingRuntimeDebug,
    loadRuntimeEvents,
    planRuntimeAutoRepair,
    recordRuntimeDebugApplied,
    requestRuntimeDebug,
    runtimeAutoRepairTask,
    runtimeDebugIssue,
    runtimeEvents,
    runtimeEventsError, runtimeRepairProposal, setRuntimeDebugIssue,
  } = useStudioRuntimeDebug({
    editingAppId,
    t,
    setRefineInstruction,
    appendSimulatorLog,
  });

  const fileInputRef = useRef<HTMLInputElement>(null);
  const {
    attachGeneratedAppToActiveProblemBlueprint,
    handleGenerateFromProblemBlueprint,
    handleRegenerateProblemBlueprint,
    handleRestoreProblemBlueprint,
    isLoadingProblemBlueprints,
    recentProblemBlueprints,
    setActiveProblemBlueprintId,
  } = useStudioProblemBlueprintHistory({
    problemInput,
    problemBlueprint,
    t,
    setProblemInput,
    setWizardAppName,
    setPromptInput,
    setGenerationError,
    setIsImportWizardOpen,
  });

  const installGeneratedApp = (name: string, description: string, code: string) => {
    if (!code.trim()) {
      throw new Error(t("studio.app.errorNoInstallableCode"));
    }

    const generatedApp: CustomApp = {
      id: "custom-" + Date.now().toString(),
      name: name || t("studio.app.defaultGeneratedName"),
      description: description || t("studio.app.defaultGeneratedDescription"),
      visibility: "private",
      status: "active",
      createdAt: Date.now(),
      code: code.trim(),
    };

    if (onAddApp) {
      onAddApp(generatedApp);
    }

    attachGeneratedAppToActiveProblemBlueprint({ appId: generatedApp.id, appName: generatedApp.name });

    setLocalCode(generatedApp.code);
    setRunningCode(generatedApp.code);
    setEditingAppId(generatedApp.id);
    setIsImportWizardOpen(false);
    setPromptInput("");
    setWizardAppName("");
    appendSimulatorLog({ time: "SYSTEM", text: t("studio.app.logGeneratedLoaded", { name: generatedApp.name }), type: "info" });
  };

  const processImportedFile = async (file: File) => {
    setGenerationError(null);
    setIsGeneratingApp(true);
    setIsImportWizardOpen(true);
    setActiveProblemBlueprintId(null);
    setWizardAppName(t("studio.app.analyzing"));
    setPromptInput(t("studio.app.analyzingFile", { file: file.name }));

    try {
      const isImage = file.type.startsWith("image/");
      const reader = new FileReader();

      if (isImage) {
        reader.onload = async (event) => {
          try {
            const dataUrl = event.target?.result as string;
            const base64Data = dataUrl.split(",")[1];
            
            const data = await analyzeFile({
              fileName: file.name,
              fileImageBase64: base64Data,
              mimeType: file.type,
            });
            installGeneratedApp(
              data.appName || t("studio.app.detectedVisualCard"),
              data.description || t("studio.app.visualCardDescription"),
              data.uiCode || "",
            );
          } catch (err: any) {
            console.error(err);
            setGenerationError(err.message || t("studio.app.parseFailed"));
            setWizardAppName(t("studio.app.aiRecognitionFailed"));
          } finally {
            setIsGeneratingApp(false);
          }
        };
        reader.readAsDataURL(file);
      } else {
        reader.onload = async (event) => {
          try {
            const textContent = event.target?.result as string;
            
            const data = await analyzeFile({
              fileName: file.name,
              fileContent: textContent,
            });
            installGeneratedApp(
              data.appName || t("studio.app.defaultGeneratedName"),
              data.description || t("studio.app.migratedDescription"),
              data.uiCode || "",
            );
          } catch (err: any) {
            console.error(err);
            setGenerationError(err.message || t("studio.app.sourceParseFailed"));
            setWizardAppName(t("studio.app.rebuildProblem"));
          } finally {
            setIsGeneratingApp(false);
          }
        };
        reader.readAsText(file);
      }
    } catch (err: any) {
      console.error(err);
      setGenerationError(err.message || t("studio.app.readFileFailed"));
      setIsGeneratingApp(false);
    }
  };

  const handleFileDrop = async (e: DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setIsDragging(false);
    const file = e.dataTransfer.files?.[0];
    if (file) {
      await processImportedFile(file);
    }
  };

  const handleFileInputChange = async (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      await processImportedFile(file);
    }
  };

  const handleGenerateAppByAI = async () => {
    if (!promptInput.trim()) return;
    setIsGeneratingApp(true);
    setGenerationError(null);
    try {
      const finalAppName = wizardAppName.trim() || promptInput.trim().substring(0, 10) + "...";
      const data = await generateStudioApp({
        appName: finalAppName,
        description: promptInput.trim()
      });
      if (!data.uiCode) {
        throw new Error(t("studio.app.aiGenerateFailed"));
      }

      installGeneratedApp(data.appName || finalAppName, promptInput.trim(), data.uiCode);
    } catch (err: any) {
      console.error(err);
      setGenerationError(err.message || t("studio.app.smartGenerateFailed"));
    } finally {
      setIsGeneratingApp(false);
    }
  };

  const handleRefineCode = async (overrideInstruction = "", persist = false) => {
    const instruction = (overrideInstruction || refineInstruction).trim();
    if (!instruction) return;
    setIsRefining(true);
    setRefineError(null);
    try {
      const data = await refineCode({
        currentCode: localCode,
        instruction,
      });
      if (data.refinedCode) {
        captureRefineVersion(instruction, localCode);
        appendSimulatorLog({ time: "COMPILER", text: t("studio.app.logCompileSuccess", { instruction: `${instruction.substring(0, 20)}${instruction.length > 20 ? "..." : ""}` }), type: "info" });
        recordRuntimeDebugApplied(instruction);

        setLocalCode(data.refinedCode);
        setRunningCode(data.refinedCode);
        if (persist && editingAppId) onUpdateCode(editingAppId, data.refinedCode);
        if (!overrideInstruction) setRefineInstruction("");
      } else {
        throw new Error(t("studio.app.emptyRefinedCode"));
      }
    } catch (err: any) {
      console.error(err);
      setRefineError(err.message || t("studio.app.refineFailed"));
    } finally {
      setIsRefining(false);
    }
  };

  const handleApplyRuntimeRepair = async (appId: string) => {
    setIsApplyingRuntimeRepair(true);
    try {
      const response = await planRuntimeAutoRepair(appId);
      if (response?.suggestedInstruction) {
        if (!response.autoRepairTask.canAutoApply) {
          setRefineInstruction(response.suggestedInstruction);
          appendSimulatorLog({ time: "DEBUG", text: t("studio.runtime.manualReviewRequired"), type: "warning" });
          return;
        }
        await handleRefineCode(response.suggestedInstruction, true);
        appendSimulatorLog({ time: "DEBUG", text: t("studio.runtime.debugAppliedAndSaved"), type: "info" });
      }
    } catch (err: any) {
      setRefineError(err.message || t("studio.runtime.applyFailed"));
    } finally {
      setIsApplyingRuntimeRepair(false);
    }
  };

  useEffect(() => {
    if (editingAppId) {
      const targetApp = customApps.find(a => a.id === editingAppId);
      if (targetApp) {
        setLocalCode(targetApp.code || "");
        setRunningCode(targetApp.code || "");
        resetForSelectedApp(targetApp);
      }
    } else {
      setLocalCode("");
      setRunningCode("");
      resetForSelectedApp();
    }
  }, [editingAppId, customApps, resetForSelectedApp]);

  const prettifyCode = () => {
    if (!localCode) return;
    try {
      setLocalCode(formatHtmlLikeCode(localCode));
      appendSimulatorLog({ time: "PRETTIER", text: t("studio.app.logFormatCompleted"), type: "info" });
    } catch (e) {
      console.error("Format Failed:", e);
    }
  };
  
  const handleTextareaKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    // Support Ctrl + S (or Cmd + S) to compile and render instantly in Sandbox
    if ((e.ctrlKey || e.metaKey) && e.key === "s") {
      e.preventDefault();
      setRunningCode(localCode);
      if (editingAppId) {
        onUpdateCode(editingAppId, localCode);
      }
      appendSimulatorLog({ time: "COMPILER", text: t("studio.app.logSaveHotkey"), type: "info" });
    }
    // Support Tab key to insert double spaces
    if (e.key === "Tab") {
      e.preventDefault();
      const textarea = e.currentTarget;
      const start = textarea.selectionStart;
      const end = textarea.selectionEnd;
      const newValue = localCode.substring(0, start) + "  " + localCode.substring(end);
      setLocalCode(newValue);
      setTimeout(() => {
        textarea.selectionStart = textarea.selectionEnd = start + 2;
      }, 0);
    }
  };

  // Dynamic Habits and Memories
  const [memories, setMemories] = useSyncedClientState<any[]>("lifeos_memories", [
    { id: "mem-1", title: t("studio.app.memoryTitleIdentity"), time: t("studio.app.memoryTimeWeek"), content: t("studio.app.memoryContentIdentity"), type: "user" },
    { id: "mem-2", title: t("studio.app.memoryTitleMorning"), time: t("studio.app.memoryTimeThreeDays"), content: t("studio.app.memoryContentMorning"), type: "location" },
    { id: "mem-3", title: t("studio.app.memoryTitleUi"), time: t("studio.app.memoryTimeSystem"), content: t("studio.app.memoryContentUi"), type: "ui" }
  ]);

  const [newMemTitle, setNewMemTitle] = useState("");
  const [newMemContent, setNewMemContent] = useState("");
  const [isAddingMem, setIsAddingMem] = useState(false);

  // Model Engine & TTS Voice States
  const [modelEngine, setModelEngine] = useSyncedClientState("lifeos_model_engine", "Gemini 2.0 Flash");
  const [ttsVoice, setTtsVoice] = useSyncedClientState("lifeos_tts_voice", "Onyx");

  const handleDeleteMemory = (id: string) => {
    const updated = memories.filter(m => m.id !== id);
    setMemories(updated);
  };

  const handleAddMemory = () => {
    if (!newMemTitle.trim() || !newMemContent.trim()) {
      alert(t("studio.app.memoryRequired"));
      return;
    }
    const newMem = {
      id: "mem-" + Date.now(),
      title: newMemTitle.trim(),
      time: t("studio.app.memoryTimeManualNow"),
      content: `“${newMemContent.trim()}”`,
      type: "custom"
    };
    const updated = [newMem, ...memories];
    setMemories(updated);
    setNewMemTitle("");
    setNewMemContent("");
    setIsAddingMem(false);
  };

  const handleClearAllData = () => {
    if (window.confirm(t("studio.app.confirmClearAll"))) {
      Object.keys(localStorage)
        .filter((key) => key.startsWith("lifeos_") || key.startsWith("omnipreview_"))
        .forEach((key) => localStorage.removeItem(key));
      alert(t("studio.app.clearAllDone"));
      window.location.reload();
    }
  };

  const handleBackupData = () => {
    const backupObject = {
      customApps,
      memories,
      byokProvider,
      byokKey,
      proxyEnabled,
      proxyUrl,
      routeMode,
      selectedNodeId,
      proxyNodes,
      modelEngine,
      ttsVoice,
      backupTime: new Date().toISOString()
    };
    
    const blob = new Blob([JSON.stringify(backupObject, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `lifeos_assets_backup_${new Date().toISOString().slice(0, 10)}.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };
  
  const {
    apiTestResult,
    apiTestStatus,
    byokKey,
    byokProvider,
    handleKeyChange,
    handleProviderChange,
    handleProxyUrlChange,
    handleRouteModeChange,
    handleSelectNode,
    isPinging,
    isSyncingSub,
    proxyEnabled,
    proxyNodes,
    proxyUrl,
    routeMode,
    selectedNodeId,
    setProxyEnabled,
    subSyncSucceeded,
    subSyncResult,
    syncSubscription,
    testAllPings,
    testApiConnection,
    toggleProxy,
  } = useStudioConnectionSettings();
  
  const activeAppToEdit = customApps.find(a => a.id === editingAppId);

  const handleCopyToClipboard = async () => {
    try {
      await navigator.clipboard.writeText(localCode);
      alert(t("studio.app.copySuccess"));
    } catch (err) {
      alert(t("studio.app.copyFailed"));
    }
  };

  return (
    <div 
      className="flex h-screen bg-[#050505] text-zinc-300 overflow-hidden relative font-sans w-full"
      onDragOver={(e) => { e.preventDefault(); setIsDragging(true); }}
      onDragEnter={(e) => { e.preventDefault(); setIsDragging(true); }}
    >
      {isDragging && (
        <StudioDragOverlay
          onDragLeave={() => setIsDragging(false)}
          onDrop={handleFileDrop}
        />
      )}

      {/* Sidebar navigation */}
      <StudioSidebar activeTab={activeTab} customApps={customApps} onSelectTab={setActiveTab} />

      {/* Main Workspace Frame panel (Responsive Flex) */}
      <div className="flex-1 flex flex-col h-full bg-[#050505]/30 relative overflow-hidden">
        <StudioShellHeader onClose={onClose} />

        {/* Dynamic Inner Tab scrolling body */}
        <div className="flex-1 overflow-y-auto p-6 md:p-8 space-y-6 scroll-smooth">
          <AnimatePresence mode="wait">

            {/* OVERVIEW TAB */}
            {activeTab === "overview" && (
              <StudioOverviewTab
                customApps={customApps}
                memoriesCount={memories.length}
                modelEngine={modelEngine}
                ttsVoice={ttsVoice}
                proxyEnabled={proxyEnabled}
                proxyNodes={proxyNodes}
                selectedNodeId={selectedNodeId}
                simulatorLogs={simulatorLogs}
                showConsole={showConsole}
                onResetLogs={resetSimulatorLogs}
                onToggleConsole={toggleConsole}
                onOpenSettings={() => setActiveTab("settings")}
              />
            )}

            {activeTab === "workshop" && (
              <StudioWorkshopTab
                customApps={customApps}
                fileInputRef={fileInputRef}
                problemInput={problemInput}
                problemBlueprint={problemBlueprint}
                recentProblemBlueprints={recentProblemBlueprints}
                isLoadingProblemBlueprints={isLoadingProblemBlueprints}
                onClose={onClose}
                onFileInputChange={handleFileInputChange}
                onProblemInputChange={setProblemInput}
                onGenerateFromProblem={handleGenerateFromProblemBlueprint}
                onRestoreProblemBlueprint={handleRestoreProblemBlueprint}
                onRegenerateProblemBlueprint={handleRegenerateProblemBlueprint}
                onOpenImportWizard={() => {
                  setWizardAppName("");
                  setPromptInput("");
                  setActiveProblemBlueprintId(null);
                  setIsImportWizardOpen(true);
                }}
                onOpenApp={onOpenApp}
                onDeleteApp={onDeleteApp}
                onEditApp={(app) => {
                  setEditingAppId(app.id);
                  setLocalCode(app.code || "");
                  setRunningCode(app.code || "");
                }}
              />
              )}

              <StudioImportWizardModal
                isOpen={isImportWizardOpen}
                isGenerating={isGeneratingApp}
                appName={wizardAppName}
                promptInput={promptInput}
                error={generationError}
                onClose={() => {
                  setIsImportWizardOpen(false);
                  setActiveProblemBlueprintId(null);
                }}
                onAppNameChange={setWizardAppName}
                onPromptInputChange={setPromptInput}
                onGenerate={handleGenerateAppByAI}
              />
              {/* MEMORY BANK TAB */}
              {activeTab === "memory" && (
                <StudioMemoryTab
                  memories={memories}
                  isAddingMemory={isAddingMem}
                  newMemoryTitle={newMemTitle}
                  newMemoryContent={newMemContent}
                  onStartAdding={() => setIsAddingMem(true)}
                  onCancelAdding={() => setIsAddingMem(false)}
                  onChangeTitle={setNewMemTitle}
                  onChangeContent={setNewMemContent}
                  onAddMemory={handleAddMemory}
                  onDeleteMemory={handleDeleteMemory}
                />
             )}

             {/* BYOK TAB */}
             {activeTab === "byok" && (
                <StudioByokTab
                  provider={byokProvider}
                  apiKey={byokKey}
                  apiTestStatus={apiTestStatus}
                  apiTestResult={apiTestResult}
                  onProviderChange={handleProviderChange}
                  onKeyChange={handleKeyChange}
                  onTestConnection={testApiConnection}
                />
             )}

             {/* PROXY TAB */}
             {activeTab === "proxy" && (
                <StudioProxyTab
                  proxyEnabled={proxyEnabled}
                  proxyUrl={proxyUrl}
                  routeMode={routeMode}
                  selectedNodeId={selectedNodeId}
                  proxyNodes={proxyNodes}
                  isSyncingSub={isSyncingSub}
                  isPinging={isPinging}
                  subSyncSucceeded={subSyncSucceeded}
                  subSyncResult={subSyncResult}
                  onToggleProxy={toggleProxy}
                  onProxyUrlChange={handleProxyUrlChange}
                  onSyncSubscription={syncSubscription}
                  onSetProxyEnabled={setProxyEnabled}
                  onSelectNode={handleSelectNode}
                  onRouteModeChange={handleRouteModeChange}
                  onTestAllPings={testAllPings}
                />
              )}
              {/* SETTINGS TAB */}
              {activeTab === "settings" && (
                <StudioSettingsTab
                  modelEngine={modelEngine}
                  ttsVoice={ttsVoice}
                  onModelEngineChange={setModelEngine}
                  onTtsVoiceChange={setTtsVoice}
                  onClearAllData={handleClearAllData}
                  onBackupData={handleBackupData}
                />
               )}
            </AnimatePresence>
          </div>
        </div>

      <AnimatePresence>
        {activeAppToEdit && (
          <motion.div
            initial={{ opacity: 0, scale: 0.95 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.95 }}
            className="fixed inset-2 md:inset-6 bg-[#050505]/98 backdrop-blur-3xl z-50 rounded-[32px] border border-white/[0.1] shadow-2xl overflow-hidden flex flex-col font-sans"
          >
            <StudioEditorHeader
              appName={activeAppToEdit.name}
              showRawEditor={showRawEditor}
              onCopy={handleCopyToClipboard}
              onToggleRawEditor={() => setShowRawEditor(!showRawEditor)}
              onCancel={() => setEditingAppId(null)}
              onPublish={() => {
                onUpdateCode && onUpdateCode(activeAppToEdit.id, localCode);
                setEditingAppId(null);
                alert(t("studio.app.publishSuccess", { name: activeAppToEdit.name }));
              }}
            />

            <div className="flex-1 flex overflow-hidden min-h-0 bg-[#0a0a0c]">
               {!showRawEditor ? (
                 <>
                    <StudioRefinePanel
                      appId={activeAppToEdit.id}
                      currentCode={localCode}
                      instruction={refineInstruction}
                      isRefining={isRefining}
                      refineError={refineError}
                      refineHistory={refineHistory}
                      runtimeEvents={runtimeEvents}
                      isLoadingRuntimeEvents={isLoadingRuntimeEvents}
                      runtimeEventsError={runtimeEventsError}
                      runtimeDebugIssue={runtimeDebugIssue} runtimeRepairProposal={runtimeRepairProposal}
                      runtimeAutoRepairTask={runtimeAutoRepairTask}
                      isRequestingRuntimeDebug={isRequestingRuntimeDebug}
                      isApplyingRuntimeRepair={isApplyingRuntimeRepair}
                      onInstructionChange={setRefineInstruction}
                      onRefine={handleRefineCode}
                      onRollback={(version) => {
                        setLocalCode(version.code);
                        setRunningCode(version.code);
                        appendSimulatorLog({ time: "ROLLBACK", text: t("studio.app.logRollback", { instruction: version.instruction.substring(0, 15) }), type: "info" });
                      }}
                      onRuntimeDebugIssueChange={setRuntimeDebugIssue}
                      onRefreshRuntimeEvents={() => void loadRuntimeEvents(activeAppToEdit.id)}
                      onRequestRuntimeDebug={() => void requestRuntimeDebug(activeAppToEdit.id)}
                      onApplyRuntimeRepair={() => void handleApplyRuntimeRepair(activeAppToEdit.id)}
                      onApplyStoredVersionRepair={(instruction) => void handleRefineCode(instruction, true)}
                    />

                    <StudioResponsivePreview
                      runningCode={runningCode}
                      refineInstruction={refineInstruction}
                      isRefining={isRefining}
                      previewDevice={previewDevice}
                      isLandscape={isLandscape}
                      simulatorLogs={simulatorLogs}
                      showConsole={showConsole}
                      onPreviewDeviceChange={setPreviewDevice}
                      onLandscapeChange={setIsLandscape}
                      onAppendSimulatorLog={appendSimulatorLog}
                      onResetLogs={resetSimulatorLogs}
                      onToggleConsole={toggleConsole}
                    />
                  </>
                ) : (
                  <StudioDeveloperEditor
                    editorActiveTab={editorActiveTab}
                    localCode={localCode}
                    runningCode={runningCode}
                    refineInstruction={refineInstruction}
                    isRefining={isRefining}
                    refineError={refineError}
                    onEditorActiveTabChange={setEditorActiveTab}
                    onLocalCodeChange={setLocalCode}
                    onRunningCodeChange={setRunningCode}
                    onRefineInstructionChange={setRefineInstruction}
                    onRefine={handleRefineCode}
                    onPrettifyCode={prettifyCode}
                    onTextareaKeyDown={handleTextareaKeyDown}
                  />
                )}
             </div>
          </motion.div>
        )}
      </AnimatePresence>

    </div>
  );
}
