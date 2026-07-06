import assert from "node:assert/strict";
import test from "node:test";
import { getSimpleIcloudStatus } from "../src/pages/admin/OnboardingAppleRemoteCard.tsx";

function baseIcloud(overrides = {}) {
  return {
    canExport: true,
    availability: { status: "ready" },
    handoffHealth: { status: "fresh", needsRefresh: false },
    syncReadiness: { status: "ready" },
    pairingSession: { action: "use-current-qr", severity: "ok" },
    latestEntryRepair: { status: "none", severity: "ok", needsRefresh: false, needsQr: false },
    ...overrides,
  };
}

test("simple iCloud status surfaces old phone entries before fresh sync state", () => {
  const status = getSimpleIcloudStatus(baseIcloud({
    latestEntryRepair: {
      status: "old-entry-opened",
      severity: "warning",
      needsRefresh: true,
      needsQr: true,
    },
  }));

  assert.equal(status.icon, "refresh");
  assert.equal(status.titleKey, "onboarding.appleRemoteIcloudSimpleOldEntryTitle");
  assert.equal(status.bodyKey, "onboarding.appleRemoteIcloudSimpleOldEntryQrBody");
});

test("simple iCloud status surfaces stale pairing QR before ready sync state", () => {
  const status = getSimpleIcloudStatus(baseIcloud({
    pairingSession: {
      action: "regenerate-qr",
      severity: "danger",
    },
  }));

  assert.equal(status.icon, "qr");
  assert.equal(status.titleKey, "onboarding.appleRemoteIcloudSimpleQrTitle");
  assert.equal(status.bodyKey, "onboarding.appleRemoteIcloudSimpleQrBody");
  assert.match(status.tone, /red/);
});
