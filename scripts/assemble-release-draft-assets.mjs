import fs from "node:fs";
import path from "node:path";

const rootDir = process.cwd();
const inputDir = process.env.LIFEOS_RELEASE_ARTIFACTS_DIR
  ? path.resolve(process.env.LIFEOS_RELEASE_ARTIFACTS_DIR)
  : path.join(rootDir, "release-artifacts");
const outputDir = process.env.LIFEOS_RELEASE_DRAFT_DIR
  ? path.resolve(process.env.LIFEOS_RELEASE_DRAFT_DIR)
  : path.join(rootDir, "release-draft");
const packageJson = JSON.parse(fs.readFileSync(path.join(rootDir, "package.json"), "utf8"));
const packageVersion = packageJson.version;

function walk(dir) {
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const fullPath = path.join(dir, entry.name);
    return entry.isDirectory() ? walk(fullPath) : [fullPath];
  });
}

function copyUnique(file, targetName = path.basename(file)) {
  const target = path.join(outputDir, targetName);
  if (fs.existsSync(target)) {
    const current = fs.readFileSync(target);
    const next = fs.readFileSync(file);
    if (!current.equals(next)) {
      throw new Error(`Release draft asset name collision: ${targetName}`);
    }
    return target;
  }
  fs.copyFileSync(file, target);
  return target;
}

function readManifest(file) {
  const manifest = JSON.parse(fs.readFileSync(file, "utf8"));
  if (manifest.version !== packageVersion) {
    throw new Error(`Release manifest ${path.relative(rootDir, file)} is for ${manifest.version}, expected ${packageVersion}`);
  }
  if (!Array.isArray(manifest.artifacts)) {
    throw new Error(`Release manifest ${path.relative(rootDir, file)} is missing artifacts`);
  }
  return manifest;
}

const files = walk(inputDir);
if (files.length === 0) {
  console.error(`No release artifacts found in ${path.relative(rootDir, inputDir)}`);
  process.exit(1);
}

fs.rmSync(outputDir, { recursive: true, force: true });
fs.mkdirSync(outputDir, { recursive: true });

const packageAssets = files.filter((file) => /\.(dmg|zip|exe|AppImage)$/i.test(file));
const installGuides = files.filter((file) => ["USER-INSTALL.md", "INSTALL-unsigned-mac.md"].includes(path.basename(file)));
const feedFiles = files.filter((file) => /^latest.*\.yml$/.test(path.basename(file)));
const checksumFiles = files.filter((file) => path.basename(file) === "SHA256SUMS");
const manifestFiles = files.filter((file) => path.basename(file) === "release-manifest.json");

for (const file of [...packageAssets, ...installGuides, ...feedFiles]) {
  copyUnique(file);
}

const checksumLines = Array.from(new Set(checksumFiles.flatMap((file) => fs.readFileSync(file, "utf8")
  .split(/\r?\n/)
  .map((line) => line.trim())
  .filter(Boolean))));
if (checksumLines.length === 0) {
  throw new Error("No SHA256SUMS entries found in release artifacts");
}
fs.writeFileSync(path.join(outputDir, "SHA256SUMS"), `${checksumLines.join("\n")}\n`);

const manifests = manifestFiles.map(readManifest);
const artifacts = manifests.flatMap((manifest) => manifest.artifacts);
const seenArtifactKeys = new Set();
const uniqueArtifacts = [];
for (const artifact of artifacts) {
  const key = `${artifact.platform}:${artifact.fileName}`;
  if (seenArtifactKeys.has(key)) continue;
  seenArtifactKeys.add(key);
  uniqueArtifacts.push(artifact);
}
if (uniqueArtifacts.length === 0) {
  throw new Error("No release manifest artifacts found");
}

const requiredArtifactNames = new Set(uniqueArtifacts.map((artifact) => artifact.fileName));
for (const name of requiredArtifactNames) {
  if (!fs.existsSync(path.join(outputDir, name))) {
    throw new Error(`Release draft is missing manifest artifact: ${name}`);
  }
}

fs.writeFileSync(path.join(outputDir, "release-manifest.json"), `${JSON.stringify({
  version: packageVersion,
  generatedAt: new Date().toISOString(),
  artifacts: uniqueArtifacts,
}, null, 2)}\n`);

console.log(`Release draft assets assembled in ${path.relative(rootDir, outputDir)} (${uniqueArtifacts.length} artifact(s))`);
