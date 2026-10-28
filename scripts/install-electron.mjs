import { spawnSync } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const rootDir = process.cwd();
const packageJson = JSON.parse(fs.readFileSync(path.join(rootDir, "package.json"), "utf8"));
const configuredElectron = String(packageJson.devDependencies?.electron || "").trim();
const configuredVersion = configuredElectron.match(/\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?/)?.[0] || "";
const version = String(process.env.LIFEOS_ELECTRON_VERSION || configuredVersion).trim();
if (!/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(version)) {
  console.error("A concrete Electron version is required in package.json or LIFEOS_ELECTRON_VERSION.");
  process.exit(2);
}
const platform = process.platform === "darwin" ? "darwin" : process.platform;
const arch = process.arch === "arm64" ? "arm64" : "x64";
const zipName = `electron-v${version}-${platform}-${arch}.zip`;
const mirror = process.env.ELECTRON_MIRROR || "https://npmmirror.com/mirrors/electron/";
const url = `${mirror.replace(/\/$/, "")}/${version}/${zipName}`;
const tmpDir = path.join(os.tmpdir(), `lifeos-electron-${version}-${platform}-${arch}`);
const zipPath = path.join(tmpDir, zipName);
const distPath = path.join(rootDir, "node_modules", "electron", "dist");
const pathFile = path.join(rootDir, "node_modules", "electron", "path.txt");
const executablePath = process.platform === "darwin"
  ? "Electron.app/Contents/MacOS/Electron"
  : process.platform === "win32"
    ? "electron.exe"
    : "electron";
const electronPackageDir = path.join(rootDir, "node_modules", "electron");
const electronPackageJson = JSON.parse(fs.readFileSync(path.join(electronPackageDir, "package.json"), "utf8"));
const checksums = JSON.parse(fs.readFileSync(path.join(electronPackageDir, "checksums.json"), "utf8"));
const expectedChecksum = String(checksums[zipName] || "").toLowerCase();

if (electronPackageJson.version !== version || !/^[a-f0-9]{64}$/.test(expectedChecksum)) {
  console.error(`Electron ${version} is not covered by the checksum manifest from the locked electron package.`);
  process.exit(2);
}

function writeElectronPathFile() {
  fs.writeFileSync(pathFile, executablePath);
}

function installedVersionMatches() {
  try {
    const distVersion = fs.readFileSync(path.join(distPath, "version"), "utf8").trim().replace(/^v/, "");
    if (distVersion !== version || !fs.existsSync(path.join(distPath, executablePath))) return false;
    const runtime = spawnSync(path.join(distPath, executablePath), ["--version"], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
      timeout: 10_000,
    });
    return runtime.status === 0 && `${runtime.stdout || ""}${runtime.stderr || ""}`.trim().replace(/^v/, "") === version;
  } catch {
    return false;
  }
}

if (installedVersionMatches()) {
  writeElectronPathFile();
  console.log(`Electron ${version} binary and runtime version verified at ${distPath}`);
  process.exit(0);
}

fs.rmSync(tmpDir, { recursive: true, force: true });
fs.mkdirSync(tmpDir, { recursive: true });

console.log(`Downloading ${url}`);
const curl = spawnSync("curl", ["-L", "--fail", "--progress-bar", url, "-o", zipPath], { stdio: "inherit" });
if (curl.status !== 0) process.exit(curl.status || 1);

const actualChecksum = crypto.createHash("sha256").update(fs.readFileSync(zipPath)).digest("hex");
if (actualChecksum !== expectedChecksum) {
  fs.rmSync(zipPath, { force: true });
  console.error(`Electron archive checksum mismatch for ${zipName}.`);
  process.exit(1);
}
console.log(`Verified Electron archive SHA256 against node_modules/electron/checksums.json`);

fs.rmSync(distPath, { recursive: true, force: true });
fs.mkdirSync(distPath, { recursive: true });

const unzip = spawnSync("unzip", ["-q", zipPath, "-d", distPath], { stdio: "inherit" });
if (unzip.status !== 0) process.exit(unzip.status || 1);

if (!installedVersionMatches()) {
  console.error(`Installed Electron runtime does not report v${version}.`);
  process.exit(1);
}

writeElectronPathFile();
console.log(`Electron ${version} binary installed at ${distPath}`);
