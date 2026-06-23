import assert from "node:assert/strict";
import test from "node:test";
import {
  loadMobileInstallHintDismissed,
  MOBILE_INSTALL_HINT_DISMISSED_KEY,
  saveMobileInstallHintDismissed,
} from "../src/services/mobileInstallHintStorage.ts";

test("mobile install hint storage reads and writes the dismissed state", () => {
  const values = new Map();
  const storage = {
    getItem(key) {
      return values.get(key) ?? null;
    },
    setItem(key, value) {
      values.set(key, String(value));
    },
  };

  assert.equal(loadMobileInstallHintDismissed(storage), false);
  assert.equal(saveMobileInstallHintDismissed(storage), true);
  assert.equal(values.get(MOBILE_INSTALL_HINT_DISMISSED_KEY), "1");
  assert.equal(loadMobileInstallHintDismissed(storage), true);
});

test("mobile install hint storage is best-effort when browser storage is blocked", () => {
  const brokenStorage = {
    getItem() {
      throw new Error("blocked");
    },
    setItem() {
      throw new Error("quota");
    },
  };

  assert.equal(loadMobileInstallHintDismissed(brokenStorage), false);
  assert.equal(saveMobileInstallHintDismissed(brokenStorage), false);
});
