// @ts-nocheck
import assert from "node:assert/strict";
import test from "node:test";

test("mobile pairing errors map expired tokens to a friendly recovery message", async () => {
  const { getMobilePairingErrorCopy } = await import(`../src/services/mobilePairingErrors.ts?case=expired-${Date.now()}`);

  assert.deepEqual(getMobilePairingErrorCopy({ status: 400, message: "Binding token is invalid or expired" }), {
    titleKey: "mobilePair.errorExpiredTitle",
    bodyKey: "mobilePair.errorExpiredBody",
    recoveryAction: "generate-new-qr",
  });
});

test("mobile pairing errors map network failures to connection guidance", async () => {
  const { getMobilePairingErrorCopy } = await import(`../src/services/mobilePairingErrors.ts?case=network-${Date.now()}`);

  assert.deepEqual(getMobilePairingErrorCopy(new Error("Failed to fetch")), {
    titleKey: "mobilePair.errorNetworkTitle",
    bodyKey: "mobilePair.errorNetworkBody",
  });
});

test("mobile pairing errors use a generic non-technical fallback", async () => {
  const { getMobilePairingErrorCopy } = await import(`../src/services/mobilePairingErrors.ts?case=generic-${Date.now()}`);

  assert.deepEqual(getMobilePairingErrorCopy(new Error("Internal Server Error: bind_secret_token")), {
    titleKey: "mobilePair.errorGenericTitle",
    bodyKey: "mobilePair.errorGenericBody",
  });
});
