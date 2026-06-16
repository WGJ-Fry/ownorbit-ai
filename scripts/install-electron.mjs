import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const version = process.env.npm_package_devDependencies_electron?.replace(/^[^\d]*/, "") || "42.3.3";
const platform = process.platform === "darwin" ? "darwin" : process.platform;
const arch = process.arch === "arm64" ? "arm64" : "x64";
const zipName = `electron-v${version}-${platform}-${arch}.zip`;
const mirror = process.env.ELECTRON_MIRROR || "https://npmmirror.com/mirrors/electron/";
const url = `${mirror.replace(/\/$/, "")}/${version}/${zipName}`;
const tmpDir = path.join(os.tmpdir(), `lifeos-electron-${version}-${platform}-${arch}`);
const zipPath = path.join(tmpDir, zipName);
const distPath = path.join(process.cwd(), "node_modules", "electron", "dist");
const pathFile = path.join(process.cwd(), "node_modules", "electron", "path.txt");
const executablePath = process.platform === "darwin"
  ? "Electron.app/Contents/MacOS/Electron"
  : process.platform === "win32"
    ? "electron.exe"
    : "electron";

function writeElectronPathFile() {
  fs.writeFileSync(pathFile, executablePath);
}

if (fs.existsSync(path.join(distPath, executablePath))) {
  writeElectronPathFile();
  console.log(`Electron ${version} binary already installed at ${distPath}`);
  process.exit(0);
}

fs.rmSync(tmpDir, { recursive: true, force: true });
fs.rmSync(distPath, { recursive: true, force: true });
fs.mkdirSync(tmpDir, { recursive: true });
fs.mkdirSync(distPath, { recursive: true });

console.log(`Downloading ${url}`);
const curl = spawnSync("curl", ["-L", "--fail", "--progress-bar", url, "-o", zipPath], { stdio: "inherit" });
if (curl.status !== 0) process.exit(curl.status || 1);

const unzip = spawnSync("unzip", ["-q", zipPath, "-d", distPath], { stdio: "inherit" });
if (unzip.status !== 0) process.exit(unzip.status || 1);

writeElectronPathFile();
console.log(`Electron ${version} binary installed at ${distPath}`);
