import assert from "node:assert/strict";
import test from "node:test";
import { getPrimaryIcloudAction } from "../src/pages/admin/appleRemoteIcloudPrimaryAction.ts";

function baseIcloud(overrides = {}) {
  return {
    platformSupported: true,
    ...overrides,
  };
}

function baseHandoffHealth(overrides = {}) {
  return {
    status: "fresh",
    needsRefresh: false,
    ...overrides,
  };
}

function baseSyncReadiness(overrides = {}) {
  return {
    action: "open-files-app",
    canOpenOnPhone: true,
    ...overrides,
  };
}

test("iCloud primary action asks Apple users to enable iCloud Drive before exporting", () => {
  const action = getPrimaryIcloudAction({
    icloud: baseIcloud(),
    latestEntryRepair: null,
    pairingSession: undefined,
    syncReadiness: undefined,
    handoffHealth: undefined,
    canExportIcloud: false,
  });

  assert.equal(action.titleKey, "onboarding.appleRemoteIcloudNextStepEnableTitle");
  assert.equal(action.cta, "none");
});

test("iCloud primary action prioritizes old phone entry repair over generic readiness", () => {
  const action = getPrimaryIcloudAction({
    icloud: baseIcloud(),
    latestEntryRepair: {
      status: "old-entry-opened",
      action: "refresh-and-regenerate-qr",
      severity: "warning",
      needsQr: true,
    },
    pairingSession: undefined,
    syncReadiness: baseSyncReadiness(),
    handoffHealth: baseHandoffHealth(),
    canExportIcloud: true,
  });

  assert.equal(action.titleKey, "onboarding.appleRemoteIcloudNextStepOldEntryTitle");
  assert.equal(action.bodyKey, "onboarding.appleRemoteIcloudNextStepOldEntryQrBody");
  assert.equal(action.cta, "qr");
});

test("iCloud primary action sends missing entries to export instead of diagnostics", () => {
  const action = getPrimaryIcloudAction({
    icloud: baseIcloud(),
    latestEntryRepair: null,
    pairingSession: undefined,
    syncReadiness: baseSyncReadiness({ action: "export-entry", canOpenOnPhone: false }),
    handoffHealth: baseHandoffHealth({ status: "missing" }),
    canExportIcloud: true,
  });

  assert.equal(action.titleKey, "onboarding.appleRemoteIcloudNextStepExportTitle");
  assert.equal(action.cta, "export");
});

test("iCloud primary action tells users when the entry is ready to open on phone", () => {
  const action = getPrimaryIcloudAction({
    icloud: baseIcloud(),
    latestEntryRepair: null,
    pairingSession: { action: "none" },
    syncReadiness: baseSyncReadiness({ action: "open-files-app", canOpenOnPhone: true }),
    handoffHealth: baseHandoffHealth({ status: "fresh", needsRefresh: false }),
    canExportIcloud: true,
  });

  assert.equal(action.titleKey, "onboarding.appleRemoteIcloudNextStepPhoneTitle");
  assert.equal(action.icon, "phone");
  assert.equal(action.cta, "none");
});
