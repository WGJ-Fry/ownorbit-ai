import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";

const rootDir = process.cwd();
const packageJson = JSON.parse(fs.readFileSync(path.join(rootDir, "package.json"), "utf8"));
const version = String(packageJson.version || "");
const publicVersion = version.includes("-") && version.endsWith(".0") ? version.slice(0, -2) : version;
const releaseTag = `v${publicVersion}`;
const nextPublicVersion = publicVersion.replace(/(\d+\.\d+\.)(\d+)(-.+)/, (_match, prefix, patch, suffix) => `${prefix}${Number(patch) + 1}${suffix}`);
const nextReleaseTag = `v${nextPublicVersion}`;
const dockerImage = `ghcr.io/wgj-fry/lifeos-ai:${releaseTag}`;
const macZip = `LifeOS.AI-${version}-arm64-unsigned.zip`;
const winInstaller = `LifeOS.AI.Setup.${version}.exe`;
const linuxAppImage = `LifeOS.AI-${version}.AppImage`;
const failures = [];
const passes = [];
const args = new Set(process.argv.slice(2));
const promotionMode = args.has("--promotion") || process.env.LIFEOS_RELEASE_PROMOTION === "1";
const requireReleaseAssets = promotionMode || args.has("--require-assets") || process.env.LIFEOS_REQUIRE_FULL_RELEASE_ARTIFACTS === "1";
const requireRemoteAcceptanceEvidence = promotionMode || args.has("--require-remote-acceptance") || process.env.LIFEOS_REQUIRE_REMOTE_ACCEPTANCE_EVIDENCE === "1";
const releaseDir = process.env.LIFEOS_RELEASE_DIR ? path.resolve(process.env.LIFEOS_RELEASE_DIR) : path.join(rootDir, "release");
const releaseFeedDir = path.join(releaseDir, "update-feed");
const remoteAcceptanceEvidencePath = process.env.LIFEOS_REMOTE_ACCEPTANCE_EVIDENCE
  ? path.resolve(process.env.LIFEOS_REMOTE_ACCEPTANCE_EVIDENCE)
  : path.join(releaseDir, "remote-acceptance-evidence.json");
const realWorldRemoteAcceptanceIds = ["restart-restore", "cellular-mobile-chat", "network-switch", "stale-qr-repair", "network-interruption", "diagnostic-export"];
const remoteAcceptanceMaxAgeMs = 7 * 24 * 60 * 60 * 1000;

function read(relativePath) {
  const fullPath = path.join(rootDir, relativePath);
  return fs.existsSync(fullPath) ? fs.readFileSync(fullPath, "utf8") : "";
}

function exists(relativePath) {
  return fs.existsSync(path.join(rootDir, relativePath));
}

function check(condition, passMessage, failMessage = passMessage) {
  if (condition) passes.push(passMessage);
  else failures.push(failMessage);
}

function git(argsForGit) {
  return spawnSync("git", argsForGit, {
    cwd: rootDir,
    encoding: "utf8",
  });
}

function trimmedStdout(result) {
  return String(result.stdout || "").trim();
}

function includesEvery(content, markers) {
  return markers.filter((marker) => !content.includes(marker));
}

function mentionedLifeosTags(content) {
  return Array.from(new Set(
    [...content.matchAll(/ghcr\.io\/wgj-fry\/lifeos-ai:(v\d+\.\d+\.\d+(?:-[a-z0-9.-]+)?)/gi)]
      .map((match) => match[1]),
  ));
}

function readJsonFile(file) {
  return JSON.parse(fs.readFileSync(file, "utf8"));
}

function checkReleaseAssetsReady() {
  const manifestPath = path.join(releaseFeedDir, "release-manifest.json");
  const checksumPath = path.join(releaseDir, "SHA256SUMS");
  check(fs.existsSync(manifestPath), "release artifact manifest exists", `missing release artifact manifest: ${path.relative(rootDir, manifestPath)}`);
  check(fs.existsSync(checksumPath), "release SHA256SUMS exists", `missing release SHA256SUMS: ${path.relative(rootDir, checksumPath)}`);
  if (!fs.existsSync(manifestPath) || !fs.existsSync(checksumPath)) return;

  let manifest;
  try {
    manifest = readJsonFile(manifestPath);
  } catch (error) {
    failures.push(`release artifact manifest is not valid JSON: ${error.message}`);
    return;
  }

  const checksums = fs.readFileSync(checksumPath, "utf8");
  const artifacts = Array.isArray(manifest.artifacts) ? manifest.artifacts : [];
  check(manifest.version === version, "release artifact manifest version matches package version", `release artifact manifest version must be ${version}, got ${manifest.version || "(missing)"}`);
  check(artifacts.length > 0, "release artifact manifest lists artifacts", "release artifact manifest must list artifacts");

  const requiredPlatforms = ["mac", "windows", "linux"];
  const presentPlatforms = new Set(artifacts.map((artifact) => artifact.platform));
  const missingPlatforms = requiredPlatforms.filter((platform) => !presentPlatforms.has(platform));
  check(missingPlatforms.length === 0, "release artifacts cover macOS, Windows, and Linux", `release artifacts are missing platform(s): ${missingPlatforms.join(", ")}`);

  for (const artifact of artifacts) {
    const fileName = String(artifact.fileName || "");
    const feedFile = String(artifact.feedFile || "");
    if (!fileName) {
      failures.push("release artifact manifest contains an artifact without fileName");
      continue;
    }
    const artifactPath = path.join(releaseDir, fileName);
    const feedPath = feedFile ? path.join(releaseFeedDir, feedFile) : "";
    check(fileName.includes(version), `release artifact name includes package version: ${fileName}`, `release artifact ${fileName} must include ${version}`);
    check(fs.existsSync(artifactPath), `release artifact exists: ${fileName}`, `missing release artifact: ${path.relative(rootDir, artifactPath)}`);
    if (feedFile) check(fs.existsSync(feedPath), `release feed exists: ${feedFile}`, `missing release feed: ${path.relative(rootDir, feedPath)}`);
    check(checksums.includes(`  ${fileName}`), `SHA256SUMS includes release artifact: ${fileName}`, `SHA256SUMS must include ${fileName}`);
  }
}

function remoteAcceptancePackFromEvidence(evidence) {
  return evidence?.remote?.acceptanceEvidencePack
    || evidence?.remoteAcceptanceEvidencePack
    || evidence?.acceptanceEvidencePack
    || evidence?.evidencePack
    || evidence;
}

function hasUsefulRemoteEvidenceText(item) {
  const text = String(item?.evidence || item?.proof || item?.note || "");
  return text.replace(/\s+/g, " ").trim().length >= 24;
}

function freshRemoteScenario(item, now = Date.now()) {
  const acceptedAt = Number(item?.acceptedAt || 0);
  const expiresAt = Number(item?.expiresAt || 0);
  return Number.isFinite(acceptedAt) &&
    Number.isFinite(expiresAt) &&
    acceptedAt > 0 &&
    expiresAt > now &&
    now - acceptedAt <= remoteAcceptanceMaxAgeMs;
}

function checkRemoteAcceptanceEvidenceReady() {
  check(
    fs.existsSync(remoteAcceptanceEvidencePath),
    "remote acceptance evidence file exists",
    `missing remote acceptance evidence file: ${path.relative(rootDir, remoteAcceptanceEvidencePath)}`,
  );
  if (!fs.existsSync(remoteAcceptanceEvidencePath)) return;

  let evidence;
  try {
    evidence = readJsonFile(remoteAcceptanceEvidencePath);
  } catch (error) {
    failures.push(`remote acceptance evidence is not valid JSON: ${error.message}`);
    return;
  }

  const pack = remoteAcceptancePackFromEvidence(evidence);
  const baseUrl = String(pack?.baseUrl || evidence?.network?.recommendedBaseUrl || evidence?.network?.publicBaseUrl || "");
  const scenarioMatrix = Array.isArray(pack?.scenarioMatrix) ? pack.scenarioMatrix : [];
  const coverage = Array.isArray(pack?.coverage) ? pack.coverage : [];
  const scenarioById = new Map(scenarioMatrix.map((item) => [item?.id, item]));
  const coverageById = new Map(coverage.map((item) => [item?.id, item]));
  const mergedScenarioById = new Map([...scenarioMatrix, ...coverage].map((item) => [item?.id, item]));
  const missingScenarioIds = realWorldRemoteAcceptanceIds.filter((id) => mergedScenarioById.get(id)?.status !== "passed");
  const missingCoverageIds = realWorldRemoteAcceptanceIds.filter((id) => coverageById.get(id)?.status !== "passed");
  const staleScenarioIds = realWorldRemoteAcceptanceIds.filter((id) => {
    const item = coverageById.get(id) || scenarioById.get(id);
    return item?.status === "passed" && !freshRemoteScenario(item);
  });
  const weakEvidenceIds = realWorldRemoteAcceptanceIds.filter((id) => {
    const item = coverageById.get(id) || scenarioById.get(id);
    return item?.status === "passed" && !hasUsefulRemoteEvidenceText(item);
  });

  check(pack?.ready === true, "remote acceptance evidence pack is ready", "remote acceptance evidence pack must have ready=true");
  check(pack?.longTermEntryReady === true, "remote acceptance long-term entry is ready", "remote acceptance evidence must include a long-term stable entry");
  check(pack?.automatedReady === true, "remote acceptance automated smoke is ready", "remote acceptance evidence must include passing automated smoke checks");
  check(pack?.realWorldReady === true, "remote acceptance real-world checks are ready", "remote acceptance evidence must include completed real-world checks");
  check(Number(pack?.realWorldPassed || 0) === realWorldRemoteAcceptanceIds.length, "remote acceptance evidence has all real-world scenarios counted", `remote acceptance evidence must count ${realWorldRemoteAcceptanceIds.length} real-world passes`);
  check(Number(pack?.realWorldTotal || 0) === realWorldRemoteAcceptanceIds.length, "remote acceptance evidence has expected real-world total", `remote acceptance evidence realWorldTotal must be ${realWorldRemoteAcceptanceIds.length}`);
  check(Number(pack?.missingCount || 0) === 0, "remote acceptance evidence has no missing real-world scenarios", `remote acceptance evidence has missing scenario count: ${pack?.missingCount}`);
  check(Number(pack?.expiredCount || 0) === 0, "remote acceptance evidence has no expired real-world scenarios", `remote acceptance evidence has expired scenario count: ${pack?.expiredCount}`);
  check(Array.isArray(pack?.missingRealWorldIds) && pack.missingRealWorldIds.length === 0, "remote acceptance evidence missing-id list is empty", "remote acceptance evidence missingRealWorldIds must be empty");
  check(Array.isArray(pack?.expiredRealWorldIds) && pack.expiredRealWorldIds.length === 0, "remote acceptance evidence expired-id list is empty", "remote acceptance evidence expiredRealWorldIds must be empty");
  check(missingScenarioIds.length === 0, "remote acceptance evidence covers all real-world scenarios", `remote acceptance evidence is missing passed scenario(s): ${missingScenarioIds.join(", ")}`);
  check(missingCoverageIds.length === 0, "remote acceptance coverage includes every real-world scenario", `remote acceptance coverage is missing passed scenario(s): ${missingCoverageIds.join(", ")}`);
  check(staleScenarioIds.length === 0, "remote acceptance evidence is fresh", `remote acceptance evidence is stale or missing acceptedAt/expiresAt for: ${staleScenarioIds.join(", ")}`);
  check(weakEvidenceIds.length === 0, "remote acceptance evidence has proof text for every scenario", `remote acceptance evidence has weak or missing proof text for: ${weakEvidenceIds.join(", ")}`);
  check(
    !/(github_pat_|ghp_|sk-[A-Za-z0-9_-]{12,}|AIza[0-9A-Za-z_-]{20,}|token=secret|secret=hidden|\/Users\/[^/\s]+)/.test(JSON.stringify(pack)),
    "remote acceptance evidence is redacted",
    "remote acceptance evidence must not contain token-shaped secrets, unredacted token markers, or local private paths",
  );

  try {
    const parsed = new URL(baseUrl);
    const host = parsed.hostname.toLowerCase();
    check(parsed.protocol === "https:", "remote acceptance base URL uses HTTPS", `remote acceptance base URL must use HTTPS: ${baseUrl || "(missing)"}`);
    check(!parsed.username && !parsed.password && !parsed.search && !parsed.hash, "remote acceptance base URL has no secrets", "remote acceptance base URL must not include username, password, query, or fragment");
    check(!["localhost", "127.0.0.1", "::1"].includes(host), "remote acceptance base URL is not localhost", "remote acceptance evidence must use a real remote URL, not localhost");
    check(!host.endsWith(".trycloudflare.com"), "remote acceptance base URL is not a temporary trycloudflare tunnel", "remote acceptance evidence must use a stable tunnel or Tailscale HTTPS entry, not a temporary trycloudflare.com URL");
  } catch {
    failures.push(`remote acceptance evidence has an invalid base URL: ${baseUrl || "(missing)"}`);
  }
}

const readme = read("README.md");
const readmeZh = read("README.zh-CN.md");
const compose = read("docker-compose.yml");
const userInstall = read("docs/user-install-guide.md");
const roadmap = read("docs/version-roadmap.md");
const releaseNotesPath = `docs/release-notes-${releaseTag}.md`;
const releaseNotes = read(releaseNotesPath);

check(/^0\.\d+\.\d+-alpha\.0$/.test(version), "package version uses the alpha package format", `package version should use 0.x.y-alpha.0 while this channel is alpha, got ${version}`);
check(exists(releaseNotesPath), "release notes exist for the derived public tag", `missing ${releaseNotesPath}`);
check(Boolean(readme), "English README exists");
check(Boolean(readmeZh), "Chinese README exists");
check(Boolean(compose), "docker-compose.yml exists");
check(Boolean(userInstall), "user install guide exists");
check(Boolean(roadmap), "version roadmap exists", "docs/version-roadmap.md is required so users can distinguish shipped, next, and future capabilities");

for (const [label, content] of [
  ["README.md", readme],
  ["README.zh-CN.md", readmeZh],
  ["docs/user-install-guide.md", userInstall],
  [releaseNotesPath, releaseNotes],
]) {
  if (!content) continue;
  const missing = includesEvery(content, [releaseTag, version, dockerImage, macZip, winInstaller, linuxAppImage]);
  check(missing.length === 0, `${label} uses the current public version, image, and asset names`, `${label} is missing current version markers: ${missing.join(", ")}`);
  const tags = mentionedLifeosTags(content);
  const staleTags = tags.filter((tag) => tag !== releaseTag);
  check(staleTags.length === 0, `${label} does not point Docker users at stale image tags`, `${label} mentions stale GHCR tag(s): ${staleTags.join(", ")}`);
}

check(compose.includes(`image: ${dockerImage}`), "docker-compose image matches the package-derived release tag", `docker-compose.yml must use image: ${dockerImage}`);
check(mentionedLifeosTags(compose).every((tag) => tag === releaseTag), "docker-compose does not contain stale LifeOS image tags");

const requiredEnglishLimits = [
  "Automatic updates are not enabled",
  "macOS Developer ID signing/notarization",
  "Windows Authenticode signing",
  "Apple Calendar, Google Calendar, and system reminders",
  "`.ics` support is read-only",
  "Studio generated programs remain alpha",
  "Local actions are still URL Scheme",
  "long-term remote stability still needs real-device evidence",
];
const requiredChineseLimits = [
  "默认不启用自动更新",
  "macOS Developer ID 签名/公证",
  "Windows Authenticode 签名",
  "Apple Calendar、Google Calendar、系统提醒事项",
  "`.ics` 只是本地只读读取",
  "Studio 生成程序仍是 alpha",
  "本地动作仍基于 URL Scheme",
  "长期稳定性仍需要用户自己完成真实设备长测",
];
const missingEnglishLimits = includesEvery(readme, requiredEnglishLimits);
const missingChineseLimits = includesEvery(readmeZh, requiredChineseLimits);
const missingReleaseLimits = includesEvery(releaseNotes, [
  "Automatic updates are not enabled",
  "Apple Calendar, Google Calendar, Google Tasks, and system reminders",
  "calendar:acceptance",
  "Remote diagnostics can verify configuration, but long-term remote stability still needs real-device evidence",
  "默认不启用自动更新",
  "Apple Calendar、Google Calendar、Google Tasks、系统提醒事项",
  "calendar:acceptance",
  "长期稳定性仍需要用户自己完成真实设备长测",
]);

check(missingEnglishLimits.length === 0, "English README keeps the current alpha limits visible", `README.md is missing current-limit markers: ${missingEnglishLimits.join(", ")}`);
check(missingChineseLimits.length === 0, "Chinese README keeps the current alpha limits visible", `README.zh-CN.md is missing current-limit markers: ${missingChineseLimits.join(", ")}`);
check(missingReleaseLimits.length === 0, "release notes keep the current alpha limits visible", `${releaseNotesPath} is missing current-limit markers: ${missingReleaseLimits.join(", ")}`);

const requiredRoadmapMarkers = [
  releaseTag,
  nextReleaseTag,
  "Shipped in the Current Public Release",
  "Next Planned Alpha",
  "Not Shipped Yet",
  "Unsigned desktop packages",
  "Manual update",
  "Real-device remote acceptance",
  "Calendar and tasks",
  "Studio generated programs",
  "Mobile offline queue",
  "Native automation",
  "Release hygiene",
];
const missingRoadmapMarkers = includesEvery(roadmap, requiredRoadmapMarkers);
check(missingRoadmapMarkers.length === 0, "version roadmap separates shipped, next, and future work", `docs/version-roadmap.md is missing roadmap markers: ${missingRoadmapMarkers.join(", ")}`);

check(
  readme.includes("source-only changes") &&
    readmeZh.includes("源码改动"),
  "README files warn that main can be ahead of public downloads",
  "README files must warn that main can contain source-only changes after the tagged public release",
);

check(
  userInstall.includes("Only claim assets that already exist and can be downloaded from a clean machine") &&
    userInstall.includes("只写已经存在并能被干净机器下载的资产"),
  "install guide keeps the no-overclaim release rule",
  "docs/user-install-guide.md must keep the no-overclaim release rule in both languages",
);

if (requireReleaseAssets) {
  checkReleaseAssetsReady();
} else {
  check(true, "full release asset guard is available; run with --require-assets or --promotion before public upload");
}

if (requireRemoteAcceptanceEvidence) {
  checkRemoteAcceptanceEvidenceReady();
} else {
  check(true, "remote acceptance evidence guard is available; run with --require-remote-acceptance or --promotion before public upload");
}

if (promotionMode) {
  const status = git(["status", "--porcelain"]);
  check(status.status === 0, "release promotion can read git status", `git status failed: ${status.stderr || status.stdout}`);
  check(
    status.status === 0 && trimmedStdout(status) === "",
    "release promotion worktree is clean",
    "release promotion requires a clean worktree before tagging or uploading assets",
  );

  const head = git(["rev-parse", "HEAD"]);
  check(head.status === 0, "release promotion can read HEAD", `git rev-parse HEAD failed: ${head.stderr || head.stdout}`);

  const tagCommit = git(["rev-list", "-n", "1", releaseTag]);
  check(
    tagCommit.status === 0,
    `release promotion tag exists: ${releaseTag}`,
    `release promotion tag is missing: ${releaseTag}`,
  );

  if (head.status === 0 && tagCommit.status === 0) {
    check(
      trimmedStdout(head) === trimmedStdout(tagCommit),
      `release promotion tag ${releaseTag} points at HEAD`,
      `release promotion tag ${releaseTag} must point at HEAD; create a new tag instead of moving an older public tag`,
    );
  }

  const originMain = git(["rev-parse", "--verify", "origin/main"]);
  if (originMain.status === 0 && head.status === 0) {
    check(
      trimmedStdout(originMain) === trimmedStdout(head),
      "release promotion HEAD matches origin/main",
      "release promotion should push main first so origin/main matches the commit being tagged",
    );
  } else {
    check(true, "release promotion skipped origin/main comparison because no remote tracking ref is available");
  }
} else {
  check(true, "release promotion guard is available; run npm run version:truth:release before public upload");
}

for (const message of passes) console.log(`[PASS] ${message}`);
for (const message of failures) console.error(`[FAIL] ${message}`);

if (failures.length) {
  console.error(`Version truth check failed: ${failures.length} issue(s).`);
  process.exit(1);
}

console.log(`Version truth passed for ${releaseTag}.`);
