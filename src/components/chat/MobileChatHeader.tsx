import { Settings2, Sparkles, User } from "lucide-react";
import { useI18n } from "../../i18n/I18nProvider";

type MobileChatHeaderProps = {
  onOpenDevice: () => void;
  onOpenProfile: () => void;
};

export default function MobileChatHeader({ onOpenDevice, onOpenProfile }: MobileChatHeaderProps) {
  const { t } = useI18n();

  return (
    <div className="px-5 py-4 bg-[#09090b]/80 backdrop-blur-2xl flex items-center justify-between sticky top-0 z-20 border-b border-white/[0.04]">
      <div className="flex items-center space-x-3">
        <div className="w-10 h-10 bg-gradient-to-br from-indigo-500 to-purple-600 rounded-[12px] flex items-center justify-center p-[1px] shadow-lg shadow-indigo-500/20">
          <div className="w-full h-full bg-[#09090b] rounded-[11px] flex items-center justify-center">
            <Sparkles className="w-4 h-4 text-indigo-400" />
          </div>
        </div>
        <div className="flex flex-col">
          <span className="font-bold text-[16px] tracking-tight leading-tight bg-clip-text text-transparent bg-gradient-to-b from-white to-white/70">OwnOrbit</span>
          <span className="text-[11px] font-bold text-indigo-400 flex items-center tracking-wider">
            <div className="w-1.5 h-1.5 rounded-full bg-indigo-500 mr-1.5 shadow-[0_0_6px_rgba(99,102,241,0.8)]" />
            {t("chat.mobileHeader.subtitle")}
          </span>
        </div>
      </div>

      <div className="flex items-center gap-2">
        <button
          onClick={onOpenDevice}
          className="w-10 h-10 flex items-center justify-center rounded-full bg-white/[0.03] hover:bg-white/[0.08] text-zinc-400 hover:text-white transition-colors border border-white/[0.05]"
          title={t("chat.mobileHeader.openDevice")}
        >
          <Settings2 className="w-[18px] h-[18px]" />
        </button>
        <button
          onClick={onOpenProfile}
          className="w-10 h-10 flex items-center justify-center rounded-full bg-white/[0.03] hover:bg-white/[0.08] text-zinc-400 hover:text-white transition-colors border border-white/[0.05]"
        >
          <User className="w-[18px] h-[18px]" />
        </button>
      </div>
    </div>
  );
}
