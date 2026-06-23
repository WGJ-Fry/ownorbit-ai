import assert from "node:assert/strict";
import test from "node:test";

import { redactApiErrorPayload } from "../server/httpSecurity.ts";

test("API error response redaction removes secrets without changing business tokens", () => {
  const payload = {
    error: "Failed with Basic Z2l0aHViOmVycm9y github_pat_errorSecret_1234567890 /Users/wangguojun/private.txt",
    message: "Bearer admin-error-token and https://user:pass@example.test/path?token=secret#debug",
    reason: "sk-error-secret-value-should-not-leak",
    details: [
      { detail: "C:\\Users\\example\\secret.txt" },
      { detail: "AIzaSy-error-secret-value-should-not-leak" },
    ],
    token: "bind_business_token_must_remain_available",
    nested: {
      accessToken: "device_business_token_must_remain_available",
      lastError: "ghp_errorSecretTokenValue000000000000",
    },
  };

  const redacted = redactApiErrorPayload(payload);
  const serialized = JSON.stringify(redacted);

  assert.equal(redacted.token, payload.token);
  assert.equal(redacted.nested.accessToken, payload.nested.accessToken);
  assert.match(redacted.error, /Basic \[redacted\]/);
  assert.match(redacted.message, /Bearer \[redacted\]/);
  assert.match(redacted.message, /\?\[redacted\]#\[redacted\]/);
  assert.match(redacted.details[0].detail, /\[local-path\]/);
  assert.doesNotMatch(serialized, /Z2l0aHViOmVycm9y|github_pat_errorSecret|admin-error-token|user:pass|token=secret|#debug|wangguojun|sk-error-secret|AIzaSy-error|ghp_errorSecret/);
});
