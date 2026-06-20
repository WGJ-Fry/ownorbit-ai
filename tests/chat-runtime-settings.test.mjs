import assert from "node:assert/strict";
import test from "node:test";
import { readLocalRuntimeValue } from "../src/services/chatRuntimeSettings.ts";

function withLocalStorage(values, run) {
  const previous = globalThis.localStorage;
  globalThis.localStorage = {
    getItem(key) {
      if (values === "throw") throw new Error("blocked");
      return Object.prototype.hasOwnProperty.call(values, key) ? values[key] : null;
    },
  };
  try {
    run();
  } finally {
    if (previous === undefined) delete globalThis.localStorage;
    else globalThis.localStorage = previous;
  }
}

test("runtime settings read strings, booleans, numbers, and JSON arrays from local fallback storage", () => {
  withLocalStorage({
    lifeos_model_engine: "Gemini 2.0 Flash",
    lifeos_proxy_enabled: "true",
    lifeos_proxy_timeout: "15",
    lifeos_proxy_nodes: JSON.stringify([{ id: "hk", name: "Hong Kong" }]),
  }, () => {
    assert.equal(readLocalRuntimeValue("lifeos_model_engine", "fallback"), "Gemini 2.0 Flash");
    assert.equal(readLocalRuntimeValue("lifeos_proxy_enabled", false), true);
    assert.equal(readLocalRuntimeValue("lifeos_proxy_timeout", 3), 15);
    assert.deepEqual(readLocalRuntimeValue("lifeos_proxy_nodes", []), [{ id: "hk", name: "Hong Kong" }]);
  });
});

test("runtime settings ignore corrupted local JSON for structured values", () => {
  withLocalStorage({
    lifeos_proxy_nodes: "{bad json",
    lifeos_proxy_enabled: "not true",
    lifeos_proxy_timeout: "NaN",
  }, () => {
    assert.deepEqual(readLocalRuntimeValue("lifeos_proxy_nodes", []), []);
    assert.equal(readLocalRuntimeValue("lifeos_proxy_enabled", false), false);
    assert.equal(readLocalRuntimeValue("lifeos_proxy_timeout", 3), 3);
  });
});

test("runtime settings refuse sensitive local fallback keys", () => {
  withLocalStorage({
    lifeos_byok_key: "AIzaSy-local-legacy-secret",
    lifeos_proxy_url: "https://proxy.example.test/sub?token=secret",
    lifeos_openai_api_key: "sk-local-legacy-secret",
  }, () => {
    assert.equal(readLocalRuntimeValue("lifeos_byok_key", ""), "");
    assert.equal(readLocalRuntimeValue("lifeos_proxy_url", "direct"), "direct");
    assert.equal(readLocalRuntimeValue("lifeos_openai_api_key", null), null);
  });
});

test("runtime settings tolerate unavailable browser storage", () => {
  withLocalStorage("throw", () => {
    assert.equal(readLocalRuntimeValue("lifeos_model_engine", "Gemini 2.0 Flash"), "Gemini 2.0 Flash");
  });
});
