import assert from "node:assert/strict";
import test from "node:test";
import { translations } from "../src/i18n/translations.ts";
import { formatDevicePairingCreateError } from "../src/services/devicePairingErrors.ts";

const t = (key) => translations["zh-CN"][key] || key;

test("device pairing QR creation errors become actionable copy", () => {
  assert.equal(
    formatDevicePairingCreateError({ status: 500, code: "binding_session_create_failed", message: "Request failed: 500" }, t),
    translations["zh-CN"]["devicePair.createFailedRestart"],
  );
  assert.equal(
    formatDevicePairingCreateError({ status: 429, message: "Too many requests" }, t),
    translations["zh-CN"]["devicePair.createFailedRateLimit"],
  );
  assert.equal(
    formatDevicePairingCreateError({ status: 403, message: "Forbidden" }, t),
    translations["zh-CN"]["devicePair.createFailedLogin"],
  );
});

test("device pairing QR creation explains unsafe or unreachable base URLs", () => {
  assert.equal(
    formatDevicePairingCreateError(new Error("baseUrl must not contain username, password, token, query, or fragment"), t),
    translations["zh-CN"]["devicePair.createFailedBaseUrlUnsafe"],
  );
  assert.equal(
    formatDevicePairingCreateError(new Error("baseUrl must be reachable from the phone"), t),
    translations["zh-CN"]["devicePair.createFailedBaseUrlUnreachable"],
  );
  assert.equal(
    formatDevicePairingCreateError(new Error("Request timed out. Please retry after the local core is ready."), t),
    translations["zh-CN"]["devicePair.createFailedLocalCore"],
  );
});
