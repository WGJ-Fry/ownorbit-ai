import assert from "node:assert/strict";
import test from "node:test";
import policy from "../desktop/loginItemPolicy.cjs";

test("packaged macOS desktop starts at login by default", () => {
  assert.deepEqual(policy.resolveDesktopLoginItemPolicy({
    platform: "darwin",
    isPackaged: true,
    environment: {},
  }), {
    supported: true,
    enabled: true,
    openAtLogin: true,
    openAsHidden: true,
  });
});

test("login item policy is opt-out and Apple-only", () => {
  assert.equal(policy.resolveDesktopLoginItemPolicy({
    platform: "darwin",
    isPackaged: true,
    environment: { LIFEOS_DESKTOP_OPEN_AT_LOGIN: "0" },
  }).enabled, false);
  assert.equal(policy.resolveDesktopLoginItemPolicy({
    platform: "win32",
    isPackaged: true,
    environment: {},
  }).supported, false);
  assert.equal(policy.resolveDesktopLoginItemPolicy({
    platform: "darwin",
    isPackaged: false,
    environment: {},
  }).supported, false);
});

test("login startup stays in the tray after setup but remains visible for first setup", () => {
  assert.equal(policy.shouldShowDesktopWindowOnStartup({
    wasOpenedAtLogin: true,
    adminConfigured: true,
    environment: {},
  }), false);
  assert.equal(policy.shouldShowDesktopWindowOnStartup({
    wasOpenedAtLogin: true,
    adminConfigured: false,
    environment: {},
  }), true);
  assert.equal(policy.shouldShowDesktopWindowOnStartup({
    wasOpenedAtLogin: true,
    adminConfigured: true,
    environment: { LIFEOS_DESKTOP_SHOW_ON_LOGIN: "1" },
  }), true);
});
