export const CHAT_DRAFT_STORAGE_KEY = "lifeos_chat_draft";
export const MAX_CHAT_DRAFT_TEXT_LENGTH = 20_000;
export const MAX_CHAT_DRAFT_IMAGE_BYTES = 2_000_000;
const MAX_CHAT_DRAFT_IMAGE_DATA_URL_LENGTH = 2_750_000;

export type ChatDraft = {
  text: string;
  attachedImage: string | null;
};

export const emptyChatDraft: ChatDraft = {
  text: "",
  attachedImage: null,
};

function normalizeDraft(value: unknown): ChatDraft {
  if (!value || typeof value !== "object" || Array.isArray(value)) return emptyChatDraft;
  const record = value as Record<string, unknown>;
  const text = typeof record.text === "string"
    ? record.text.slice(0, MAX_CHAT_DRAFT_TEXT_LENGTH)
    : "";
  const image = typeof record.attachedImage === "string"
    && record.attachedImage.length <= MAX_CHAT_DRAFT_IMAGE_DATA_URL_LENGTH
    && /^data:image\/[a-z0-9.+-]+;base64,/i.test(record.attachedImage)
    ? record.attachedImage
    : null;
  return { text, attachedImage: image };
}

export function parseStoredChatDraft(raw: string | null): ChatDraft {
  if (!raw) return emptyChatDraft;
  try {
    return normalizeDraft(JSON.parse(raw));
  } catch {
    return emptyChatDraft;
  }
}

export function loadStoredChatDraft(storage: Pick<Storage, "getItem"> = localStorage): ChatDraft {
  try {
    return parseStoredChatDraft(storage.getItem(CHAT_DRAFT_STORAGE_KEY));
  } catch {
    return emptyChatDraft;
  }
}

export function persistStoredChatDraft(
  draft: ChatDraft,
  storage: Pick<Storage, "setItem" | "removeItem"> = localStorage,
): { ok: true } | { ok: false; error: unknown } {
  try {
    const normalized = normalizeDraft(draft);
    if (!normalized.text && !normalized.attachedImage) {
      storage.removeItem(CHAT_DRAFT_STORAGE_KEY);
    } else {
      storage.setItem(CHAT_DRAFT_STORAGE_KEY, JSON.stringify(normalized));
    }
    return { ok: true };
  } catch (error) {
    return { ok: false, error };
  }
}
