import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

const rootDir = process.cwd();
const packageJson = JSON.parse(fs.readFileSync(path.join(rootDir, "package.json"), "utf8"));
const releaseDir = path.join(rootDir, "release");
const arch = process.env.npm_config_arch || process.arch;
const productName = packageJson.build?.productName || "OwnOrbit AI";
const appPath = path.join(releaseDir, `mac-${arch}`, `${productName}.app`);
const rootAppPath = path.join(releaseDir, `${productName}.app`);
const outputPath = path.join(releaseDir, `${productName}-${packageJson.version}-${arch}-unsigned.zip`);
const installGuidePath = path.join(releaseDir, "INSTALL-unsigned-mac.md");
const userInstallGuideSource = path.join(rootDir, "docs", "user-install-guide.md");
const userInstallGuidePath = path.join(releaseDir, "USER-INSTALL.md");

if (process.platform !== "darwin") {
  console.error("Unsigned macOS zip packaging must run on macOS.");
  process.exit(1);
}

if (!fs.existsSync(appPath)) {
  console.error(`Missing packaged app: ${appPath}`);
  console.error("Run npm run desktop:pack:unsigned first.");
  process.exit(1);
}

fs.rmSync(outputPath, { force: true });

const verifyResult = spawnSync("codesign", ["--verify", "--deep", "--strict", "--verbose=2", appPath], {
  cwd: releaseDir,
  encoding: "utf8",
});

if (verifyResult.status !== 0) {
  console.error(verifyResult.stdout);
  console.error(verifyResult.stderr);
  process.exit(verifyResult.status || 1);
}

const result = spawnSync("ditto", ["-c", "-k", "--sequesterRsrc", "--keepParent", appPath, outputPath], {
  cwd: releaseDir,
  encoding: "utf8",
});

if (result.status !== 0) {
  console.error(result.stdout);
  console.error(result.stderr);
  process.exit(result.status || 1);
}

if (path.resolve(rootAppPath) !== path.resolve(appPath)) {
  fs.rmSync(rootAppPath, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
  const syncResult = spawnSync("ditto", [appPath, rootAppPath], {
    cwd: releaseDir,
    encoding: "utf8",
  });
  if (syncResult.status !== 0) {
    console.error(syncResult.stdout);
    console.error(syncResult.stderr);
    process.exit(syncResult.status || 1);
  }
}

fs.writeFileSync(installGuidePath, `# OwnOrbit AI unsigned macOS install

Version: ${packageJson.version}
Artifact: ${path.basename(outputPath)}

## Install

1. Unzip ${path.basename(outputPath)}.
2. Move \`${packageJson.build?.productName || "OwnOrbit AI"}.app\` to Applications.
3. Open the app from Finder.
4. If macOS says the app cannot be opened because it is from an unidentified developer, open System Settings > Privacy & Security and choose Open Anyway, or right-click the app and choose Open.
5. On first launch, set the admin password, configure an AI provider, create a backup, enable daily automatic backups, and bind the mobile PWA.

## Data and recovery

- App data is stored in the macOS user data folder for ${packageJson.build?.productName || "OwnOrbit AI"}.
- Use Admin Settings to create backups before upgrading, and keep daily automatic backups enabled for long-term use.
- Use Export Diagnostics from the app menu if startup or binding fails.

## Updates

This unsigned build does not require LIFEOS_UPDATE_URL. Manual updates are done by downloading a newer zip and replacing the app. Keep your SQLite backups before replacing the app.
`);

if (fs.existsSync(userInstallGuideSource)) {
  fs.copyFileSync(userInstallGuideSource, userInstallGuidePath);
} else {
  console.warn("User install guide was not found at docs/user-install-guide.md");
}

console.log(`Unsigned macOS zip written to ${path.relative(rootDir, outputPath)}`);
console.log(`Unsigned macOS app ad-hoc signature verified: ${path.relative(rootDir, appPath)}`);
if (path.resolve(rootAppPath) !== path.resolve(appPath)) {
  console.log(`Local launch app refreshed: ${path.relative(rootDir, rootAppPath)}`);
}
console.log(`Unsigned macOS install guide written to ${path.relative(rootDir, installGuidePath)}`);
if (fs.existsSync(userInstallGuidePath)) {
  console.log(`User install guide written to ${path.relative(rootDir, userInstallGuidePath)}`);
}
