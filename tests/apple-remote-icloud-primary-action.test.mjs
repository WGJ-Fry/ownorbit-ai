import assert from "node:assert/strict";
import test from "node:test";
import { getIcloudActionFollowupKey, getPrimaryIcloudAction, isIcloudEntrySameWifiOnly } from "../src/pages/admin/appleRemoteIcloudPrimaryAction.ts";

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
  assert.equal(action.actionKey, "onboarding.appleRemoteIcloudActionEnableDrive");
  assert.equal(action.cta, "icloud-settings");
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
  assert.equal(action.actionKey, "onboarding.appleRemoteIcloudActionRefreshAndQr");
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
  assert.equal(action.actionKey, "onboarding.appleRemoteIcloudActionCreateEntry");
  assert.equal(action.cta, "export");
});

test("iCloud primary action gives one plain wait action while files sync", () => {
  const action = getPrimaryIcloudAction({
    icloud: baseIcloud(),
    latestEntryRepair: null,
    pairingSession: { action: "none" },
    syncReadiness: baseSyncReadiness({ action: "wait-for-sync", canOpenOnPhone: false }),
    handoffHealth: baseHandoffHealth({ status: "fresh", needsRefresh: false }),
    canExportIcloud: true,
  });

  assert.equal(action.titleKey, "onboarding.appleRemoteIcloudNextStepWaitTitle");
  assert.equal(action.actionKey, "onboarding.appleRemoteIcloudActionWaitSync");
  assert.equal(action.cta, "icloud-folder");
});

test("iCloud primary action opens iCloud settings when sync is stuck", () => {
  const action = getPrimaryIcloudAction({
    icloud: baseIcloud(),
    latestEntryRepair: null,
    pairingSession: { action: "none" },
    syncReadiness: baseSyncReadiness({ action: "fix-icloud-sync", canOpenOnPhone: false }),
    handoffHealth: baseHandoffHealth({ status: "fresh", needsRefresh: false }),
    canExportIcloud: true,
  });

  assert.equal(action.titleKey, "onboarding.appleRemoteIcloudNextStepFixSyncTitle");
  assert.equal(action.actionKey, "onboarding.appleRemoteIcloudActionFixSync");
  assert.equal(action.cta, "icloud-settings");
});

test("iCloud primary action tells users when the entry is ready to open on phone", () => {
  const action = getPrimaryIcloudAction({
    icloud: baseIcloud({
      recommendedMode: "tailscale",
      recommendedStability: "stable",
      recommendedBaseUrl: "https://lifeos-mac.tailnet.example.ts.net",
    }),
    latestEntryRepair: null,
    pairingSession: { action: "none" },
    syncReadiness: baseSyncReadiness({ action: "open-files-app", canOpenOnPhone: true }),
    handoffHealth: baseHandoffHealth({ status: "fresh", needsRefresh: false }),
    canExportIcloud: true,
  });

  assert.equal(action.titleKey, "onboarding.appleRemoteIcloudNextStepPhoneTitle");
  assert.equal(action.icon, "phone");
  assert.equal(action.actionKey, "onboarding.appleRemoteIcloudActionOpenFiles");
  assert.equal(action.cta, "none");
});

test("iCloud primary action lets LAN-only Apple entries continue same-Wi-Fi pairing without claiming off-LAN readiness", () => {
  const action = getPrimaryIcloudAction({
    icloud: baseIcloud({
      recommendedMode: "lan",
      recommendedStability: "local",
      recommendedBaseUrl: "http://192.168.0.17:3000",
    }),
    latestEntryRepair: null,
    pairingSession: { action: "none" },
    syncReadiness: baseSyncReadiness({ action: "open-files-app", canOpenOnPhone: true }),
    handoffHealth: baseHandoffHealth({ status: "fresh", needsRefresh: false }),
    canExportIcloud: true,
  });

  assert.equal(action.titleKey, "onboarding.appleRemoteIcloudNextStepSameWifiOpenTitle");
  assert.equal(action.bodyKey, "onboarding.appleRemoteIcloudNextStepSameWifiOpenBody");
  assert.equal(action.icon, "phone");
  assert.equal(action.actionKey, "onboarding.appleRemoteIcloudActionOpenFilesSameWifi");
  assert.equal(action.cta, "none");
});

test("iCloud primary action follow-up copy is shared by simple and advanced onboarding", () => {
  assert.equal(
    getIcloudActionFollowupKey("onboarding.appleRemoteIcloudActionChooseRemoteEntry"),
    "onboarding.appleRemoteIcloudFollowupChooseRemoteEntry",
  );
  assert.equal(
    getIcloudActionFollowupKey("onboarding.appleRemoteIcloudActionWaitSync"),
    "onboarding.appleRemoteIcloudFollowupWaitSync",
  );
  assert.equal(
    getIcloudActionFollowupKey("onboarding.appleRemoteIcloudActionOpenFilesSameWifi"),
    "onboarding.appleRemoteIcloudFollowupOpenFilesSameWifi",
  );
  assert.equal(
    getIcloudActionFollowupKey("onboarding.unknownAction"),
    "onboarding.appleRemoteIcloudFollowupReview",
  );
});

test("iCloud helper identifies same-Wi-Fi entries that cannot carry off-LAN realtime chat", () => {
  assert.equal(isIcloudEntrySameWifiOnly({
    recommendedMode: "lan",
    recommendedStability: "local",
    recommendedBaseUrl: "http://192.168.0.17:3000",
  }), true);
  assert.equal(isIcloudEntrySameWifiOnly({
    mode: "configured",
    stability: "stable",
    baseUrl: "http://lifeos.local:3000",
  }), true);
  assert.equal(isIcloudEntrySameWifiOnly({
    recommendedMode: "tailscale",
    recommendedStability: "stable",
    recommendedBaseUrl: "https://lifeos-mac.tailnet.example.ts.net",
  }), false);
});
