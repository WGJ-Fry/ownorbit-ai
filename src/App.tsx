import { useState, useRef, useEffect, lazy, Suspense } from "react";
import { Message, ViewMode, CustomApp } from "./types";
import { motion, AnimatePresence } from "motion/react";
import ChatInputBar from "./components/chat/ChatInputBar";
import ChatWidgetBox from "./components/chat/ChatWidgetBox";
import InlineWidgetRenderer from "./components/chat/InlineWidgetRenderer";
import LocalSettingsModal from "./components/chat/LocalSettingsModal";
import MobileChatHeader from "./components/chat/MobileChatHeader";
import OfflineQueueBanner from "./components/chat/OfflineQueueBanner";
import ProfileModal from "./components/chat/ProfileModal";
import VoiceModeOverlay from "./components/chat/VoiceModeOverlay";
import { generateCustomApp, requestChatCompletion } from "./services/aiRuntime";
import { loadStoredChatMessages, persistStoredChatMessages } from "./services/chatMessageStorage";
import { resolveChatStateChanges } from "./services/chatStateChanges";
import { loadMemoriesForChat, loadRuntimeSettings } from "./services/chatRuntimeSettings";
import { useChatPersistence } from "./hooks/useChatPersistence";
import { useOfflineQueueSync } from "./hooks/useOfflineQueueSync";
import { useI18n } from "./i18n/I18nProvider";
import { createCustomAppRecord, deleteCustomAppRecord, listCustomApps, updateCustomAppRecord } from "./services/lifeosApi";

const StudioApp = lazy(() => import("./components/apps/StudioApp"));

export default function App() {
  const { locale, t } = useI18n();
  const [messages, setMessages] = useState<Message[]>(() => {
    return loadStoredChatMessages();
  });
  const [input, setInput] = useState("");
  const [viewMode, setViewMode] = useState<ViewMode>("terminal");
  const [showProfile, setShowProfile] = useState(false);
  const [showVoiceMode, setShowVoiceMode] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [customApps, setCustomApps] = useState<CustomApp[]>([]);
  const [customAppsHydrated, setCustomAppsHydrated] = useState(false);
  
  const [saveStatus, setSaveStatus] = useState<string | null>(null);
  const [voiceState, setVoiceState] = useState<"speaking" | "listening" | "processing">("listening");
  const [voiceRecognitionText, setVoiceRecognitionText] = useState("");
  const recognitionRef = useRef<any>(null);
  
  const [attachedImage, setAttachedImage] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [isLoading, setIsLoading] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const { createAndUseChatSession, flushOfflineMessages, loadMessagesFromCore, persistMessageToCore } = useChatPersistence();
  const {
    clearQueuedMessages,
    networkStatus,
    offlineQueueItems,
    offlineQueueSummary,
    offlineSyncStatus,
    removeQueuedMessage,
    retryQueuedMessage,
    syncQueuedMessages,
  } = useOfflineQueueSync(flushOfflineMessages, {
    clearConfirmMessage: (summary) => t("mobileDevice.confirmClearQueueDetailed", {
      count: summary.count,
      pending: summary.pending,
      syncing: summary.syncing,
      failed: summary.failed,
    }),
  });

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const data = await listCustomApps(100);
        let nextApps: CustomApp[] = data.apps;
        try {
          const rawLegacyApps = localStorage.getItem("lifeos_apps");
          const legacyApps = rawLegacyApps ? JSON.parse(rawLegacyApps) : [];
          if (Array.isArray(legacyApps)) {
            const knownIds = new Set(nextApps.map((app) => app.id));
            const missingApps = legacyApps.filter((app) => app?.id && !knownIds.has(app.id));
            for (const app of missingApps) {
              const saved = await createCustomAppRecord(app, "migration").catch(() => null);
              if (saved?.app && !knownIds.has(saved.app.id)) {
                knownIds.add(saved.app.id);
                nextApps = [saved.app, ...nextApps];
              }
            }
          }
        } catch (legacyError) {
          console.warn("Failed to migrate local custom apps:", legacyError);
        }
        if (!cancelled) setCustomApps(nextApps);
      } catch (error) {
        console.warn("Failed to load custom apps:", error);
      } finally {
        if (!cancelled) setCustomAppsHydrated(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    let cancelled = false;

    (async () => {
      try {
        await flushOfflineMessages();
        const data = await loadMessagesFromCore();
        if (!cancelled && data.messages.length > 0) {
          setMessages(data.messages.map((item) => item.contentJson));
        }
      } catch (error) {
        console.warn("Failed to load server chat history:", error);
        try {
          await createAndUseChatSession();
        } catch (createError) {
          console.warn("Failed to create fallback chat session:", createError);
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, []);

  // Submits spoken command and routes the server response to speech synthesizer
  const submitVoiceCommand = async (command: string) => {
    if (!command.trim() || isLoading) return;
    
    if (viewMode !== "terminal") setViewMode("terminal");

    const parts = [{ text: command.trim() }];
    const userMessage: Message = { role: "user", parts };
    const newMessages = [...messages, userMessage];
    setMessages(newMessages);
    void persistMessageToCore(userMessage);
    setIsLoading(true);

    try {
      const historyForApi = newMessages.map(m => ({ role: m.role, parts: m.parts }));

      const memories = await loadMemoriesForChat();
      const { providerId, modelEngine, byokProvider, ttsVoice, proxyNode, routeMode } = await loadRuntimeSettings();

      const data = await requestChatCompletion({
        providerId,
        message: command,
        history: historyForApi.slice(0, -1),
        modelEngine,
        byokProvider,
        ttsVoice,
        memories,
        proxyNode,
        routeMode,
        locale,
      });
      
      const { widgetToShow, widgetArgs } = handleChatStateChanges(data.stateChanges);

      const modelMessage: Message = { role: "model", parts: [{ text: data.text }], widget: widgetToShow, widgetArgs };
      setMessages((prev) => [...prev, modelMessage]);
      void persistMessageToCore(modelMessage);

      // Speak back TTS
      setVoiceState("speaking");
      const cleanText = (data.text || t("chat.configSynced")).replace(/[\*\#\_\`\[\]\(\)]/g, "");
      const utterance = new SpeechSynthesisUtterance(cleanText);
      utterance.lang = locale;
      utterance.rate = 1.0;
      utterance.pitch = 1.0;

      const voices = window.speechSynthesis?.getVoices() || [];
      const preferredVoice = voices.find(v => v.lang.toLowerCase().startsWith(locale.toLowerCase().slice(0, 2))) || voices.find(v => v.name.includes("Google"));
      if (preferredVoice) {
        utterance.voice = preferredVoice;
      }

      utterance.onend = () => {
        setVoiceState("listening");
        try {
          if (recognitionRef.current) recognitionRef.current.start();
        } catch (err) {}
      };

      utterance.onerror = () => {
        setVoiceState("listening");
        try {
          if (recognitionRef.current) recognitionRef.current.start();
        } catch (err) {}
      };

      window.speechSynthesis?.cancel();
      window.speechSynthesis?.speak(utterance);

    } catch (err) {
      console.error(err);
      const errorMessage: Message = { role: "model", parts: [{ text: err instanceof Error ? err.message : t("chat.networkError") }] };
      setMessages((prev) => [...prev, errorMessage]);
      void persistMessageToCore(errorMessage);
      setVoiceState("listening");
      try {
        if (recognitionRef.current) recognitionRef.current.start();
      } catch (err) {}
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    if (!showVoiceMode) {
      if (recognitionRef.current) {
        recognitionRef.current.stop();
      }
      window.speechSynthesis?.cancel();
      return;
    }

    const SpeechRecognition = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    if (SpeechRecognition) {
      const rec = new SpeechRecognition();
      rec.continuous = false;
      rec.interimResults = false;
      rec.lang = locale;

      rec.onstart = () => {
        setVoiceState("listening");
        setVoiceRecognitionText("");
      };

      rec.onresult = (event: any) => {
        const transcript = event.results[event.results.length - 1][0].transcript;
        if (transcript) {
          setVoiceRecognitionText(transcript);
          setVoiceState("processing");
          submitVoiceCommand(transcript);
        }
      };

      rec.onerror = (e: any) => {
        console.error("Speech Recognition Error:", e);
        // Only restart if voiceMode remains active and not processing or speaking
        if (showVoiceMode && voiceState === "listening") {
          try { rec.start(); } catch(err) {}
        }
      };

      rec.onend = () => {
        // If it stopped and we didn't receive result/processing/speaking, restart it
        if (showVoiceMode && voiceState === "listening") {
          try { rec.start(); } catch(err) {}
        }
      };

      recognitionRef.current = rec;
      try {
        rec.start();
      } catch (err) {}
    } else {
      console.warn("Speech recognition is not supported in this browser.");
    }

    return () => {
      if (recognitionRef.current) recognitionRef.current.stop();
      window.speechSynthesis?.cancel();
    };
  }, [showVoiceMode, voiceState]);

  useEffect(() => {
    if (viewMode === "terminal") {
      messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
    }
  }, [messages, viewMode]);

  useEffect(() => {
    const result = persistStoredChatMessages(messages);
    if (result.ok === false) {
      console.warn("Failed to persist local chat message cache:", result.error);
    }
  }, [messages]);

  const handleSend = async () => {
    const currentInputText = input.trim();
    if ((!currentInputText && !attachedImage) || isLoading) return;
    
    if (viewMode !== "terminal") setViewMode("terminal");

    const parts = [];
    if (attachedImage) {
      const mimeType = attachedImage.split(';')[0].split(':')[1];
      const data = attachedImage.split(',')[1];
      parts.push({
        inlineData: { mimeType, data }
      });
    }
    if (currentInputText) {
      parts.push({ text: currentInputText });
    }

    const userMessage: Message = { role: "user", parts };
    const newMessages = [...messages, userMessage];
    setMessages(newMessages);
    void persistMessageToCore(userMessage);
    setInput("");
    setAttachedImage(null);
    if (inputRef.current) inputRef.current.style.height = 'auto'; // reset height
    setIsLoading(true);

    try {
      const historyForApi = newMessages.map(m => ({ role: m.role, parts: m.parts }));

      const memories = await loadMemoriesForChat();
      const { providerId, modelEngine, byokProvider, ttsVoice, proxyNode, routeMode } = await loadRuntimeSettings();

      const data = await requestChatCompletion({
        providerId,
        message: currentInputText,
        history: historyForApi.slice(0, -1),
        modelEngine,
        byokProvider,
        ttsVoice,
        memories,
        proxyNode,
        routeMode,
        locale,
      });
      
      const { widgetToShow, widgetArgs } = handleChatStateChanges(data.stateChanges);

      const modelMessage: Message = { role: "model", parts: [{ text: data.text }], widget: widgetToShow, widgetArgs };
      setMessages((prev) => [...prev, modelMessage]);
      void persistMessageToCore(modelMessage);
    } catch (err) {
      console.error(err);
      const errorMessage: Message = { role: "model", parts: [{ text: err instanceof Error ? err.message : t("chat.networkError") }] };
      setMessages((prev) => [...prev, errorMessage]);
      void persistMessageToCore(errorMessage);
    } finally {
      setIsLoading(false);
      setTimeout(() => inputRef.current?.focus(), 50);
    }
  };

  const handleChatStateChanges = (stateChanges?: Array<Record<string, any>>) => {
    const resolved = resolveChatStateChanges(stateChanges);
    if (resolved.shouldOpenStudio) setViewMode("studio");
    if (resolved.generatedApps.length > 0) {
      setCustomApps((prev) => [...prev, ...resolved.generatedApps]);
      for (const app of resolved.generatedApps) {
        void createCustomAppRecord(app, "chat").catch((error) => console.warn("Failed to save generated custom app draft:", error));
        generateAppBackground(app.id, app.name, app.description);
      }
    }
    return {
      widgetToShow: resolved.widgetToShow,
      widgetArgs: resolved.widgetArgs,
    };
  };

  const generateAppBackground = async (appId: string, appName: string, description: string) => {
    try {
      const data = await generateCustomApp(appName, description);
      const updatedApp = { id: appId, name: data.appName || appName, description, visibility: "private" as const, status: "active" as const, code: data.uiCode, createdAt: Date.now() };
      setCustomApps(prev => prev.map(a => a.id === appId ? { ...a, ...updatedApp } : a));
      void updateCustomAppRecord(appId, updatedApp).catch((error) => console.warn("Failed to save generated custom app code:", error));
      
      const readyMessage: Message = {
        role: "model",
        parts: [{ text: t("chat.appReady", { appName: data.appName }) }],
        widget: appId
      };
      setMessages(prev => [...prev, readyMessage]);
      void persistMessageToCore(readyMessage);
      
      setTimeout(() => {
        messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
      }, 100);
    } catch (e) {
      console.error(e);
      setCustomApps(prev => prev.filter(a => a.id !== appId));
      void deleteCustomAppRecord(appId).catch(() => null);
      const failureMessage: Message = {
        role: "model",
        parts: [{ text: e instanceof Error ? e.message : t("chat.appFailed", { appName }) }]
      };
      setMessages(prev => [...prev, failureMessage]);
      void persistMessageToCore(failureMessage);
    }
  };

  const updateCustomAppCode = (id: string, code: string) => {
    setCustomApps(prev => prev.map(app => app.id === id ? { ...app, code } : app));
    void updateCustomAppRecord(id, { code }).catch((error) => console.warn("Failed to save custom app code:", error));
  };

  const addCustomApp = (app: CustomApp, source: "studio" | "chat" | "import" | "migration" = "studio") => {
    setCustomApps(prev => [app, ...prev.filter(item => item.id !== app.id)]);
    void createCustomAppRecord(app, source).then(({ app: savedApp }) => {
      setCustomApps(prev => [savedApp, ...prev.filter(item => item.id !== savedApp.id)]);
    }).catch((error) => console.warn("Failed to save custom app:", error));
  };

  const deleteCustomApp = (id: string) => {
    setCustomApps(prev => prev.filter(app => app.id !== id));
    void deleteCustomAppRecord(id).catch((error) => console.warn("Failed to delete custom app:", error));
  };

  useEffect(() => {
    if (!customAppsHydrated) return;
    const params = new URLSearchParams(window.location.search);
    const appId = params.get("openApp");
    if (!appId || !customApps.some((app) => app.id === appId)) return;
    const openAppMessage: Message = {
      role: "model",
      parts: [{ text: t("chat.openApp") }],
      widget: appId,
    };
    setMessages(prev => [...prev, openAppMessage]);
    void persistMessageToCore(openAppMessage);
    window.history.replaceState(null, "", "/mobile/chat");
  }, [customAppsHydrated, customApps, persistMessageToCore, t]);

  return (
    <div className="flex justify-center bg-black text-zinc-100 h-screen font-sans selection:bg-indigo-500/30 overflow-hidden relative">
      
      {/* Studio View Overlay */}
      <AnimatePresence>
        {viewMode === "studio" && (
          <motion.div 
            initial={{ opacity: 0, scale: 0.98, filter: "blur(5px)" }}
            animate={{ opacity: 1, scale: 1, filter: "blur(0px)" }}
            exit={{ opacity: 0, scale: 0.98, filter: "blur(5px)" }}
            transition={{ type: "spring", damping: 25, stiffness: 200 }}
            className="absolute inset-0 z-40 p-0 sm:p-4 md:p-8 flex items-center justify-center bg-black/60 backdrop-blur-2xl"
          >
            <Suspense fallback={
              <div className="w-full h-full max-w-6xl bg-[#111113] border border-white/[0.08] rounded-[32px] flex items-center justify-center text-sm font-bold text-zinc-400">
                {t("common.loadingStudio")}
              </div>
            }>
              <StudioApp 
                customApps={customApps} 
                onClose={() => setViewMode("terminal")} 
                onUpdateCode={updateCustomAppCode}
                onDeleteApp={deleteCustomApp}
                onAddApp={(app: CustomApp) => addCustomApp(app, "studio")}
                onOpenApp={(id) => {
                  setViewMode("terminal");
                  setTimeout(() => {
                    const openAppMessage: Message = {
                      role: "model",
                      parts: [{ text: t("chat.openApp") }],
                      widget: id
                    };
                    setMessages(prev => [...prev, openAppMessage]);
                    void persistMessageToCore(openAppMessage);
                  }, 300);
                }}
              />
            </Suspense>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Profile Modal Overlay */}
      <AnimatePresence>
        {showProfile && (
          <ProfileModal
            onClose={() => setShowProfile(false)}
            onOpenSettings={() => {
              setShowProfile(false);
              setShowSettings(true);
            }}
          />
        )}
      </AnimatePresence>

      {/* Settings / Local Deployment Overlay */}
      <AnimatePresence>
        {showSettings && (
          <LocalSettingsModal
            onClose={() => setShowSettings(false)}
            saveStatus={saveStatus}
            onSave={() => {
              setSaveStatus(t("chat.configSaving"));
              setTimeout(() => setSaveStatus(t("chat.configSaved")), 1000);
              setTimeout(() => {
                setSaveStatus(null);
                setShowSettings(false);
              }, 2500);
            }}
          />
        )}
      </AnimatePresence>

      {/* Live Voice Mode Overlay */}
      <AnimatePresence>
        {showVoiceMode && (
          <VoiceModeOverlay
            voiceState={voiceState}
            voiceRecognitionText={voiceRecognitionText}
            onClose={() => setShowVoiceMode(false)}
            onSetVoiceState={setVoiceState}
            onSetRecognitionText={setVoiceRecognitionText}
            onSubmitCommand={submitVoiceCommand}
          />
        )}
        </AnimatePresence>

      {/* Main Terminal View (Phone Profile Layout) */}
      <div className="w-full max-w-[500px] bg-[#09090b] flex flex-col h-full relative shadow-[0_0_80px_rgba(0,0,0,0.5)] border-x [border-color:transparent] sm:border-white/[0.05]">
        <MobileChatHeader onOpenStudio={() => setViewMode("studio")} onOpenProfile={() => setShowProfile(true)} />
        
        {/* Chat Feed */}
        <div className="flex-1 overflow-y-auto px-4 sm:px-6 py-6 space-y-7 scroll-smooth bg-gradient-to-b from-transparent to-[#09090b] hide-scrollbar pb-32">
          <OfflineQueueBanner
            items={offlineQueueItems}
            status={offlineSyncStatus}
            summary={offlineQueueSummary}
            onClear={clearQueuedMessages}
            onRemove={removeQueuedMessage}
            onRetry={(id) => void retryQueuedMessage(id)}
            onSyncAll={() => void syncQueuedMessages(true)}
            network={networkStatus}
          />
           <AnimatePresence initial={false}>
            {messages.map((msg, i) => (
              <motion.div 
                initial={{ opacity: 0, y: 15, scale: 0.98 }}
                animate={{ opacity: 1, y: 0, scale: 1 }}
                key={i} 
                className={`flex w-full ${msg.role === "user" ? "justify-end" : "justify-start"}`}
              >
                <div className={`max-w-[95%] sm:max-w-[90%] flex flex-col w-auto ${msg.role === "user" ? "items-end" : "items-start"}`}>
                  
                  {/* Text Bubble */}
                  <div className={`px-4.5 py-3 text-[15px] leading-[1.6] relative font-medium ${
                    msg.role === "user" 
                      ? "bg-indigo-600 text-white rounded-[24px] rounded-br-[8px] xl:shadow-[0_4px_16px_0_rgba(79,70,229,0.3)] flex flex-col gap-2" 
                      : "bg-[#18181b] text-zinc-200 rounded-[24px] rounded-tl-[8px] border border-white/[0.05] shadow-sm"
                  }`}>
                     {msg.parts.map((p, idx) => (
                       <div key={idx}>
                         {p.inlineData && (
                           <img 
                             src={`data:${p.inlineData.mimeType};base64,${p.inlineData.data}`} 
                             alt="attachment" 
                             className="max-w-full rounded-xl w-48 object-cover border border-white/10"
                           />
                         )}
                         {p.text && <span className="whitespace-pre-wrap block">{p.text}</span>}
                       </div>
                     ))}
                  </div>
                  
                  {/* Inline App Widget */}
                  {msg.widget && (
                    <motion.div initial={{opacity:0, y: 10}} animate={{opacity:1, y: 0}} transition={{type:"spring", delay: 0.1}}>
                      <ChatWidgetBox widgetName={msg.widget} customApps={customApps} initialExpanded={i === messages.length - 1}>
                        <InlineWidgetRenderer widgetName={msg.widget} widgetArgs={msg.widgetArgs} customApps={customApps} />
                      </ChatWidgetBox>
                    </motion.div>
                  )}

                </div>
              </motion.div>
            ))}
          </AnimatePresence>

          {isLoading && (
            <motion.div initial={{opacity:0}} animate={{opacity:1}} exit={{opacity:0}} className="flex w-full justify-start">
               <div className="px-5 py-4 rounded-[24px] rounded-tl-[8px] bg-[#18181b] border border-white/[0.05] flex items-center space-x-1.5 h-[52px]">
                 <motion.div className="w-1.5 h-1.5 rounded-full bg-indigo-500" animate={{y:[-3,3,-3]}} transition={{repeat:Infinity, duration:1, ease:"easeInOut"}} />
                 <motion.div className="w-1.5 h-1.5 rounded-full bg-indigo-500" animate={{y:[-3,3,-3]}} transition={{repeat:Infinity, duration:1, delay:0.2, ease:"easeInOut"}} />
                 <motion.div className="w-1.5 h-1.5 rounded-full bg-indigo-500" animate={{y:[-3,3,-3]}} transition={{repeat:Infinity, duration:1, delay:0.4, ease:"easeInOut"}} />
               </div>
            </motion.div>
          )}
          <div ref={messagesEndRef} className="h-4" />
        </div>

        <ChatInputBar
          input={input}
          attachedImage={attachedImage}
          isLoading={isLoading}
          inputRef={inputRef}
          fileInputRef={fileInputRef}
          onInputChange={setInput}
          onAttachImage={setAttachedImage}
          onOpenVoiceMode={() => setShowVoiceMode(true)}
          onSend={handleSend}
        />

      </div>
    </div>
  );
}
