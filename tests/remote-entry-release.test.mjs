import assert from "node:assert/strict";
import test from "node:test";
import { releaseStoppedRemoteEntry } from "../server/remoteEntryRelease.ts";
import { getConfiguredPublicOrigin } from "../server/publicBaseUrl.ts";

const KEYS = ["PUBLIC_BASE_URL", "APP_URL", "LIFEOS_ALLOW_PUBLIC", "LIFEOS_TRUST_PROXY", "LIFEOS_HOST"];

function withEnv(values, run) {
  const saved = Object.fromEntries(KEYS.map((key) => [key, process.env[key]]));
  for (const key of KEYS) delete process.env[key];
  Object.assign(process.env, values);
  try {
    run();
  } finally {
    for (const key of KEYS) {
      if (saved[key] === undefined) delete process.env[key];
      else process.env[key] = saved[key];
    }
  }
}

test("stopping the active tunnel hands the entry to a tunnel that is still live", () => {
  // Cloudflare was started last and owned PUBLIC_BASE_URL; it has just been
  // stopped and cleared, while Tailscale Serve keeps running.
  withEnv({ LIFEOS_HOST: "127.0.0.1", LIFEOS_ALLOW_PUBLIC: "1", LIFEOS_TRUST_PROXY: "1" }, () => {
    releaseStoppedRemoteEntry({ mode: "tailscale", label: "Tailscale HTTPS Serve", url: "https://mac.tailnet.ts.net" });
    assert.equal(process.env.PUBLIC_BASE_URL, "https://mac.tailnet.ts.net");
    assert.equal(process.env.LIFEOS_TRUST_PROXY, "1");
    assert.equal(process.env.LIFEOS_ALLOW_PUBLIC, "1");
    // The realtime origin allowlist reads this — the surviving tunnel's
    // https:// WebSocket origin stays accepted.
    assert.equal(getConfiguredPublicOrigin(), "https://mac.tailnet.ts.net");
  });
});

test("with no remote path left, proxy trust is dropped on a loopback core", () => {
  withEnv({ LIFEOS_HOST: "127.0.0.1", LIFEOS_ALLOW_PUBLIC: "1", LIFEOS_TRUST_PROXY: "1" }, () => {
    releaseStoppedRemoteEntry(null);
    assert.equal(process.env.LIFEOS_TRUST_PROXY, undefined);
    assert.equal(process.env.LIFEOS_ALLOW_PUBLIC, undefined);
  });
});

test("a LAN-bound core keeps public access for its own listener", () => {
  withEnv({ LIFEOS_HOST: "0.0.0.0", LIFEOS_ALLOW_PUBLIC: "1", LIFEOS_TRUST_PROXY: "1" }, () => {
    releaseStoppedRemoteEntry(null);
    assert.equal(process.env.LIFEOS_TRUST_PROXY, undefined);
    assert.equal(process.env.LIFEOS_ALLOW_PUBLIC, "1");
  });
});

test("an independently configured public URL keeps its settings", () => {
  withEnv({
    LIFEOS_HOST: "127.0.0.1",
    LIFEOS_ALLOW_PUBLIC: "1",
    LIFEOS_TRUST_PROXY: "1",
    APP_URL: "https://orbit.example.com",
  }, () => {
    releaseStoppedRemoteEntry(null);
    assert.equal(process.env.LIFEOS_TRUST_PROXY, "1");
    assert.equal(process.env.LIFEOS_ALLOW_PUBLIC, "1");
  });
});
