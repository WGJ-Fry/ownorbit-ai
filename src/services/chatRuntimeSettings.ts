import { getClientState, listMemories } from "./lifeosApi";
import { isSensitiveLocalStorageKey } from "./sensitiveLocalStorage";
import type { AiProviderId } from "./lifeosApi";

const defaultMemories = [
  { id: "mem-1", title: "User addressing and pronouns", content: "Prefers concise, direct professional communication." },
  { id: "mem-2", title: "Morning frequent destination", content: "Often visits a preferred coffee shop in the morning." },
  { id: "mem-3", title: "UI taste preference", content: "Likes dark, cyberpunk, and minimal console-style interfaces." },
];

function parseLocalJson<T>(key: string, fallback: T) {
  try {
    return JSON.parse(localStorage.getItem(key) || "") as T;
  } catch {
    return fallback;
  }
}

export function readLocalRuntimeValue<T>(key: string, fallback: T): T {
  if (isSensitiveLocalStorageKey(key)) return fallback;
  let raw: string | null = null;
  try {
    raw = localStorage.getItem(key);
  } catch {
    return fallback;
  }
  if (raw === null || raw === "") return fallback;
  try {
    return JSON.parse(raw) as T;
  } catch {
    if (typeof fallback === "string") return raw as T;
    if (typeof fallback === "boolean") return (raw === "true") as T;
    if (typeof fallback === "number") {
      const parsed = Number(raw);
      return Number.isFinite(parsed) ? parsed as T : fallback;
    }
    return fallback;
  }
}

export async function loadMemoriesForChat() {
  try {
    const data = await listMemories();
    if (data.memories.length > 0) {
      return data.memories.map((memory) => ({
        id: memory.id,
        title: memory.title,
        content: memory.content,
      }));
    }
  } catch (error) {
    console.warn("Failed to load server memories, falling back to local memories:", error);
  }

  return parseLocalJson("lifeos_memories", defaultMemories);
}

export async function loadRuntimeSettings() {
  const [providerId, modelEngine, byokProvider, ttsVoice, proxyEnabled, routeMode, selectedNodeId, proxyNodes] = await Promise.all([
    getClientState<AiProviderId>("lifeos_active_ai_provider", "gemini"),
    getClientState("lifeos_model_engine", readLocalRuntimeValue("lifeos_model_engine", "Gemini 2.0 Flash")),
    getClientState("lifeos_byok_provider", readLocalRuntimeValue("lifeos_byok_provider", "Google Gemini")),
    getClientState("lifeos_tts_voice", readLocalRuntimeValue("lifeos_tts_voice", "Onyx")),
    getClientState("lifeos_proxy_enabled", readLocalRuntimeValue("lifeos_proxy_enabled", false)),
    getClientState("lifeos_route_mode", readLocalRuntimeValue("lifeos_route_mode", "rule")),
    getClientState("lifeos_selected_node_id", readLocalRuntimeValue("lifeos_selected_node_id", "cn-hk")),
    getClientState<any[]>("lifeos_proxy_nodes", readLocalRuntimeValue("lifeos_proxy_nodes", [])),
  ]);

  let proxyNode = "Local 127.0.0.1 proxy loop (Direct)";
  if (proxyEnabled) {
    const activeNode = proxyNodes.find((node: any) => node.id === selectedNodeId);
    if (activeNode) {
      proxyNode = `${activeNode.name} (${activeNode.type}, latency: ${activeNode.delay}ms)`;
    }
  }

  return { providerId, modelEngine, byokProvider, ttsVoice, proxyNode, routeMode };
}
