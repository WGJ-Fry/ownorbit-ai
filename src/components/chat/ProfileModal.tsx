import { LogOut, Settings2, User } from "lucide-react";
import { motion } from "motion/react";
import { useI18n } from "../../i18n/I18nProvider";

export default function ProfileModal({
  onClose,
  onOpenSettings,
}: {
  onClose: () => void;
  onOpenSettings: () => void;
}) {
  const { t } = useI18n();

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="absolute inset-0 z-50 flex items-center justify-center bg-black/40 p-4 backdrop-blur-md"
      onClick={onClose}
    >
      <motion.div
        initial={{ opacity: 0, y: 20, scale: 0.95 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        exit={{ opacity: 0, y: 20, scale: 0.95 }}
        onClick={(event) => event.stopPropagation()}
        className="flex w-full max-w-sm flex-col rounded-[32px] border border-white/[0.08] bg-[#111113] p-6 shadow-2xl"
      >
        <div className="mb-6 flex items-center gap-4 px-2 pt-2">
          <div className="h-16 w-16 rounded-full bg-gradient-to-tr from-indigo-500 to-purple-500 p-0.5">
            <div className="flex h-full w-full items-center justify-center rounded-full border-2 border-[#111113] bg-[#18181b]">
              <User className="h-7 w-7 text-indigo-400" />
            </div>
          </div>
          <div>
            <h3 className="text-xl font-bold text-white">{t("chat.profile.name")}</h3>
            <span className="mt-0.5 flex items-center text-sm font-medium text-emerald-400">
              <div className="mr-1.5 h-1.5 w-1.5 rounded-full bg-emerald-400 opacity-80" /> {t("chat.profile.ready")}
            </span>
          </div>
        </div>

        <div className="mb-6 space-y-2">
          <button
            onClick={onOpenSettings}
            className="flex w-full items-center justify-between rounded-[20px] border border-transparent bg-white/[0.02] p-4 transition-colors hover:border-white/[0.05] hover:bg-white/[0.05]"
          >
            <span className="flex items-center text-[15px] font-medium">
              <Settings2 className="mr-3 h-5 w-5 text-zinc-400" /> {t("chat.profile.settings")}
            </span>
          </button>
        </div>

        <button onClick={onClose} className="flex w-full items-center justify-center rounded-[20px] bg-red-500/10 py-4 text-center font-bold text-red-500 transition-colors hover:bg-red-500/20">
          <LogOut className="mr-2 h-4 w-4" /> {t("chat.profile.close")}
        </button>
      </motion.div>
    </motion.div>
  );
}
