import { GoogleGenAI, type FunctionDeclaration } from "@google/genai";
import type express from "express";
import { type AiProviderId, aiProviders, getActiveAiProviderId, getAiApiKey, getAiProviderBaseUrl, getAiProviderDefinition, getAiProviderModelCatalog, getAiProviderStatus, getSelectedAiModel, isAllowedAiModel } from "./appSecrets";

type AiContentPart = {
  text?: string;
  inlineData?: {
    mimeType?: string;
    data?: string;
  };
};

export type AiContent = string | {
  role?: string;
  parts?: AiContentPart[];
} | Array<{
  role?: string;
  parts?: AiContentPart[];
}>;

type GenerateAiContentInput = {
  providerId?: AiProviderId;
  modelEngine?: unknown;
  contents: AiContent;
  systemInstruction?: string;
  tools?: Array<{ functionDeclarations?: FunctionDeclaration[] }>;
  temperature?: number;
  responseMimeType?: string;
  responseSchema?: unknown;
};

type AiFunctionCall = {
  name?: string;
  args: Record<string, any>;
};

export type AiProviderResponse = {
  providerId: AiProviderId;
  providerName: string;
  model: string;
  text: string;
  functionCalls?: AiFunctionCall[];
  historyParts?: AiContentPart[];
};

const providerNamePattern: Array<[AiProviderId, RegExp]> = [
  ["deepseek", /deepseek|深度求索/i],
  ["qwen", /qwen|通义|dashscope|alibaba|阿里/i],
  ["moonshot", /moonshot|kimi|月之暗面/i],
  ["zhipu", /zhipu|bigmodel|glm|智谱/i],
  ["baidu_qianfan", /qianfan|ernie|百度|千帆|文心/i],
  ["tencent_hunyuan", /hunyuan|tencent|腾讯|混元/i],
  ["volcengine", /volcengine|ark|doubao|火山|豆包/i],
  ["minimax", /minimax/i],
  ["stepfun", /stepfun|阶跃/i],
  ["siliconflow", /siliconflow|硅基流动/i],
  ["baichuan", /baichuan|百川/i],
  ["anthropic", /anthropic|claude/i],
  ["mistral", /mistral|codestral|magistral/i],
  ["groq", /groq/i],
  ["perplexity", /perplexity|sonar/i],
  ["together", /together/i],
  ["xai", /xai|grok/i],
  ["openrouter", /openrouter/i],
  ["openai", /openai|gpt/i],
  ["local", /local|ollama|lm studio|local/i],
  ["gemini", /gemini|google/i],
];
const qwen37MaxModelPattern = /^qwen3\.7-max(?:-\d{4}-\d{2}-\d{2})?$/i;

function isProviderId(value: unknown): value is AiProviderId {
  return typeof value === "string" && aiProviders.some((provider) => provider.id === value);
}

function getEnvForcedProvider(): AiProviderId | null {
  const forced = process.env.LIFEOS_ACTIVE_AI_PROVIDER;
  if (isProviderId(forced)) return forced;
  if (process.env.LIFEOS_QUICKSTART === "1" && process.env.LOCAL_MODEL_BASE_URL) return "local";
  return null;
}

export function resolveAiProviderId(input: { providerId?: unknown; modelEngine?: unknown; byokProvider?: unknown } = {}): AiProviderId {
  const forced = getEnvForcedProvider();
  if (forced) return forced;
  if (isProviderId(input.providerId)) return input.providerId;

  const hint = [input.modelEngine, input.byokProvider].filter(Boolean).join(" ");
  const matched = providerNamePattern.find(([, pattern]) => pattern.test(hint));
  return matched?.[0] || getActiveAiProviderId();
}

export function resolveAiModel(providerId: AiProviderId, modelEngine: unknown) {
  if (providerId === "local") {
    const envModel = process.env.LIFEOS_LOCAL_MODEL_NAME || process.env.LOCAL_MODEL_NAME;
    if (envModel && isAllowedAiModel(providerId, envModel)) {
      return envModel.trim();
    }
  }
  const selectedModel = getSelectedAiModel(providerId);
  const engine = typeof modelEngine === "string" ? modelEngine.trim() : "";
  if (!engine) return selectedModel;

  const catalog = getAiProviderModelCatalog(providerId);
  if ((catalog as string[]).includes(engine)) return engine;
  if (providerId === "local") return selectedModel;
  if (providerId === "gemini" && engine.includes("1.5")) return "gemini-1.5-pro";
  if (providerId === "openai" && /GPT-4o|gpt-4o/i.test(engine)) return "gpt-4o";
  if (providerId === "openrouter" && /Claude|claude/i.test(engine)) return "anthropic/claude-3.5-sonnet";
  if (providerId === "deepseek" && /reason|r1|推理/i.test(engine)) return "deepseek-reasoner";
  if (providerId === "qwen" && /3[.\s_-]*7[\s_-]*max/i.test(engine)) return "qwen3.7-max";
  if (providerId === "qwen" && /max/i.test(engine)) return "qwen-max";
  if (providerId === "moonshot" && /128k/i.test(engine)) return "moonshot-v1-128k";
  if (providerId === "zhipu" && /flash/i.test(engine)) return "glm-4.5-flash";
  if (providerId === "anthropic" && /haiku/i.test(engine)) return "claude-haiku-4-5";
  return selectedModel;
}

function textFromParts(parts: AiContentPart[] = []) {
  return parts.map((part) => part.text || "").filter(Boolean).join("\n");
}

function normalizeMessages(contents: AiContent, systemInstruction?: string) {
  const messages: any[] = [];
  if (systemInstruction) messages.push({ role: "system", content: systemInstruction });

  if (typeof contents === "string") {
    messages.push({ role: "user", content: contents });
    return messages;
  }

  const items = Array.isArray(contents) ? contents : [contents];
  for (const item of items) {
    const role = item.role === "model" ? "assistant" : item.role || "user";
    const imageParts = item.parts?.filter((part) => part.inlineData?.data) || [];
    if (!imageParts.length) {
      messages.push({ role, content: textFromParts(item.parts) });
      continue;
    }

    const content = [
      ...((textFromParts(item.parts) ? [{ type: "text", text: textFromParts(item.parts) }] : [])),
      ...imageParts.map((part) => ({
        type: "image_url",
        image_url: {
          url: `data:${part.inlineData?.mimeType || "image/png"};base64,${part.inlineData?.data}`,
        },
      })),
    ];
    messages.push({ role, content });
  }

  return messages;
}

function normalizeToolParameters(parameters: any): any {
  if (!parameters || typeof parameters !== "object") return parameters;
  const normalized: any = Array.isArray(parameters) ? [] : {};
  for (const [key, value] of Object.entries(parameters)) {
    if (key === "type" && typeof value === "string") {
      normalized[key] = value.toLowerCase();
    } else if (typeof value === "object" && value) {
      normalized[key] = normalizeToolParameters(value);
    } else {
      normalized[key] = value;
    }
  }
  return normalized;
}

function openAiTools(tools: GenerateAiContentInput["tools"]) {
  const declarations = tools?.flatMap((tool) => tool.functionDeclarations || []) || [];
  if (!declarations.length) return undefined;
  return declarations.map((declaration) => ({
    type: "function",
    function: {
      name: declaration.name,
      description: declaration.description,
      parameters: normalizeToolParameters(declaration.parameters),
    },
  }));
}

function openAiProviderRequestOptions(providerId: AiProviderId, model: string) {
  if (providerId === "qwen" && qwen37MaxModelPattern.test(model)) {
    return {
      stream: false,
      enable_thinking: true,
      preserve_thinking: false,
    };
  }
  return {};
}

async function generateGemini(input: GenerateAiContentInput, apiKey: string, model: string): Promise<AiProviderResponse> {
  const ai = new GoogleGenAI({
    apiKey,
    httpOptions: {
      headers: {
        "User-Agent": "aistudio-build",
      },
    },
  });
  const response = await ai.models.generateContent({
    model,
    contents: input.contents as any,
    config: {
      systemInstruction: input.systemInstruction,
      tools: input.tools,
      responseMimeType: input.responseMimeType,
      responseSchema: input.responseSchema as any,
      temperature: input.temperature,
    },
  });

  return {
    providerId: "gemini",
    providerName: "Google Gemini",
    model,
    text: response.text || "",
    functionCalls: response.functionCalls as AiFunctionCall[] | undefined,
    historyParts: response.candidates?.[0]?.content?.parts as AiContentPart[] | undefined,
  };
}

async function generateOpenAiCompatible(input: GenerateAiContentInput, credential: string, providerId: AiProviderId, model: string): Promise<AiProviderResponse> {
  const isLocal = providerId === "local";
  const response = await fetch(`${getAiProviderBaseUrl(providerId, credential)}/chat/completions`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(isLocal ? {} : { Authorization: `Bearer ${credential}` }),
      ...(providerId === "openrouter" ? { "HTTP-Referer": "https://lifeos.local", "X-Title": "OwnOrbit AI" } : {}),
    },
    body: JSON.stringify({
      model,
      messages: normalizeMessages(input.contents, input.systemInstruction),
      tools: openAiTools(input.tools),
      temperature: input.temperature,
      ...openAiProviderRequestOptions(providerId, model),
      ...(input.responseMimeType === "application/json" ? { response_format: { type: "json_object" } } : {}),
    }),
  });

  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(data?.error?.message || data?.message || `${providerId} request failed with HTTP ${response.status}`);
  }

  const message = data?.choices?.[0]?.message || {};
  const functionCalls = Array.isArray(message.tool_calls)
    ? message.tool_calls.map((toolCall: any) => ({
      name: toolCall?.function?.name,
      args: JSON.parse(toolCall?.function?.arguments || "{}"),
    }))
    : undefined;

  return {
    providerId,
    providerName: getAiProviderStatus(providerId).provider,
    model,
    text: message.content || "",
    functionCalls,
    historyParts: message.content ? [{ text: message.content }] : [],
  };
}

function anthropicMessages(contents: AiContent) {
  const items = normalizeMessages(contents).filter((message) => message.role !== "system");
  return items.map((message) => ({
    role: message.role === "assistant" ? "assistant" : "user",
    content: Array.isArray(message.content)
      ? message.content
        .map((part: any) => part?.type === "text" ? { type: "text", text: part.text || "" } : null)
        .filter(Boolean)
      : String(message.content || ""),
  }));
}

function anthropicTools(tools: GenerateAiContentInput["tools"]) {
  const declarations = tools?.flatMap((tool) => tool.functionDeclarations || []) || [];
  if (!declarations.length) return undefined;
  return declarations.map((declaration) => ({
    name: declaration.name,
    description: declaration.description,
    input_schema: normalizeToolParameters(declaration.parameters),
  }));
}

async function generateAnthropic(input: GenerateAiContentInput, apiKey: string, model: string): Promise<AiProviderResponse> {
  const response = await fetch(`${getAiProviderBaseUrl("anthropic")}/messages`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model,
      max_tokens: 4096,
      system: input.systemInstruction,
      messages: anthropicMessages(input.contents),
      tools: anthropicTools(input.tools),
      temperature: input.temperature,
    }),
  });

  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(data?.error?.message || data?.message || `anthropic request failed with HTTP ${response.status}`);
  }

  const content = Array.isArray(data?.content) ? data.content : [];
  const text = content.filter((part: any) => part?.type === "text").map((part: any) => part.text || "").filter(Boolean).join("\n");
  const functionCalls = content
    .filter((part: any) => part?.type === "tool_use")
    .map((part: any) => ({ name: part.name, args: part.input || {} }));

  return {
    providerId: "anthropic",
    providerName: getAiProviderStatus("anthropic").provider,
    model,
    text,
    functionCalls: functionCalls.length ? functionCalls : undefined,
    historyParts: text ? [{ text }] : [],
  };
}

export async function generateAiContent(input: GenerateAiContentInput): Promise<AiProviderResponse> {
  const providerId = resolveAiProviderId({ providerId: input.providerId, modelEngine: input.modelEngine });
  const credential = getAiApiKey(providerId);
  if (!credential) {
    const status = getAiProviderStatus(providerId);
    const error: any = new Error(`${status.provider} is not configured`);
    error.code = "AI_CONFIG_MISSING";
    error.providerId = providerId;
    throw error;
  }

  const model = resolveAiModel(providerId, input.modelEngine);
  if (providerId === "gemini") return generateGemini(input, credential, model);
  if (getAiProviderDefinition(providerId).apiStyle === "anthropic") return generateAnthropic(input, credential, model);
  return generateOpenAiCompatible(input, credential, providerId, model);
}

export function sendMissingAiConfig(res: express.Response, providerId: AiProviderId = "gemini") {
  const status = getAiProviderStatus(providerId);
  return res.status(503).json({
    error: "AI provider is not configured",
    code: "AI_CONFIG_MISSING",
    providerId,
    provider: status.provider,
    envVar: status.envVar,
    setupPath: "/admin/settings",
    message: `Configure ${status.provider} in the desktop admin console, or set ${status.envVar} and restart OwnOrbit AI.`,
  });
}
