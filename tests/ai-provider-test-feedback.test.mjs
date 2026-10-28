import assert from "node:assert/strict";
import test from "node:test";

import { getAiProviderTestFeedback } from "../src/services/aiProviderTestFeedback.ts";

function result(overrides = {}) {
  return {
    ok: false,
    provider: {
      id: "openai",
      provider: "OpenAI",
      enabled: true,
      configured: false,
      selectedModel: "gpt-test",
    },
    message: "raw provider message",
    mode: "live",
    liveSupported: true,
    checkedAt: Date.now(),
    result: "live_failed",
    ...overrides,
  };
}

test("AI provider test feedback gives actionable localized reasons without raw provider text", () => {
  assert.deepEqual(
    getAiProviderTestFeedback(result({ reason: "selected_model_unavailable", selectedModelAvailable: false })),
    { key: "aiTestFeedback.modelUnavailable", params: { model: "gpt-test" } },
  );
  assert.equal(getAiProviderTestFeedback(result({ reason: "credential_probe_failed" })).key, "aiTestFeedback.credentialRejected");
  assert.equal(getAiProviderTestFeedback(result({ reason: "credential_probe_timeout" })).key, "aiTestFeedback.timeout");
  assert.equal(getAiProviderTestFeedback(result({ reason: "models_endpoint_unreachable" })).key, "aiTestFeedback.networkUnreachable");
  assert.equal(getAiProviderTestFeedback(result({ reason: "missing_local_endpoint" })).key, "aiTestFeedback.localEndpointMissing");
  assert.equal(getAiProviderTestFeedback(result({ reason: "unknown", message: "secret raw error" })).key, "aiTestFeedback.generic");
});
