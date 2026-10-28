import assert from "node:assert/strict";
import test from "node:test";
import { zhCNTranslations } from "../src/i18n/translations.zh-CN.ts";
import { formatDevicePairingCreateError } from "../src/services/devicePairingErrors.ts";

const t = (key) => zhCNTranslations[key] || key;

test("device pairing QR creation errors become actionable copy", () => {
  assert.equal(
    formatDevicePairingCreateError({ status: 500, code: "binding_session_create_failed", message: "Request failed: 500" }, t),
    zhCNTranslations["devicePair.createFailedRestart"],
  );
  assert.equal(
    formatDevicePairingCreateError({ status: 429, message: "Too many requests" }, t),
    zhCNTranslations["devicePair.createFailedRateLimit"],
  );
  assert.equal(
    formatDevicePairingCreateError({ status: 403, message: "Forbidden" }, t),
    zhCNTranslations["devicePair.createFailedLogin"],
  );
});

test("device pairing QR creation explains that LAN pairing needs LAN binding", () => {
  assert.equal(
    formatDevicePairingCreateError(
      { status: 409, code: "lan_pairing_requires_lan_binding", message: "This computer only listens on its own loopback address" },
      t,
    ),
    zhCNTranslations["devicePair.createFailedLanBindingRequired"],
  );
});

test("device pairing QR creation explains unsafe or unreachable base URLs", () => {
  assert.equal(
    formatDevicePairingCreateError(new Error("baseUrl must not contain username, password, token, query, or fragment"), t),
    zhCNTranslations["devicePair.createFailedBaseUrlUnsafe"],
  );
  assert.equal(
    formatDevicePairingCreateError(new Error("baseUrl must be reachable from the phone"), t),
    zhCNTranslations["devicePair.createFailedBaseUrlUnreachable"],
  );
  assert.equal(
    formatDevicePairingCreateError(new Error("Request timed out. Please retry after the local core is ready."), t),
    zhCNTranslations["devicePair.createFailedLocalCore"],
  );
});
