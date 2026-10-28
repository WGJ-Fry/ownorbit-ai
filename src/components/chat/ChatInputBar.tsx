import { CircleAlert, Paperclip, Mic, Send, X } from "lucide-react";
import type { RefObject } from "react";
import { useI18n } from "../../i18n/I18nProvider";
import { MAX_CHAT_DRAFT_IMAGE_BYTES, MAX_CHAT_DRAFT_TEXT_LENGTH } from "../../services/chatDraftStorage";

type ChatInputBarProps = {
  input: string;
  attachedImage: string | null;
  isLoading: boolean;
  notice: string | null;
  inputRef: RefObject<HTMLTextAreaElement>;
  fileInputRef: RefObject<HTMLInputElement>;
  onInputChange: (value: string) => void;
  onAttachImage: (image: string | null) => void;
  onAttachmentError: () => void;
  onOpenVoiceMode: () => void;
  onSend: () => void;
};

export default function ChatInputBar({
  input,
  attachedImage,
  isLoading,
  notice,
  inputRef,
  fileInputRef,
  onInputChange,
  onAttachImage,
  onAttachmentError,
  onOpenVoiceMode,
  onSend,
}: ChatInputBarProps) {
  const { t } = useI18n();

  return (
    <div className="absolute bottom-0 left-0 right-0 p-4 sm:p-5 bg-gradient-to-t from-[#09090b] via-[#09090b]/95 to-transparent z-20 pt-16">
      {notice ? (
        <div
          data-testid="chat-send-notice"
          role="status"
          aria-live="polite"
          className="mb-2 flex items-start gap-2 rounded-lg border border-amber-300/20 bg-[#211b0f]/95 px-3 py-2 text-xs leading-relaxed text-amber-100 shadow-lg"
        >
          <CircleAlert className="mt-0.5 h-4 w-4 shrink-0" />
          <span>{notice}</span>
        </div>
      ) : null}
      <div className={`flex flex-col bg-[#18181b]/90 backdrop-blur-md rounded-[28px] border transition-all duration-300 shadow-2xl relative ${(input.trim() || attachedImage) ? "border-indigo-500/40 shadow-[0_4px_30px_rgba(99,102,241,0.15)]" : "border-white/[0.08]"}`}>
        {attachedImage && (
          <div className="px-5 pt-4 pb-1">
            <div className="relative inline-block">
              <img src={attachedImage} alt="Preview" className="h-16 w-16 object-cover rounded-xl border border-white/10" />
              <button
                onClick={() => onAttachImage(null)}
                className="absolute -top-2 -right-2 w-5 h-5 bg-zinc-800 hover:bg-zinc-700 text-white rounded-full flex items-center justify-center border border-white/20 transition-colors"
              >
                <X className="w-3 h-3" />
              </button>
            </div>
          </div>
        )}

        <textarea
          ref={inputRef}
          value={input}
          onChange={(event) => {
            onInputChange(event.target.value);
            event.target.style.height = "auto";
            event.target.style.height = `${Math.min(event.target.scrollHeight, 120)}px`;
          }}
          onKeyDown={(event) => {
            if (event.key === "Enter" && !event.shiftKey) {
              event.preventDefault();
              onSend();
            }
          }}
          placeholder={t("chat.input.placeholder")}
          maxLength={MAX_CHAT_DRAFT_TEXT_LENGTH}
          rows={1}
          className="flex-1 bg-transparent pt-4 pb-2 px-5 outline-none text-[15px] font-medium text-zinc-100 placeholder-zinc-500 w-full resize-none min-h-[48px] max-h-[120px] hide-scrollbar leading-relaxed"
        />

        <div className="flex items-center justify-between px-3 pb-3 pt-1">
          <div className="flex items-center gap-1">
            <input
              type="file"
              accept="image/*"
              className="hidden"
              ref={fileInputRef}
              onChange={(event) => {
                const file = event.target.files?.[0];
                if (file) {
                  if (file.size > MAX_CHAT_DRAFT_IMAGE_BYTES) {
                    event.target.value = "";
                    onAttachmentError();
                    return;
                  }
                  const reader = new FileReader();
                  reader.onload = (loadEvent) => onAttachImage(loadEvent.target?.result as string);
                  reader.onerror = () => onAttachmentError();
                  reader.readAsDataURL(file);
                }
              }}
            />
            <button
              onClick={() => fileInputRef.current?.click()}
              className="p-2 text-zinc-500 hover:text-zinc-300 hover:bg-white/[0.05] rounded-full transition-colors"
            >
              <Paperclip className="w-[18px] h-[18px]" />
            </button>
            <button
              onClick={onOpenVoiceMode}
              className="p-2 text-zinc-500 hover:text-zinc-300 hover:bg-white/[0.05] rounded-full transition-colors"
            >
              <Mic className="w-[18px] h-[18px]" />
            </button>
          </div>
          <button
            onClick={onSend}
            disabled={(!input.trim() && !attachedImage) || isLoading}
            className="w-[36px] h-[36px] flex items-center justify-center bg-indigo-600 rounded-full text-white disabled:opacity-50 disabled:bg-zinc-800 hover:bg-indigo-500 transition-all disabled:cursor-not-allowed transform active:scale-95 shadow-md flex-shrink-0"
          >
            <Send className="w-4 h-4 ml-0.5" />
          </button>
        </div>
      </div>
    </div>
  );
}
