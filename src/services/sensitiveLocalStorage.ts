const SENSITIVE_EXACT_KEYS = new Set([
  "lifeos_byok_key",
  "lifeos_proxy_url",
  "lifeos_proxy_subscription_url",
  "lifeos_admin_token",
  "lifeos_auth_token",
  "lifeos_access_token",
  "lifeos_api_key",
  "lifeos_gemini_api_key",
  "lifeos_openai_api_key",
  "lifeos_openrouter_api_key",
  "lifeos_deepseek_api_key",
  "lifeos_qwen_api_key",
  "lifeos_moonshot_api_key",
  "lifeos_kimi_api_key",
  "lifeos_zhipu_api_key",
  "lifeos_baidu_qianfan_api_key",
  "lifeos_tencent_hunyuan_api_key",
  "lifeos_volcengine_api_key",
  "lifeos_minimax_api_key",
  "lifeos_stepfun_api_key",
  "lifeos_siliconflow_api_key",
  "lifeos_baichuan_api_key",
  "lifeos_anthropic_api_key",
  "lifeos_mistral_api_key",
  "lifeos_groq_api_key",
  "lifeos_perplexity_api_key",
  "lifeos_together_api_key",
  "lifeos_xai_api_key",
  "lifeos_local_model_api_key",
  "lifeos_device_token",
]);

const PRESERVED_EXACT_KEYS = new Set([
  "lifeos_pending_pairing_intent",
  "lifeos_device_credential",
  "lifeos_offline_message_queue",
  "lifeos_admin_session",
  "lifeos_active_chat_session_id",
  "lifeos_messages",
  "lifeos_model_engine",
  "lifeos_byok_provider",
  "lifeos_tts_voice",
  "lifeos_proxy_enabled",
  "lifeos_route_mode",
  "lifeos_selected_node_id",
  "lifeos_proxy_nodes",
  "lifeos_mobile_install_hint_dismissed",
  "lifeos_allowed_url_schemes",
  "lifeos_system_actions",
  "lifeos_system_action_logs",
  "lifeos_timer_stats",
  "omnipreview_device",
]);

const SENSITIVE_KEY_PATTERN = /(?:api[-_]?key|byok[-_]?key|token|password|passphrase|secret|authorization|cookie|private|proxy[-_]?url|subscription[-_]?url)/i;

function localStorageKeys(storage: Storage) {
  const keys = new Set<string>();
  try {
    for (let index = 0; index < storage.length; index += 1) {
      try {
        const key = storage.key(index);
        if (key) keys.add(key);
      } catch {
        // Keep scanning Object.keys below when indexed access is blocked.
      }
    }
  } catch {
    // Some browser modes expose localStorage but block length/key access.
  }
  try {
    for (const key of Object.keys(storage)) {
      keys.add(key);
    }
  } catch {
    // If enumeration is blocked too, cleanup becomes a no-op.
  }
  return [...keys];
}

export function isSensitiveLocalStorageKey(key: string) {
  if (PRESERVED_EXACT_KEYS.has(key)) return false;
  if (SENSITIVE_EXACT_KEYS.has(key)) return true;
  if (!key.startsWith("lifeos_") && !key.startsWith("omnipreview_")) return false;
  return SENSITIVE_KEY_PATTERN.test(key);
}

export function clearSensitiveLocalStorageResidue() {
  if (typeof localStorage === "undefined") return { removedKeys: [] as string[], failedKeys: [] as string[] };
  const removedKeys: string[] = [];
  const failedKeys: string[] = [];
  for (const key of localStorageKeys(localStorage)) {
    if (!isSensitiveLocalStorageKey(key)) continue;
    try {
      localStorage.removeItem(key);
      removedKeys.push(key);
    } catch {
      failedKeys.push(key);
    }
  }
  return { removedKeys, failedKeys };
}
