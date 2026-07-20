import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import crypto from "node:crypto";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

test("version truth check keeps public docs aligned with current release facts", () => {
  const packageJson = JSON.parse(readFileSync("package.json", "utf8"));
  const releaseState = JSON.parse(readFileSync("docs/release-state.json", "utf8"));
  const publicVersion = packageJson.version.includes("-") && packageJson.version.endsWith(".0")
    ? packageJson.version.slice(0, -2)
    : packageJson.version;
  const releaseTag = `v${publicVersion}`;
  const result = spawnSync(process.execPath, ["scripts/check-version-truth.mjs"], {
    cwd: process.cwd(),
    encoding: "utf8",
  });

  assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
  assert.match(result.stdout, new RegExp(`Version truth passed for ${releaseTag.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`));
  assert.match(result.stdout, new RegExp(`Public downloads remain ${releaseState.publicTag.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`));
  assert.match(result.stdout, /release state source package version matches package\.json/);
  assert.match(result.stdout, /source candidate uses the OwnOrbit GHCR repository/);
  assert.match(result.stdout, /source macOS artifact name matches the OwnOrbit package version/);
  assert.match(result.stdout, /public artifact names are explicit release facts/);
  assert.match(result.stdout, /source candidate release notes describe implemented CloudKit chat/);
  assert.match(result.stdout, /README files separate the source candidate from public downloads/);
  assert.match(result.stdout, /English README keeps the current alpha limits visible/);
  assert.match(result.stdout, /Chinese README keeps the current alpha limits visible/);
  assert.match(result.stdout, /version roadmap separates shipped, next, and future work/);
  assert.match(result.stdout, /remote acceptance evidence guard is available/);
  assert.match(result.stdout, /release promotion guard is available/);
});

test("version truth remote acceptance guard requires real-world evidence", async (t) => {
  const releaseDir = await mkdtemp(path.join(tmpdir(), "lifeos-version-truth-remote-"));
  t.after(async () => {
    await rm(releaseDir, { recursive: true, force: true });
  });

  const missingEvidence = spawnSync(process.execPath, ["scripts/check-version-truth.mjs", "--require-remote-acceptance"], {
    cwd: process.cwd(),
    env: {
      ...process.env,
      LIFEOS_RELEASE_DIR: releaseDir,
    },
    encoding: "utf8",
  });
  assert.notEqual(missingEvidence.status, 0, `${missingEvidence.stdout}\n${missingEvidence.stderr}`);
  assert.match(missingEvidence.stderr, /missing remote acceptance evidence file/);

  const now = Date.now();
  const scenarioMatrix = [
    "restart-restore",
    "cellular-mobile-chat",
    "network-switch",
    "stale-qr-repair",
    "network-interruption",
    "diagnostic-export",
  ].map((id) => ({
    id,
    status: "passed",
    acceptedAt: now - 60_000,
    expiresAt: now + 86_400_000,
    evidence: `${id} real remote acceptance proof captured from phone, restart, tunnel, QR repair, and diagnostic evidence.`,
  }));
  const coverage = scenarioMatrix.map((item) => ({
    ...item,
    evidence: `${item.id} coverage proof reviewed from the real remote acceptance checklist.`,
  }));
  await writeFile(path.join(releaseDir, "remote-acceptance-evidence.json"), `${JSON.stringify({
    remote: {
      acceptanceEvidencePack: {
        ready: true,
        baseUrl: "https://lifeos.example.test",
        longTermEntryReady: true,
        automatedReady: true,
        realWorldReady: true,
        realWorldPassed: scenarioMatrix.length,
        realWorldTotal: scenarioMatrix.length,
        missingCount: 0,
        expiredCount: 0,
        missingRealWorldIds: [],
        expiredRealWorldIds: [],
        scenarioMatrix,
        coverage,
      },
    },
  }, null, 2)}\n`);

  const completeEvidence = spawnSync(process.execPath, ["scripts/check-version-truth.mjs", "--require-remote-acceptance"], {
    cwd: process.cwd(),
    env: {
      ...process.env,
      LIFEOS_RELEASE_DIR: releaseDir,
    },
    encoding: "utf8",
  });
  assert.equal(completeEvidence.status, 0, `${completeEvidence.stdout}\n${completeEvidence.stderr}`);
  assert.match(completeEvidence.stdout, /remote acceptance evidence covers all real-world scenarios/);
  assert.match(completeEvidence.stdout, /remote acceptance coverage includes every real-world scenario/);
  assert.match(completeEvidence.stdout, /remote acceptance evidence is fresh/);
  assert.match(completeEvidence.stdout, /remote acceptance evidence is redacted/);
  assert.match(completeEvidence.stdout, /remote acceptance base URL is not a temporary trycloudflare tunnel/);

  const staleScenarioMatrix = scenarioMatrix.map((item) => ({
    ...item,
    evidence: "",
    acceptedAt: now - 8 * 24 * 60 * 60 * 1000,
    expiresAt: now - 60_000,
  }));
  await writeFile(path.join(releaseDir, "remote-acceptance-evidence.json"), `${JSON.stringify({
    remote: {
      acceptanceEvidencePack: {
        ready: true,
        baseUrl: "https://lifeos.example.test",
        longTermEntryReady: true,
        automatedReady: true,
        realWorldReady: true,
        realWorldPassed: scenarioMatrix.length,
        realWorldTotal: scenarioMatrix.length,
        missingCount: 0,
        expiredCount: 0,
        missingRealWorldIds: [],
        expiredRealWorldIds: [],
        scenarioMatrix: staleScenarioMatrix,
        coverage: [],
      },
    },
  }, null, 2)}\n`);

  const staleEvidence = spawnSync(process.execPath, ["scripts/check-version-truth.mjs", "--require-remote-acceptance"], {
    cwd: process.cwd(),
    env: {
      ...process.env,
      LIFEOS_RELEASE_DIR: releaseDir,
    },
    encoding: "utf8",
  });
  assert.notEqual(staleEvidence.status, 0, `${staleEvidence.stdout}\n${staleEvidence.stderr}`);
  assert.match(staleEvidence.stderr, /remote acceptance coverage is missing passed scenario/);
  assert.match(staleEvidence.stderr, /remote acceptance evidence is stale/);
  assert.match(staleEvidence.stderr, /remote acceptance evidence has weak or missing proof text/);
});

test("version truth release asset guard requires all desktop platforms", async (t) => {
  const packageJson = JSON.parse(readFileSync("package.json", "utf8"));
  const releaseDir = await mkdtemp(path.join(tmpdir(), "lifeos-version-truth-assets-"));
  t.after(async () => {
    await rm(releaseDir, { recursive: true, force: true });
  });

  async function writeAsset(platform, fileName, feedFile, bytes) {
    const sha256 = crypto.createHash("sha256").update(bytes).digest("hex");
    const sha512 = crypto.createHash("sha512").update(bytes).digest("base64");
    await writeFile(path.join(releaseDir, fileName), bytes);
    await writeFile(path.join(releaseDir, "update-feed", feedFile), [
      `version: "${packageJson.version}"`,
      `path: "${fileName}"`,
      `sha512: "${sha512}"`,
      "",
    ].join("\n"));
    return {
      platform,
      feedFile,
      fileName,
      size: Buffer.byteLength(bytes),
      sha512,
      sha256,
      releaseDate: new Date(0).toISOString(),
    };
  }

  await mkdir(path.join(releaseDir, "update-feed"), { recursive: true });
  const mac = await writeAsset("mac", `OwnOrbit AI-${packageJson.version}-arm64-unsigned.zip`, "latest-mac.yml", "mac bytes");
  const windows = await writeAsset("windows", `OwnOrbit AI Setup ${packageJson.version}.exe`, "latest.yml", "windows bytes");
  await writeFile(path.join(releaseDir, "SHA256SUMS"), [
    `${mac.sha256}  ${mac.fileName}`,
    `${windows.sha256}  ${windows.fileName}`,
    "",
  ].join("\n"));
  await writeFile(path.join(releaseDir, "update-feed", "release-manifest.json"), `${JSON.stringify({
    version: packageJson.version,
    generatedAt: new Date(0).toISOString(),
    artifacts: [mac, windows],
  }, null, 2)}\n`);

  const missingLinux = spawnSync(process.execPath, ["scripts/check-version-truth.mjs", "--require-assets"], {
    cwd: process.cwd(),
    env: {
      ...process.env,
      LIFEOS_RELEASE_DIR: releaseDir,
    },
    encoding: "utf8",
  });
  assert.notEqual(missingLinux.status, 0, `${missingLinux.stdout}\n${missingLinux.stderr}`);
  assert.match(missingLinux.stderr, /release artifacts are missing platform\(s\): linux/);

  const linux = await writeAsset("linux", `OwnOrbit AI-${packageJson.version}.AppImage`, "latest-linux.yml", "linux bytes");
  await writeFile(path.join(releaseDir, "SHA256SUMS"), [
    `${mac.sha256}  ${mac.fileName}`,
    `${windows.sha256}  ${windows.fileName}`,
    `${linux.sha256}  ${linux.fileName}`,
    "",
  ].join("\n"));
  await writeFile(path.join(releaseDir, "update-feed", "release-manifest.json"), `${JSON.stringify({
    version: packageJson.version,
    generatedAt: new Date(0).toISOString(),
    artifacts: [mac, windows, linux],
  }, null, 2)}\n`);

  const complete = spawnSync(process.execPath, ["scripts/check-version-truth.mjs", "--require-assets"], {
    cwd: process.cwd(),
    env: {
      ...process.env,
      LIFEOS_RELEASE_DIR: releaseDir,
    },
    encoding: "utf8",
  });
  assert.equal(complete.status, 0, `${complete.stdout}\n${complete.stderr}`);
  assert.match(complete.stdout, /release artifacts cover macOS, Windows, and Linux/);
  assert.match(complete.stdout, /SHA256SUMS includes release artifact/);
});

test("version truth promotion rejects stale public repository and artifact facts", () => {
  const result = spawnSync(process.execPath, ["scripts/check-version-truth.mjs", "--promotion"], {
    cwd: process.cwd(),
    env: {
      ...process.env,
      LIFEOS_RELEASE_DIR: path.join(tmpdir(), "lifeos-version-truth-missing-promotion-assets"),
    },
    encoding: "utf8",
  });

  assert.notEqual(result.status, 0, `${result.stdout}\n${result.stderr}`);
  assert.match(result.stderr, /release promotion requires publicDockerRepository=ghcr\.io\/wgj-fry\/ownorbit-ai/);
  assert.match(result.stderr, /release promotion requires publicArtifacts to match sourceArtifacts/);
});
