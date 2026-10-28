import { useEffect, useMemo, useState } from "react";
import { Bot, ImageIcon, MessageSquareText, RefreshCw, Smartphone, UserRound } from "lucide-react";
import { ChatSession, StoredChatMessage, getChatSessionMessages, listChatSessions } from "../../services/lifeosApi";
import { useI18n } from "../../i18n/I18nProvider";

export default function AdminChatPage() {
  const { t } = useI18n();
  const [sessions, setSessions] = useState<ChatSession[]>([]);
  const [activeSessionId, setActiveSessionId] = useState<string | null>(null);
  const [messages, setMessages] = useState<StoredChatMessage[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const activeSession = useMemo(
    () => sessions.find((session) => session.id === activeSessionId) || null,
    [sessions, activeSessionId],
  );

  const loadSessions = async () => {
    setError(null);
    const data = await listChatSessions();
    setSessions(data.sessions);
    if (!activeSessionId && data.sessions[0]) {
      setActiveSessionId(data.sessions[0].id);
    }
    if (activeSessionId && !data.sessions.some((session) => session.id === activeSessionId)) {
      setActiveSessionId(data.sessions[0]?.id || null);
    }
  };

  const loadActiveMessages = async (sessionId: string) => {
    const data = await getChatSessionMessages(sessionId);
    setMessages(data.messages);
  };

  const refresh = async () => {
    setIsLoading(true);
    try {
      await loadSessions();
      const sessionId = activeSessionId || sessions[0]?.id;
      if (sessionId) await loadActiveMessages(sessionId);
      else setMessages([]);
    } catch (err: any) {
      setError(err.message || t("adminChat.loadFailed"));
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    refresh();
    const interval = window.setInterval(() => {
      loadSessions().catch(console.error);
      if (activeSessionId) loadActiveMessages(activeSessionId).catch(console.error);
    }, 5000);
    return () => window.clearInterval(interval);
  }, [activeSessionId]);

  return (
    <div className="min-h-screen bg-[#060a10] text-zinc-100 p-6">
      <div className="max-w-7xl mx-auto">
        <header className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between mb-6">
          <div>
            <div className="flex items-center gap-3">
              <a href="/admin/dashboard" className="text-sm text-zinc-500 hover:text-cyan-300 font-bold">{t("adminChat.console")}</a>
              <span className="text-zinc-700">/</span>
              <h1 className="text-2xl font-bold">{t("adminChat.title")}</h1>
            </div>
            <p className="text-sm text-zinc-400 mt-1">{t("adminChat.description")}</p>
          </div>
          <button onClick={refresh} className="inline-flex items-center justify-center gap-2 rounded-xl border border-white/[0.08] bg-white/[0.03] px-4 py-2 text-sm font-bold hover:bg-white/[0.06]">
            <RefreshCw className={`w-4 h-4 ${isLoading ? "animate-spin" : ""}`} />
            {t("common.refresh")}
          </button>
        </header>

        {error && <div className="mb-6 rounded-2xl border border-red-500/20 bg-red-500/10 p-4 text-sm text-red-200">{error}</div>}

        <main className="grid lg:grid-cols-[360px_1fr] gap-5">
          <aside className="rounded-[28px] border border-white/[0.08] bg-[#101722] overflow-hidden min-h-[620px]">
            <div className="px-5 py-4 border-b border-white/[0.06] flex items-center justify-between">
              <div className="font-bold flex items-center gap-2">
                <MessageSquareText className="w-4 h-4 text-cyan-300" />
                {t("adminChat.sessionList")}
              </div>
              <span className="text-xs text-zinc-500">{t("adminChat.sessionCount", { count: sessions.length })}</span>
            </div>

            {sessions.length === 0 ? (
              <div className="p-8 text-sm text-zinc-400 text-center leading-relaxed">
                {t("adminChat.empty")}
              </div>
            ) : (
              <div className="divide-y divide-white/[0.06]">
                {sessions.map((session) => {
                  const active = session.id === activeSessionId;
                  return (
                    <button
                      key={session.id}
                      onClick={() => setActiveSessionId(session.id)}
                      className={`w-full text-left p-4 transition-colors ${active ? "bg-cyan-500/10" : "hover:bg-white/[0.03]"}`}
                    >
                      <div className="font-bold text-sm text-zinc-100 truncate">{session.title}</div>
                      <div className="text-xs text-zinc-500 mt-1">
                        {t("adminChat.updatedAt", { time: new Date(session.updatedAt).toLocaleString() })}
                      </div>
                    </button>
                  );
                })}
              </div>
            )}
          </aside>

          <section className="rounded-[28px] border border-white/[0.08] bg-[#0b111a] overflow-hidden min-h-[620px] flex flex-col">
            <div className="px-5 py-4 border-b border-white/[0.06] flex items-center justify-between">
              <div>
                <div className="font-bold">{activeSession?.title || t("adminChat.unselected")}</div>
                <div className="text-xs text-zinc-500 mt-1">{t("adminChat.messageCount", { count: messages.length })}</div>
              </div>
              {activeSession && (
                <div className="hidden sm:block text-xs text-zinc-500 font-mono">
                  {activeSession.id}
                </div>
              )}
            </div>

            <div className="flex-1 overflow-y-auto p-5 space-y-4">
              {isLoading ? (
                <div className="h-full min-h-[420px] flex items-center justify-center text-sm text-zinc-500">
                  {t("adminChat.loading")}
                </div>
              ) : messages.length === 0 ? (
                <div className="h-full min-h-[420px] flex items-center justify-center text-sm text-zinc-500">
                  {t("adminChat.emptyMessages")}
                </div>
              ) : (
                messages.map((message) => (
                  <div key={message.id}>
                    <MessageRow message={message} />
                  </div>
                ))
              )}
            </div>
          </section>
        </main>
      </div>
    </div>
  );
}

function MessageRow({ message }: { message: StoredChatMessage }) {
  const { t } = useI18n();
  const isUser = message.role === "user";
  const displayRole = isUser ? t("adminChat.user") : message.role === "assistant" ? "OwnOrbit" : message.role;

  return (
    <div className={`flex gap-3 ${isUser ? "justify-end" : "justify-start"}`}>
      {!isUser && (
        <div className="w-9 h-9 rounded-2xl bg-cyan-500/10 border border-cyan-400/20 flex items-center justify-center flex-shrink-0">
          <Bot className="w-4 h-4 text-cyan-300" />
        </div>
      )}
      <div className={`max-w-[82%] rounded-3xl border p-4 ${isUser ? "bg-blue-600/20 border-blue-400/20" : "bg-white/[0.03] border-white/[0.07]"}`}>
        <div className="flex items-center gap-2 text-xs text-zinc-500 mb-2">
          {isUser && <UserRound className="w-3.5 h-3.5" />}
          {!isUser && <Smartphone className="w-3.5 h-3.5" />}
          <span className="font-bold">{displayRole}</span>
          <span>{new Date(message.createdAt).toLocaleString()}</span>
        </div>
        <div className="space-y-2 text-sm leading-relaxed text-zinc-200">
          {message.contentJson.parts.map((part: any, index) => (
            <div key={index}>
              <MessagePart part={part} widget={message.contentJson.widget} />
            </div>
          ))}
          {message.contentJson.widget && (
            <div className="inline-flex items-center rounded-lg border border-cyan-400/20 bg-cyan-500/10 px-2 py-1 text-xs font-bold text-cyan-200">
              {t("adminChat.widget", { name: message.contentJson.widget })}
            </div>
          )}
        </div>
      </div>
      {isUser && (
        <div className="w-9 h-9 rounded-2xl bg-blue-500/10 border border-blue-400/20 flex items-center justify-center flex-shrink-0">
          <UserRound className="w-4 h-4 text-blue-300" />
        </div>
      )}
    </div>
  );
}

function MessagePart({ part }: { part: any; widget?: string }) {
  const { t } = useI18n();
  if (part.text) {
    return <div className="whitespace-pre-wrap break-words">{part.text}</div>;
  }

  if (part.inlineData) {
    return (
      <div className="rounded-2xl border border-white/[0.07] bg-black/20 p-3">
        <div className="flex items-center gap-2 text-xs text-zinc-400 mb-2">
          <ImageIcon className="w-3.5 h-3.5" />
          {t("adminChat.imageAttachment", { mime: part.inlineData.mimeType })}
        </div>
        <img
          src={`data:${part.inlineData.mimeType};base64,${part.inlineData.data}`}
          alt="message attachment"
          className="max-h-56 rounded-xl border border-white/[0.08]"
        />
      </div>
    );
  }

  return (
    <pre className="overflow-x-auto rounded-2xl border border-white/[0.07] bg-black/30 p-3 text-xs text-zinc-400">
      {JSON.stringify(part, null, 2)}
    </pre>
  );
}
