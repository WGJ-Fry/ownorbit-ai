import type { Message } from "../types";
import { getAuthHeaders } from "./lifeosApi";

export type RuntimeSettings = {
  providerId?: string;
  modelEngine: unknown;
  byokProvider?: unknown;
  ttsVoice: unknown;
  proxyNode: string;
  routeMode: unknown;
};

export type ChatCompletionInput = RuntimeSettings & {
  message: string;
  history: Array<Pick<Message, "role" | "parts">>;
  memories: unknown[];
  locale?: "zh-CN" | "en-US";
};

export type ChatCompletionResponse = {
  text: string;
  stateChanges?: Array<Record<string, any>>;
  provider?: string;
  model?: string;
};

export type GeneratedAppResponse = {
  appName: string;
  uiCode: string;
};

export async function parseAiResponse(response: Response) {
  const data = await response.json().catch(() => ({}));
  if (response.ok) return data;

  const code = String(data?.code || "");
  const message =
    code === "AI_CONFIG_MISSING"
      ? data?.message || "AI service is not configured yet. Open System Settings on the desktop console and configure the Provider Key for the current model."
      : data?.message || data?.error || "The network seems unstable. Please try again later.";

  const error = new Error(message) as Error & { code?: string; status?: number };
  error.code = code;
  error.status = response.status;
  throw error;
}

export async function requestChatCompletion(input: ChatCompletionInput): Promise<ChatCompletionResponse> {
  const body = JSON.stringify(input);
  const response = await fetch("/api/chat", {
    method: "POST",
    headers: { "Content-Type": "application/json", ...(await getAuthHeaders("POST", "/api/chat", body)) },
    body,
  });

  return parseAiResponse(response);
}

export async function generateCustomApp(appName: string, description: string): Promise<GeneratedAppResponse> {
  const body = JSON.stringify({ appName, description });
  const response = await fetch("/api/generate_app", {
    method: "POST",
    headers: { "Content-Type": "application/json", ...(await getAuthHeaders("POST", "/api/generate_app", body)) },
    body,
  });

  return parseAiResponse(response);
}
