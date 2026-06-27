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
  assert.match(result.stdout, /English README keeps the current alpha limits visible/);
  assert.match(result.stdout, /Chinese README keeps the current alpha limits visible/);
  assert.match(result.stdout, /version roadmap separates shipped, next, and future work/);
  assert.match(result.stdout, /release promotion guard is available/);
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
  const mac = await writeAsset("mac", `LifeOS AI-${packageJson.version}-arm64-unsigned.zip`, "latest-mac.yml", "mac bytes");
  const windows = await writeAsset("windows", `LifeOS AI Setup ${packageJson.version}.exe`, "latest.yml", "windows bytes");
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

  const linux = await writeAsset("linux", `LifeOS AI-${packageJson.version}.AppImage`, "latest-linux.yml", "linux bytes");
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
