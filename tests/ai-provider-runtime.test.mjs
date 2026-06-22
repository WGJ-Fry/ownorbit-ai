import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, rm } from "node:fs/promises";
import path from "node:path";
import { tmpdir } from "node:os";

async function withRuntime(testName, env, run) {
  const dataDir = await mkdtemp(path.join(tmpdir(), `lifeos-ai-runtime-${testName}-`));
  const previousEnv = {};
  for (const [key, value] of Object.entries({ LIFEOS_DATA_DIR: dataDir, ...env })) {
    previousEnv[key] = process.env[key];
    process.env[key] = value;
  }
  const previousFetch = globalThis.fetch;

  try {
    const runtime = await import(`../server/aiProviderRuntime.ts?case=${testName}-${Date.now()}`);
    await run(runtime);
  } finally {
    globalThis.fetch = previousFetch;
    for (const key of Object.keys({ LIFEOS_DATA_DIR: dataDir, ...env })) {
      if (previousEnv[key] === undefined) delete process.env[key];
      else process.env[key] = previousEnv[key];
    }
    await rm(dataDir, { recursive: true, force: true });
  }
}

function jsonResponse(body, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  };
}

test("AI runtime routes OpenAI-compatible providers with safe headers and selected models", async () => {
  await withRuntime("openai-compatible", {
    OPENAI_API_KEY: "sk-openai-test",
    OPENROUTER_API_KEY: "sk-openrouter-test",
    LOCAL_MODEL_BASE_URL: "http://127.0.0.1:11434/v1",
    LOCAL_MODEL_NAME: "qwen2.5",
  }, async ({ generateAiContent }) => {
    const calls = [];
    globalThis.fetch = async (url, init) => {
      const body = JSON.parse(init.body);
      calls.push({ url: String(url), headers: init.headers, body });
      return jsonResponse({
        choices: [{
          message: {
            content: `${body.model} ok`,
            tool_calls: [{
              function: {
                name: "openApp",
                arguments: JSON.stringify({ appName: "navigation" }),
              },
            }],
          },
        }],
      });
    };

    const openai = await generateAiContent({ providerId: "openai", modelEngine: "GPT-4o", contents: "hello" });
    assert.equal(openai.providerId, "openai");
    assert.equal(openai.model, "gpt-4o");
    assert.equal(openai.functionCalls?.[0]?.args.appName, "navigation");

    const openrouter = await generateAiContent({ providerId: "openrouter", modelEngine: "Claude", contents: "hello" });
    assert.equal(openrouter.providerId, "openrouter");
    assert.equal(openrouter.model, "anthropic/claude-3.5-sonnet");

    const local = await generateAiContent({ providerId: "local", modelEngine: "Gemini 2.0 Flash", contents: "hello" });
    assert.equal(local.providerId, "local");
    assert.equal(local.model, "qwen2.5");

    assert.equal(calls[0].url, "https://api.openai.com/v1/chat/completions");
    assert.equal(calls[0].headers.Authorization, "Bearer sk-openai-test");
    assert.equal(calls[1].url, "https://openrouter.ai/api/v1/chat/completions");
    assert.equal(calls[1].headers.Authorization, "Bearer sk-openrouter-test");
    assert.equal(calls[1].headers["X-Title"], "LifeOS AI");
    assert.equal(calls[2].url, "http://127.0.0.1:11434/v1/chat/completions");
    assert.equal(calls[2].headers.Authorization, undefined);
  });
});

test("AI runtime resolves provider hints before falling back to Gemini", async () => {
  await withRuntime("provider-hints", {}, async ({ resolveAiProviderId }) => {
    assert.equal(resolveAiProviderId({ providerId: "openai" }), "openai");
    assert.equal(resolveAiProviderId({ modelEngine: "GPT-4o" }), "openai");
    assert.equal(resolveAiProviderId({ byokProvider: "OpenRouter" }), "openrouter");
    assert.equal(resolveAiProviderId({ modelEngine: "Ollama 本地模型" }), "local");
    assert.equal(resolveAiProviderId({ modelEngine: "Gemini 2.0 Flash" }), "gemini");
    assert.equal(resolveAiProviderId({ modelEngine: "unknown" }), "gemini");
  });
});

test("AI runtime falls back to the saved default provider when no provider hint is present", async () => {
  await withRuntime("default-provider", {}, async ({ resolveAiProviderId }) => {
    const { saveActiveAiProvider } = await import(`../server/appSecrets.ts?case=default-provider-${Date.now()}`);
    assert.equal(resolveAiProviderId({}), "gemini");
    saveActiveAiProvider("openai");
    assert.equal(resolveAiProviderId({}), "openai");
    assert.equal(resolveAiProviderId({ modelEngine: "Gemini 2.0 Flash" }), "gemini");
  });
});

test("AI provider changes sync legacy Studio runtime state", async () => {
  await withRuntime("legacy-runtime-sync", {}, async ({ resolveAiProviderId }) => {
    const { saveActiveAiProvider, saveSelectedAiModel } = await import(`../server/appSecrets.ts?case=legacy-runtime-sync-${Date.now()}`);
    const { getClientState } = await import(`../server/clientState.ts?case=legacy-runtime-sync-${Date.now()}`);

    saveActiveAiProvider("gemini", { type: "admin", id: "owner" });
    saveSelectedAiModel("openai", "gpt-4o");
    assert.equal(getClientState("lifeos_byok_provider")?.value, "Google Gemini");
    assert.equal(getClientState("lifeos_model_engine")?.value, "gemini-3.5-flash");

    saveActiveAiProvider("openai", { type: "admin", id: "owner" });
    assert.equal(resolveAiProviderId({}), "openai");
    assert.equal(getClientState("lifeos_active_ai_provider")?.value, "openai");
    assert.equal(getClientState("lifeos_byok_provider")?.value, "OpenAI");
    assert.equal(getClientState("lifeos_model_engine")?.value, "gpt-4o");

    saveSelectedAiModel("openai", "gpt-4o-mini", { type: "admin", id: "owner" });
    assert.equal(getClientState("lifeos_model_engine")?.value, "gpt-4o-mini");

    saveSelectedAiModel("gemini", "gemini-1.5-pro", { type: "admin", id: "owner" });
    assert.equal(getClientState("lifeos_byok_provider")?.value, "OpenAI");
    assert.equal(getClientState("lifeos_model_engine")?.value, "gpt-4o-mini");
  });
});

test("AI runtime quickstart forces local Ollama over frontend provider hints", async () => {
  await withRuntime("quickstart-local", {
    LIFEOS_QUICKSTART: "1",
    LIFEOS_ACTIVE_AI_PROVIDER: "local",
    LOCAL_MODEL_BASE_URL: "http://ollama:11434/v1",
    LOCAL_MODEL_NAME: "llama3.2",
    GEMINI_API_KEY: "gemini-should-not-be-used",
  }, async ({ generateAiContent, resolveAiProviderId, resolveAiModel }) => {
    assert.equal(resolveAiProviderId({ providerId: "gemini", modelEngine: "Gemini 2.0 Flash" }), "local");
    assert.equal(resolveAiModel("local", "Gemini 2.0 Flash"), "llama3.2");

    const calls = [];
    globalThis.fetch = async (url, init) => {
      const body = JSON.parse(init.body);
      calls.push({ url: String(url), headers: init.headers, body });
      return jsonResponse({ choices: [{ message: { content: "Passport expires in 47 days." } }] });
    };

    const response = await generateAiContent({
      providerId: "gemini",
      modelEngine: "Gemini 2.0 Flash",
      contents: "What am I forgetting?",
    });

    assert.equal(response.providerId, "local");
    assert.equal(response.model, "llama3.2");
    assert.equal(calls[0].url, "http://ollama:11434/v1/chat/completions");
    assert.equal(calls[0].headers.Authorization, undefined);
  });
});
