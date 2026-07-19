import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const packageVersion = JSON.parse(readFileSync("package.json", "utf8")).version;
const currentPackageTag = `v${packageVersion.includes("-") && packageVersion.endsWith(".0") ? packageVersion.slice(0, -2) : packageVersion}`;
const nextPackageTag = currentPackageTag.replace(/(v\d+\.\d+\.)(\d+)(-.+)/, (_match, prefix, patch, suffix) => `${prefix}${Number(patch) + 1}${suffix}`);
const nextPackageVersion = `${nextPackageTag.slice(1)}.0`;

function jsonResponse(value, ok = true, status = ok ? 200 : 500) {
  return {
    ok,
    status,
    async json() {
      return value;
    },
  };
}

test("release update check detects newer public prerelease and checksum asset", async () => {
  const oldUpdateUrl = process.env.LIFEOS_UPDATE_URL;
  const oldAutoUpdate = process.env.LIFEOS_ENABLE_DESKTOP_AUTO_UPDATE;
  delete process.env.LIFEOS_UPDATE_URL;
  delete process.env.LIFEOS_ENABLE_DESKTOP_AUTO_UPDATE;
  const module = await import(`../server/releaseUpdateCheck.ts?case=newer-${Date.now()}`);
  try {
    const result = await module.checkReleaseUpdate({
      now: new Date("2026-06-27T00:00:00.000Z"),
      fetchImpl: async () => jsonResponse([
        {
          tag_name: "v0.1.3-alpha",
          name: "Old alpha",
          html_url: "https://github.com/WGJ-Fry/ownorbit-ai/releases/tag/v0.1.3-alpha",
          draft: false,
          prerelease: true,
          published_at: "2026-06-26T00:00:00.000Z",
          assets: [],
        },
        {
          tag_name: nextPackageTag,
          name: "Next alpha",
          html_url: `https://github.com/WGJ-Fry/ownorbit-ai/releases/tag/${nextPackageTag}`,
          draft: false,
          prerelease: true,
          published_at: "2026-06-28T00:00:00.000Z",
          assets: [
            { name: "SHA256SUMS", size: 200, browser_download_url: "https://example.com/SHA256SUMS" },
            { name: `OwnOrbit.AI-${nextPackageVersion}-arm64-unsigned.zip`, size: 1200, browser_download_url: "https://example.com/app.zip" },
            { name: `OwnOrbit.AI.Setup.${nextPackageVersion}.exe`, size: 1000, browser_download_url: "https://example.com/app.exe" },
            { name: `OwnOrbit.AI-${nextPackageVersion}.AppImage`, size: 1100, browser_download_url: "https://example.com/app.AppImage" },
          ],
        },
        {
          tag_name: "v9.9.9-alpha",
          draft: true,
          prerelease: true,
          assets: [],
        },
      ]),
      platform: "darwin",
    });

    assert.equal(module.packageVersionToReleaseTag("0.1.5-alpha.0"), "v0.1.5-alpha");
    assert.equal(module.compareReleaseTags("v0.1.6-alpha", "v0.1.5-alpha") > 0, true);
    assert.equal(result.status, "update-available");
    assert.equal(result.updateAvailable, true);
    assert.equal(result.current.tag, currentPackageTag);
    assert.equal(result.latest.tag, nextPackageTag);
    assert.equal(result.latest.checksumAsset.name, "SHA256SUMS");
    assert.equal(result.manualUpdateRequired, true);
    assert.equal(result.autoUpdateEnabled, false);
    assert.equal(result.autoUpdate.mode, "manual");
    assert.equal(result.autoUpdate.reason, "not_configured");
    assert.equal(result.manualUpdatePlan.platform, "macos");
    assert.equal(result.manualUpdatePlan.assetName, `OwnOrbit.AI-${nextPackageVersion}-arm64-unsigned.zip`);
    assert.equal(result.manualUpdatePlan.assetUrl, "https://example.com/app.zip");
    assert.equal(result.manualUpdatePlan.checksumUrl, "https://example.com/SHA256SUMS");
    assert.match(result.manualUpdatePlan.checksumCommand, /shasum -a 256/);
    assert.match(result.manualUpdatePlan.installCommand, /Applications/);
    assert.deepEqual(result.manualUpdatePlan.steps.map((step) => step.id), ["backup", "download", "checksum", "install", "restart"]);
    assert.match(result.recommendations.join("\n"), /Verify SHA256SUMS/);
  } finally {
    if (oldUpdateUrl === undefined) delete process.env.LIFEOS_UPDATE_URL;
    else process.env.LIFEOS_UPDATE_URL = oldUpdateUrl;
    if (oldAutoUpdate === undefined) delete process.env.LIFEOS_ENABLE_DESKTOP_AUTO_UPDATE;
    else process.env.LIFEOS_ENABLE_DESKTOP_AUTO_UPDATE = oldAutoUpdate;
  }
});

test("release update check exposes opt-in auto-update feed readiness", async () => {
  const oldUpdateUrl = process.env.LIFEOS_UPDATE_URL;
  const oldAutoUpdate = process.env.LIFEOS_ENABLE_DESKTOP_AUTO_UPDATE;
  const oldDistribution = process.env.LIFEOS_DISTRIBUTION;
  const module = await import(`../server/releaseUpdateCheck.ts?case=auto-${Date.now()}`);
  try {
    delete process.env.LIFEOS_DISTRIBUTION;
    process.env.LIFEOS_UPDATE_URL = "https://updates.example.com/lifeos-ai/v0.1.5-alpha";
    delete process.env.LIFEOS_ENABLE_DESKTOP_AUTO_UPDATE;
    const manualUntilOptIn = await module.checkReleaseUpdate({
      fetchImpl: async () => jsonResponse([{ tag_name: "v0.1.5-alpha", draft: false, prerelease: true, assets: [] }]),
    });
    assert.equal(manualUntilOptIn.autoUpdateEnabled, false);
    assert.equal(manualUntilOptIn.autoUpdate.reason, "opt_in_required");
    assert.equal(manualUntilOptIn.manualUpdateRequired, true);

    process.env.LIFEOS_ENABLE_DESKTOP_AUTO_UPDATE = "1";
    const feedReady = await module.checkReleaseUpdate({
      fetchImpl: async () => jsonResponse([{ tag_name: "v0.1.5-alpha", draft: false, prerelease: true, assets: [] }]),
    });
    assert.equal(feedReady.autoUpdateEnabled, true);
    assert.equal(feedReady.autoUpdate.mode, "feed-ready");
    assert.equal(feedReady.autoUpdate.updateUrlHost, "updates.example.com");
    assert.equal(feedReady.autoUpdate.feedUrl, "https://updates.example.com/lifeos-ai/v0.1.5-alpha");
    assert.equal(feedReady.manualUpdateRequired, false);

    delete process.env.LIFEOS_ENABLE_DESKTOP_AUTO_UPDATE;
    process.env.LIFEOS_DISTRIBUTION = "signed";
    const signedDefaultReady = await module.checkReleaseUpdate({
      fetchImpl: async () => jsonResponse([{ tag_name: "v0.1.5-alpha", draft: false, prerelease: true, assets: [] }]),
    });
    assert.equal(signedDefaultReady.autoUpdateEnabled, true);
    assert.equal(signedDefaultReady.autoUpdate.mode, "feed-ready");
    assert.equal(signedDefaultReady.autoUpdate.reason, "ready");
    assert.equal(signedDefaultReady.manualUpdateRequired, false);
    assert.match(signedDefaultReady.autoUpdate.requirements.join("\n"), /signed\/notarized packages/);
  } finally {
    if (oldUpdateUrl === undefined) delete process.env.LIFEOS_UPDATE_URL;
    else process.env.LIFEOS_UPDATE_URL = oldUpdateUrl;
    if (oldAutoUpdate === undefined) delete process.env.LIFEOS_ENABLE_DESKTOP_AUTO_UPDATE;
    else process.env.LIFEOS_ENABLE_DESKTOP_AUTO_UPDATE = oldAutoUpdate;
    if (oldDistribution === undefined) delete process.env.LIFEOS_DISTRIBUTION;
    else process.env.LIFEOS_DISTRIBUTION = oldDistribution;
  }
});

test("release update check reports up-to-date and tolerates API failures", async () => {
  const module = await import(`../server/releaseUpdateCheck.ts?case=current-${Date.now()}`);
  const current = await module.checkReleaseUpdate({
    fetchImpl: async () => jsonResponse([
      {
        tag_name: "v0.1.5-alpha",
        name: "Current alpha",
        html_url: "https://github.com/WGJ-Fry/ownorbit-ai/releases/tag/v0.1.5-alpha",
        draft: false,
        prerelease: true,
        published_at: "2026-06-27T00:00:00.000Z",
        assets: [{ name: "SHA256SUMS", size: 200, browser_download_url: "https://example.com/SHA256SUMS" }],
      },
    ]),
  });
  assert.equal(current.status, "up-to-date");
  assert.equal(current.updateAvailable, false);
  assert.equal(current.latest.tag, "v0.1.5-alpha");

  const failed = await module.checkReleaseUpdate({
    fetchImpl: async () => jsonResponse({ message: "rate limited" }, false, 403),
  });
  assert.equal(failed.status, "error");
  assert.equal(failed.updateAvailable, false);
  assert.equal(failed.latest, null);
  assert.match(failed.reason, /release_api_http_403/);
});
