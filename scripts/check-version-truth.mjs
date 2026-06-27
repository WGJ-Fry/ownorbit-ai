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
