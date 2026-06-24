import { ArrowLeft, Command } from "lucide-react";
import SystemActionsApp from "../../components/apps/SystemActionsApp";
import { useI18n } from "../../i18n/I18nProvider";
import MobileCustomAppActionsPanel from "./MobileCustomAppActionsPanel";

export default function MobileActionsPage() {
  const { t } = useI18n();
  return (
    <div className="min-h-screen bg-[#060a10] text-zinc-100">
      <header className="sticky top-0 z-10 flex items-center justify-between border-b border-white/[0.08] bg-[#060a10]/90 px-4 py-3 backdrop-blur-xl">
        <a href="/mobile/chat" className="inline-flex h-10 w-10 items-center justify-center rounded-xl border border-white/[0.08] bg-white/[0.03] text-zinc-300">
          <ArrowLeft className="w-4 h-4" />
        </a>
        <div className="flex items-center gap-2 text-sm font-bold">
          <Command className="w-4 h-4 text-cyan-300" />
          {t("mobile.localActions")}
        </div>
        <div className="h-10 w-10" />
      </header>

      <main className="mx-auto max-w-md space-y-4 p-4">
        <div className="rounded-2xl border border-cyan-400/15 bg-cyan-500/10 p-4">
          <h1 className="text-base font-bold text-cyan-100">{t("mobile.actionsTitle")}</h1>
          <p className="mt-1 text-xs leading-relaxed text-cyan-100/70">
            {t("mobile.actionsDescription")}
          </p>
        </div>
        <MobileCustomAppActionsPanel />
        <div className="h-[620px] max-h-[calc(100vh-170px)] min-h-[460px] overflow-hidden rounded-3xl border border-white/[0.08] bg-[#111113]">
          <SystemActionsApp />
        </div>
      </main>
    </div>
  );
}
