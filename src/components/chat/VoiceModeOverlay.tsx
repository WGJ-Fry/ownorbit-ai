import { motion } from "motion/react";
import { useI18n } from "../../i18n/I18nProvider";

type VoiceState = "speaking" | "listening" | "processing";

type VoiceModeOverlayProps = {
  voiceState: VoiceState;
  voiceRecognitionText: string;
  onClose: () => void;
  onSetVoiceState: (state: VoiceState) => void;
  onSetRecognitionText: (text: string) => void;
  onSubmitCommand: (command: string) => void;
};

export default function VoiceModeOverlay({
  voiceState,
  voiceRecognitionText,
  onClose,
  onSetVoiceState,
  onSetRecognitionText,
  onSubmitCommand,
}: VoiceModeOverlayProps) {
  const { t } = useI18n();

  return (
    <motion.div
      initial={{ opacity: 0, y: 50, filter: "blur(10px)" }}
      animate={{ opacity: 1, y: 0, filter: "blur(0px)" }}
      exit={{ opacity: 0, y: 50, filter: "blur(10px)" }}
      className="absolute z-[60] bottom-0 left-0 right-0 h-full max-h-screen bg-[#09090b]/95 backdrop-blur-3xl flex flex-col items-center justify-between py-12 overflow-hidden sm:rounded-[32px] sm:h-auto sm:max-h-[90vh] sm:bottom-4 sm:mx-4"
    >
      <div className="absolute inset-0 bg-gradient-to-t from-indigo-500/10 via-transparent to-transparent opacity-50" />

      <div className="text-center relative z-10">
        <h3 className="text-zinc-400 font-bold tracking-widest text-xs uppercase">{t("chat.voice.title")}</h3>
        <p className="text-[10px] font-mono mt-1 text-zinc-500">{t("chat.voice.subtitle")}</p>
      </div>

      <div className="relative flex flex-col items-center justify-center w-full z-10 flex-1 my-4">
        <div
          className="relative flex items-center justify-center h-48 w-full cursor-pointer"
          onClick={() => {
            if (voiceState === "listening") onSetVoiceState("processing");
            else if (voiceState === "processing") onSetVoiceState("speaking");
            else onSetVoiceState("listening");
          }}
        >
          <motion.div
            animate={{
              scale: voiceState === "processing" ? [1, 1.4, 1] : [1, 1.15, 1],
              opacity: voiceState === "processing" ? [0.4, 0.8, 0.4] : [0.3, 0.6, 0.3],
            }}
            transition={{
              repeat: Infinity,
              duration: voiceState === "processing" ? 1 : 2,
              ease: "easeInOut",
            }}
            className={`absolute w-36 h-36 rounded-full blur-3xl opacity-50 transition-colors duration-1000 ${
              voiceState === "processing" ? "bg-gradient-to-tr from-emerald-500 to-indigo-500" :
              voiceState === "speaking" ? "bg-gradient-to-tr from-cyan-400 to-blue-650" :
              "bg-gradient-to-tr from-indigo-600 to-purple-600"
            }`}
          />
          <motion.div
            animate={{
              scale: voiceState === "speaking" ? [1, 1.18, 1] : [1, 1.08, 1],
              rotate: [0, 90, 180, 360],
            }}
            transition={{
              scale: { repeat: Infinity, duration: 1.5, ease: "easeInOut" },
              rotate: { repeat: Infinity, duration: voiceState === "processing" ? 3 : 8, ease: "linear" },
            }}
            className={`w-24 h-24 rounded-full blur-2xl opacity-70 transition-colors duration-1000 ${
              voiceState === "processing" ? "bg-gradient-to-tr from-emerald-400 via-indigo-500 to-purple-400" :
              voiceState === "speaking" ? "bg-gradient-to-tr from-cyan-300 via-blue-500 to-indigo-400" :
              "bg-gradient-to-tr from-indigo-400 via-purple-500 to-emerald-400"
            }`}
          />
          <div className="absolute text-white font-bold text-sm tracking-widest animate-pulse pointer-events-none">
            {voiceState === "listening" ? t("chat.voice.listening") :
              voiceState === "processing" ? t("chat.voice.processing") :
              t("chat.voice.speaking")}
          </div>
        </div>

        <div className="flex items-center justify-center gap-1.5 h-12 mt-2">
          {[...Array(9)].map((_, idx) => (
            <motion.div
              key={idx}
              animate={voiceState === "listening" ? {
                height: [12, 32, 16, 40, 12, 28, 12][idx % 7],
              } : voiceState === "processing" ? {
                height: [20, 24, 20, 24, 20][idx % 5],
                scale: [1, 1.15, 1],
              } : voiceState === "speaking" ? {
                height: [16, 48, 16, 48, 16][idx % 5],
              } : {
                height: 8,
              }}
              transition={{
                repeat: Infinity,
                duration: voiceState === "listening" ? 0.6 + (idx * 0.08) : voiceState === "processing" ? 0.4 : 0.5 + (idx * 0.06),
                ease: "easeInOut",
              }}
              className={`w-1 rounded-full transition-colors duration-500 ${
                voiceState === "processing" ? "bg-emerald-400" :
                voiceState === "speaking" ? "bg-cyan-400" :
                "bg-indigo-500/80"
              }`}
              style={{ height: 8 }}
            />
          ))}
        </div>
      </div>

      <div className="relative z-10 w-full max-w-sm px-6 text-center mb-6">
        <span className="text-zinc-500 text-[10px] font-bold font-mono tracking-widest block mb-2 uppercase">{t("chat.voice.transcript")}</span>
        <div className="min-h-[56px] max-h-[80px] overflow-y-auto bg-white/[0.02] border border-white/[0.04] p-3.5 rounded-[20px] flex items-center justify-center text-sm font-semibold max-w-[345px] mx-auto text-zinc-300 transition-all duration-300 hide-scrollbar">
          {voiceRecognitionText ? (
            <span className="text-zinc-200 text-sm font-medium leading-relaxed break-all">“ {voiceRecognitionText} ”</span>
          ) : (
            <span className="text-zinc-650 italic text-zinc-500 text-xs">{t("chat.voice.waiting")}</span>
          )}
        </div>
      </div>

      <div className="relative z-10 w-full max-w-xs px-4 mb-8">
        <div className="bg-[#18181b]/50 border border-white/[0.08] px-3.5 py-2.5 rounded-2xl flex items-center gap-2">
          <input
            type="text"
            placeholder={t("chat.voice.placeholder")}
            className="bg-transparent text-xs font-semibold text-zinc-300 outline-none flex-1 placeholder-zinc-550 min-w-0"
            onKeyDown={(event) => {
              if (event.key === "Enter" && event.currentTarget.value.trim()) {
                const value = event.currentTarget.value.trim();
                onSetRecognitionText(value);
                onSetVoiceState("processing");
                onSubmitCommand(value);
                event.currentTarget.value = "";
              }
            }}
          />
          <span className="text-[9px] text-zinc-500 font-bold bg-white/[0.04] px-1.5 py-0.5 rounded border border-white/[0.05] flex-shrink-0">{t("chat.voice.submitKey")}</span>
        </div>
      </div>

      <div className="flex flex-col items-center gap-6 relative z-10 w-full px-8">
        <p className="text-zinc-500 max-w-[300px] text-center text-xs leading-relaxed font-semibold">
          {t("chat.voice.help")}
        </p>
        <button
          onClick={onClose}
          className="w-14 h-14 rounded-full bg-white/5 hover:bg-white/10 flex items-center justify-center hover:scale-105 transition-all active:scale-95 border border-white/[0.08]"
          title={t("chat.voice.back")}
        >
          <div className="w-4 h-4 bg-zinc-300 rounded-sm" />
        </button>
      </div>
    </motion.div>
  );
}
