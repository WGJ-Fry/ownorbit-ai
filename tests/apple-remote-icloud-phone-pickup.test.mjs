import assert from "node:assert/strict";
import test from "node:test";
import { getIcloudPhonePickupStatus } from "../src/pages/admin/icloudPhonePickupStatus.ts";

function confirmation(overrides = {}) {
  return {
    status: "confirmed",
    severity: "ok",
    action: "none",
    confirmedAt: 1_800_000_000_000,
    confirmedDeviceId: "phone-1",
    confirmedDeviceName: "Wang iPhone",
    ...overrides,
  };
}

test("iCloud phone pickup waits for the phone before any confirmation exists", () => {
  const status = getIcloudPhonePickupStatus({});

  assert.equal(status.icon, "phone");
  assert.equal(status.titleKey, "onboarding.simpleIcloudPickupWaitingTitle");
  assert.equal(status.actionKey, "onboarding.appleRemoteIcloudActionOpenFiles");
  assert.equal(status.cta, "none");
});

test("iCloud phone pickup confirms when phone opened the current entry", () => {
  const status = getIcloudPhonePickupStatus({ phoneConfirmation: confirmation() });

  assert.equal(status.icon, "ready");
  assert.equal(status.titleKey, "onboarding.simpleIcloudPickupConfirmedTitle");
  assert.equal(status.actionKey, "onboarding.simpleIcloudPickupConfirmedAction");
  assert.equal(status.deviceName, "Wang iPhone");
  assert.equal(status.confirmedAt, 1_800_000_000_000);
});

test("iCloud phone pickup prioritizes old entry repair over previous confirmation", () => {
  const status = getIcloudPhonePickupStatus({
    phoneConfirmation: confirmation(),
    latestEntryRepair: {
      status: "old-entry-opened",
      severity: "warning",
      needsQr: true,
      deviceName: "Old Phone",
      eventAt: 1_800_000_100_000,
    },
  });

  assert.equal(status.icon, "warning");
  assert.equal(status.titleKey, "onboarding.simpleIcloudPickupOldTitle");
  assert.equal(status.bodyKey, "onboarding.simpleIcloudPickupOldQrBody");
  assert.equal(status.actionKey, "onboarding.appleRemoteIcloudActionRefreshAndQr");
  assert.equal(status.cta, "qr");
  assert.equal(status.deviceName, "Old Phone");
  assert.equal(status.confirmedAt, 1_800_000_100_000);
});

test("iCloud phone pickup asks for refresh when an issue happens after confirmation", () => {
  const status = getIcloudPhonePickupStatus({
    phoneConfirmation: confirmation({
      status: "issue-after-confirm",
      severity: "danger",
      action: "refresh-entry",
    }),
  });

  assert.equal(status.icon, "refresh");
  assert.equal(status.titleKey, "onboarding.simpleIcloudPickupIssueTitle");
  assert.equal(status.actionKey, "onboarding.appleRemoteIcloudActionRefreshEntry");
  assert.equal(status.cta, "export");
  assert.match(status.tone, /red/);
});
