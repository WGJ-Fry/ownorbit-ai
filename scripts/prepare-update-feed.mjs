import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

const rootDir = process.cwd();
const releaseDir = process.env.LIFEOS_RELEASE_DIR ? path.resolve(process.env.LIFEOS_RELEASE_DIR) : path.join(rootDir, "release");
const feedDir = path.join(releaseDir, "update-feed");
const packageJson = JSON.parse(fs.readFileSync(path.join(rootDir, "package.json"), "utf8"));

function walk(dir) {
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const fullPath = path.join(dir, entry.name);
    if (fullPath.startsWith(feedDir)) return [];
    return entry.isDirectory() ? walk(fullPath) : [fullPath];
  });
}

function sha512(file) {
  return crypto.createHash("sha512").update(fs.readFileSync(file)).digest("base64");
}

function sha256(file) {
  return crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex");
}

function yamlString(value) {
  return JSON.stringify(value);
}

function writeFeed(fileName, artifact, platform) {
  const stat = fs.statSync(artifact);
  const outputName = path.basename(artifact);
  fs.copyFileSync(artifact, path.join(feedDir, outputName));
  const hash = sha512(artifact);
  const hash256 = sha256(artifact);
  const content = [
    `version: ${yamlString(packageJson.version)}`,
    "files:",
    `  - url: ${yamlString(outputName)}`,
    `    sha512: ${yamlString(hash)}`,
    `    size: ${stat.size}`,
    `path: ${yamlString(outputName)}`,
    `sha512: ${yamlString(hash)}`,
    `releaseDate: ${yamlString(new Date(stat.mtimeMs).toISOString())}`,
    "",
  ].join("\n");
  fs.writeFileSync(path.join(feedDir, fileName), content);
  return {
    platform,
    feedFile: fileName,
    fileName: outputName,
    size: stat.size,
    sha512: hash,
    sha256: hash256,
    releaseDate: new Date(stat.mtimeMs).toISOString(),
  };
}

const artifacts = walk(releaseDir).filter((file) => /\.(dmg|zip|exe|AppImage)$/i.test(file));
if (artifacts.length === 0) {
  console.error("No release artifacts found. Run npm run desktop:dist before npm run release:feed.");
  process.exit(1);
}

fs.rmSync(feedDir, { recursive: true, force: true });
fs.mkdirSync(feedDir, { recursive: true });

const macArtifact = artifacts.find((file) => file.endsWith(".dmg")) || artifacts.find((file) => /mac|darwin|unsigned/i.test(file) && file.endsWith(".zip"));
const winArtifact = artifacts.find((file) => file.endsWith(".exe"));
const linuxArtifact = artifacts.find((file) => file.endsWith(".AppImage"));

const manifest = {
  version: packageJson.version,
  generatedAt: new Date().toISOString(),
  artifacts: [],
};

if (macArtifact) manifest.artifacts.push(writeFeed("latest-mac.yml", macArtifact, "mac"));
if (winArtifact) manifest.artifacts.push(writeFeed("latest.yml", winArtifact, "windows"));
if (linuxArtifact) manifest.artifacts.push(writeFeed("latest-linux.yml", linuxArtifact, "linux"));

if (manifest.artifacts.length === 0) {
  console.error("No supported release artifacts found. Expected .dmg, unsigned mac .zip, .exe, or .AppImage.");
  process.exit(1);
}

fs.writeFileSync(path.join(feedDir, "release-manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`);
fs.writeFileSync(
  path.join(releaseDir, "SHA256SUMS"),
  `${manifest.artifacts
    .map((artifact) => `${artifact.sha256}  ${artifact.fileName}`)
    .join("\n")}\n`,
);

console.log(`Update feed written to ${path.relative(rootDir, feedDir)}`);
