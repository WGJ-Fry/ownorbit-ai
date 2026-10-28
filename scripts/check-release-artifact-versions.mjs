import fs from "node:fs";
import path from "node:path";
import { currentSourceCommit, releaseProvenanceFailures } from "./release-provenance.mjs";

const rootDir = process.cwd();
const packageJson = JSON.parse(fs.readFileSync(path.join(rootDir, "package.json"), "utf8"));
const releaseDir = process.env.LIFEOS_RELEASE_DIR ? path.resolve(process.env.LIFEOS_RELEASE_DIR) : path.join(rootDir, "release");
const fix = process.argv.includes("--fix");
const artifactPattern = /\.(dmg|zip|exe|AppImage|blockmap)$/i;
const packageVersionCore = String(packageJson.version).match(/\d+\.\d+\.\d+/)?.[0] || packageJson.version;

function walk(dir) {
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const fullPath = path.join(dir, entry.name);
    return entry.isDirectory() ? walk(fullPath) : [fullPath];
  });
}

function versionMismatches(file) {
  const name = path.basename(file);
  if (name.includes(packageJson.version)) return [];
  return [...name.matchAll(/\b(\d+\.\d+\.\d+)\b/g)]
    .map((match) => match[1])
    .filter((version) => version !== packageVersionCore || packageJson.version !== packageVersionCore);
}

function metadataVersionMismatches(file) {
  const content = fs.readFileSync(file, "utf8");
  const scanContent = content.split(packageJson.version).join("");
  return [...scanContent.matchAll(/\b(\d+\.\d+\.\d+)\b/g)]
    .map((match) => match[1])
    .filter((version) => version !== packageVersionCore || packageJson.version !== packageVersionCore);
}

function isReleaseMetadata(file) {
  const name = path.basename(file);
  const parent = path.basename(path.dirname(file));
  return name === "SHA256SUMS" || (parent === "update-feed" && (/^latest.*\.yml$/.test(name) || name === "release-manifest.json"));
}

const artifacts = walk(releaseDir).filter((file) => artifactPattern.test(file));
const metadata = walk(releaseDir).filter(isReleaseMetadata);
const staleArtifacts = artifacts
  .map((file) => ({ file, mismatches: versionMismatches(file), kind: "artifact" }))
  .filter((item) => item.mismatches.length > 0);
const staleMetadata = metadata
  .map((file) => ({ file, mismatches: metadataVersionMismatches(file), kind: "metadata" }))
  .filter((item) => item.mismatches.length > 0);
const stale = [...staleArtifacts, ...staleMetadata];
const manifestPath = path.join(releaseDir, "update-feed", "release-manifest.json");
const topLevelArtifacts = fs.existsSync(releaseDir)
  ? fs.readdirSync(releaseDir, { withFileTypes: true })
    .filter((entry) => entry.isFile() && /\.(dmg|zip|exe|AppImage)$/i.test(entry.name))
  : [];
const provenanceFailures = [];

if (topLevelArtifacts.length > 0 && !fs.existsSync(manifestPath)) {
  provenanceFailures.push("release artifacts exist but update-feed/release-manifest.json is missing");
} else if (fs.existsSync(manifestPath)) {
  try {
    const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
    provenanceFailures.push(...releaseProvenanceFailures(manifest.source, {
      expectedCommit: currentSourceCommit(rootDir),
      requireClean: true,
    }));
  } catch (error) {
    provenanceFailures.push(`release manifest is not valid JSON: ${error.message}`);
  }
}

if (stale.length === 0 && provenanceFailures.length === 0) {
  console.log(`Release artifact versions and source provenance are clean for ${packageJson.version}.`);
  process.exit(0);
}

if (stale.length > 0) {
  console.error(`Release artifacts do not match package version ${packageJson.version}:`);
  for (const item of stale) {
    console.error(`- ${path.relative(rootDir, item.file)} (${item.kind}) contains ${item.mismatches.join(", ")}`);
  }
}
if (provenanceFailures.length > 0) {
  console.error("Release artifact source provenance is not safe:");
  for (const failure of provenanceFailures) console.error(`- ${failure}`);
}

if (!fix) {
  console.error("Rebuild every release package from a clean commit. Use --fix only to remove version-mismatched files.");
  process.exit(1);
}

for (const item of stale) {
  fs.rmSync(item.file, { force: true });
  console.log(`Deleted ${path.relative(rootDir, item.file)}`);
}

if (provenanceFailures.length > 0) {
  console.error("Source provenance cannot be repaired in place; rebuild every release package from a clean commit.");
  process.exit(1);
}
