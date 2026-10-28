import type { Message } from "../types";

export const CHAT_MESSAGES_STORAGE_KEY = "lifeos_messages";

export const defaultChatMessages: Message[] = [
  {
    role: "model",
    parts: [
      {
        text: "Good morning. I am OwnOrbit, your intelligent design workshop system.\nDrop code (tsx, vue, py, html, and more) or UI screenshots into the window at any time, and I can redefine or create new interactive controls for you.",
      },
    ],
  },
];

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function isMessage(value: unknown): value is Message {
  if (!isRecord(value)) return false;
  if (value.role !== "user" && value.role !== "model") return false;
  if (!Array.isArray(value.parts) || value.parts.length === 0) return false;
  return value.parts.every((part) => isRecord(part) && (part.text === undefined || typeof part.text === "string"));
}

export function parseStoredChatMessages(raw: string | null): Message[] {
  if (!raw) return defaultChatMessages;
  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed) || parsed.length === 0) return defaultChatMessages;
    const messages = parsed.filter(isMessage);
    return messages.length > 0 ? messages : defaultChatMessages;
  } catch {
    return defaultChatMessages;
  }
}

export function loadStoredChatMessages(storage: Pick<Storage, "getItem"> = localStorage): Message[] {
  try {
    return parseStoredChatMessages(storage.getItem(CHAT_MESSAGES_STORAGE_KEY));
  } catch {
    return defaultChatMessages;
  }
}

export function persistStoredChatMessages(
  messages: Message[],
  storage: Pick<Storage, "setItem"> = localStorage,
): { ok: true } | { ok: false; error: unknown } {
  try {
    storage.setItem(CHAT_MESSAGES_STORAGE_KEY, JSON.stringify(messages));
    return { ok: true };
  } catch (error) {
    return { ok: false, error };
  }
}
