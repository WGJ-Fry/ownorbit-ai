import fs from "node:fs";

const owner = "WGJ-Fry";
const repo = "lifeos-ai";
const baseUrl = process.env.LIFEOS_GITHUB_API_BASE_URL || `https://api.github.com/repos/${owner}/${repo}`;
const packageJson = JSON.parse(fs.readFileSync("package.json", "utf8"));
const currentPublicVersion = packageJson.version.includes("-") && packageJson.version.endsWith(".0")
  ? packageJson.version.slice(0, -2)
  : packageJson.version;
const currentTag = `v${currentPublicVersion}`;
const publicMacZipName = `LifeOS.AI-${packageJson.version}-arm64-unsigned.zip`;
const publicWinInstallerName = `LifeOS.AI.Setup.${packageJson.version}.exe`;
const publicLinuxAppImageName = `LifeOS.AI-${packageJson.version}.AppImage`;
const oldStableTag = "v0.1.0";
const deprecatedTag = "v0.0.0";
const desiredDescription =
  "Open-source, self-hosted, local-first personal AI assistant and private second brain with memory, mobile access, and generated problem-solving tools.";
const desiredTopics = [
  "ai",
  "ai-agent",
  "ai-assistant",
  "personal-ai",
  "personal-assistant",
  "local-ai",
  "local-first",
  "self-hosted",
  "self-hosted-ai",
  "privacy",
  "second-brain",
  "knowledge-management",
  "personal-knowledge-management",
  "life-os",
  "productivity",
  "llm",
  "ollama",
  "electron",
  "pwa",
  "remote-access",
];
const args = new Set(process.argv.slice(2));
const shouldFix = args.has("--fix");
const token = process.env.GITHUB_TOKEN || process.env.GH_TOKEN || "";
const checks = [];

function parseReleaseTag(tag) {
  const match = String(tag || "").match(/^v(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?$/);
  if (!match) return null;
  return {
    major: Number(match[1]),
    minor: Number(match[2]),
    patch: Number(match[3]),
    prerelease: match[4] || "",
  };
}

function compareReleaseTags(leftTag, rightTag) {
  const left = parseReleaseTag(leftTag);
  const right = parseReleaseTag(rightTag);
  if (!left || !right) return 0;
  for (const key of ["major", "minor", "patch"]) {
    if (left[key] !== right[key]) return left[key] - right[key];
  }
  if (left.prerelease === right.prerelease) return 0;
  if (!left.prerelease) return 1;
  if (!right.prerelease) return -1;
  return left.prerelease.localeCompare(right.prerelease);
}

function isOlderReleaseTag(tag) {
  return Boolean(parseReleaseTag(tag)) && compareReleaseTags(tag, currentTag) < 0;
}

function record(ok, message, detail = "") {
  checks.push({ ok, message, detail });
}

function headers(extra = {}) {
  return {
    Accept: "application/vnd.github+json",
    "X-GitHub-Api-Version": "2022-11-28",
    "User-Agent": "lifeos-public-github-state",
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
    ...extra,
  };
}

async function requestJson(url, options = {}) {
  const response = await fetch(url, {
    ...options,
    headers: headers(options.headers || {}),
  });
  const text = await response.text();
  const body = text ? JSON.parse(text) : {};
  if (!response.ok) {
    const message = body?.message || text || `HTTP ${response.status}`;
    const error = new Error(message);
    error.status = response.status;
    error.body = body;
    throw error;
  }
  return body;
}

async function patchJson(url, body) {
  return requestJson(url, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

async function putJson(url, body) {
  return requestJson(url, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

async function safePatch(label, url, body) {
  if (!shouldFix) return null;
  if (!token) {
    record(false, `${label} needs --fix token`, "Set GITHUB_TOKEN to apply this change.");
    return null;
  }
  try {
    const result = await patchJson(url, body);
    record(true, `${label} updated`);
    return result;
  } catch (error) {
    record(false, `${label} update failed`, `${error.status || ""} ${error.message}`.trim());
    return null;
  }
}

async function safePut(label, url, body) {
  if (!shouldFix) return null;
  if (!token) {
    record(false, `${label} needs --fix token`, "Set GITHUB_TOKEN to apply this change.");
    return null;
  }
  try {
    const result = await putJson(url, body);
    record(true, `${label} updated`);
    return result;
  } catch (error) {
    record(false, `${label} update failed`, `${error.status || ""} ${error.message}`.trim());
    return null;
  }
}

function releaseBody() {
  return `## LifeOS AI ${currentTag}

LifeOS AI turns your desktop into a private AI core and your phone into a paired personal AI companion.

### What this public alpha includes

- Docker Compose quickstart with Ollama and local Markdown notes.
- macOS Apple Silicon unsigned ZIP.
- Windows x64 NSIS installer.
- Linux x64 AppImage.
- Desktop admin setup, AI provider settings, backup/restore, diagnostics, and device pairing.
- Mobile PWA chat, offline queue, device status, and action permissions.
- LAN, Tailscale, and Cloudflare Tunnel connection diagnostics with public-exposure warnings.
- Studio generated problem-solving programs with template matching, runtime logs, state storage, debug instructions, repair guidance, and rollback.

### Downloads

- macOS Apple Silicon unsigned ZIP: \`${publicMacZipName}\`
- Windows x64 NSIS installer: \`${publicWinInstallerName}\`
- Linux x64 AppImage: \`${publicLinuxAppImageName}\`
- Checksum: \`SHA256SUMS\`
- Install guide: \`USER-INSTALL.md\`
- macOS unsigned fallback guide: \`INSTALL-unsigned-mac.md\`

### Install

macOS: download the unsigned ZIP, unzip it, drag \`LifeOS AI.app\` to Applications, then follow \`INSTALL-unsigned-mac.md\` if Gatekeeper blocks the first launch.

Windows: download the NSIS \`.exe\` and follow the SmartScreen guidance in \`USER-INSTALL.md\`.

Linux: download the AppImage, run \`chmod +x "${publicLinuxAppImageName}"\`, then launch it.

### Verification

GitHub asset URLs use dot-separated filenames. The uploaded \`SHA256SUMS\` file may list the original electron-builder filenames with spaces; compare the hash value if your downloaded filename differs.

\`\`\`text
Use the SHA256SUMS generated for the current ${currentTag} Release draft.
Do not reuse hashes from v0.1.2-alpha or earlier releases.
\`\`\`

### Notes

- This is an alpha release. Start with Docker Compose if you want the fastest demo.
- macOS is unsigned and may require the Open Anyway flow.
- Windows is not Authenticode signed yet, so SmartScreen may warn about an unknown publisher.
- Linux AppImage is unsigned; verify \`SHA256SUMS\` before first launch.
- Auto-update is not enabled yet.
- Do not expose the local core directly to the public internet. Use admin auth plus a private VPN or carefully configured HTTPS tunnel.

---

## 中文说明

LifeOS AI 把电脑端变成私有 AI 核心，把手机端变成扫码绑定后的随身 AI 助手。

当前公开 alpha 包含 Docker Compose + Ollama 本地 Markdown 演示、macOS unsigned ZIP、Windows NSIS 安装包、Linux AppImage、电脑端管理、手机 PWA、备份恢复、连接诊断和 Studio 自动生成解决问题的程序。

注意：macOS/Windows 当前仍是未正式签名的 alpha 测试包。请只从本 Release 下载，并在首次启动前校验 \`SHA256SUMS\`。不要把本地核心直接暴露到公网。`;
}

function deprecatedBody(existingBody = "") {
  const warning = `> [!WARNING]
> Deprecated / 已废弃
>
> This early release is kept only for historical reference. New users should use [LifeOS AI ${currentTag}](https://github.com/${owner}/${repo}/releases/tag/${currentTag}).
>
> 这个早期版本仅保留作历史记录。新用户请使用 [LifeOS AI ${currentTag}](https://github.com/${owner}/${repo}/releases/tag/${currentTag})。
`;
  if (existingBody.includes("Deprecated / 已废弃")) return existingBody;
  return `${warning}\n---\n\n${existingBody}`.trim();
}

function hasAsset(release, name) {
  return (release.assets || []).some((asset) => asset.name === name);
}

async function main() {
  let repository;
  try {
    repository = await requestJson(baseUrl);
  } catch (error) {
    console.error(`[FAIL] cannot read repository: ${error.message}`);
    process.exit(1);
  }

  if (repository.description === desiredDescription) {
    record(true, "repository description is launch-ready");
  } else {
    record(false, "repository description needs update", `current=${JSON.stringify(repository.description)}`);
    await safePatch("repository description", baseUrl, { description: desiredDescription });
  }

  if (repository.has_discussions === true) {
    record(true, "GitHub Discussions are enabled");
  } else {
    record(false, "GitHub Discussions are disabled", "Support links point to Discussions.");
    await safePatch("GitHub Discussions", baseUrl, { has_discussions: true });
  }

  const currentTopics = Array.isArray(repository.topics) ? repository.topics : [];
  const topicsMatch =
    currentTopics.length === desiredTopics.length &&
    desiredTopics.every((topic) => currentTopics.includes(topic));
  if (topicsMatch) {
    record(true, "repository topics cover the searchable product surface");
  } else {
    const missingTopics = desiredTopics.filter((topic) => !currentTopics.includes(topic));
    record(false, "repository topics need discoverability update", `missing=${missingTopics.join(",") || "none"}`);
    await safePut("repository topics", `${baseUrl}/topics`, { names: desiredTopics });
  }

  const releases = await requestJson(`${baseUrl}/releases?per_page=20`);
  const byTag = new Map(releases.map((release) => [release.tag_name, release]));
  const currentRelease = byTag.get(currentTag);
  const oldStableRelease = byTag.get(oldStableTag);
  const deprecatedRelease = byTag.get(deprecatedTag);

  if (!currentRelease) {
    record(false, `${currentTag} release is missing`);
  } else {
    record(!currentRelease.draft, `${currentTag} is published`, "Release must not be draft.");
    record(currentRelease.prerelease === true, `${currentTag} is marked as prerelease alpha`);
    for (const asset of [
      publicMacZipName,
      publicWinInstallerName,
      publicLinuxAppImageName,
      "SHA256SUMS",
      "USER-INSTALL.md",
      "INSTALL-unsigned-mac.md",
      "release-manifest.json",
    ]) {
      record(hasAsset(currentRelease, asset), `${currentTag} asset exists: ${asset}`);
    }
    const bodyLooksCurrent =
      (currentRelease.body || "").includes("Docker Compose quickstart") &&
      (currentRelease.body || "").includes("Do not expose the local core directly to the public internet");
    if (bodyLooksCurrent) {
      record(true, `${currentTag} release body is launch-ready`);
    } else {
      record(false, `${currentTag} release body needs launch wording`);
      await safePatch(`${currentTag} release body`, currentRelease.url, {
        name: `LifeOS AI ${currentTag} - Desktop core + mobile personal AI assistant`,
        body: releaseBody(),
        prerelease: true,
      });
    }
  }

  const staleStableReleases = releases.filter((release) =>
    release.tag_name !== currentTag &&
    isOlderReleaseTag(release.tag_name) &&
    !release.prerelease
  );
  if (staleStableReleases.length === 0) {
    record(true, "no older stable release can steal GitHub Latest");
  } else {
    for (const release of staleStableReleases) {
      record(false, `${release.tag_name} is still a stable release older than ${currentTag}`, "Mark it as prerelease or publish a newer stable replacement before promotion.");
      await safePatch(`${release.tag_name} prerelease flag`, release.url, {
        prerelease: true,
        make_latest: "false",
      });
    }
  }

  if (oldStableRelease?.prerelease) record(true, `${oldStableTag} no longer competes for GitHub Latest`);

  if (deprecatedRelease) {
    const deprecated = deprecatedRelease.prerelease && /Deprecated|已废弃/.test(`${deprecatedRelease.name}\n${deprecatedRelease.body || ""}`);
    if (deprecated) {
      record(true, `${deprecatedTag} is clearly deprecated`);
    } else {
      record(false, `${deprecatedTag} needs deprecated labeling`);
      await safePatch(`${deprecatedTag} deprecated release`, deprecatedRelease.url, {
        name: "Deprecated: LifeOS AI 0.0.0",
        body: deprecatedBody(deprecatedRelease.body || ""),
        prerelease: true,
        make_latest: "false",
      });
    }
  }

  try {
    const latest = await requestJson(`${baseUrl}/releases/latest`);
    if (latest.tag_name === oldStableTag || isOlderReleaseTag(latest.tag_name)) {
      record(false, `GitHub Latest points to stale stable release ${latest.tag_name}`, `Mark ${latest.tag_name} as prerelease or publish a stable replacement.`);
    } else {
      record(true, `GitHub Latest is not stale`, latest.tag_name);
    }
  } catch (error) {
    if (error.status === 404) {
      record(true, "GitHub Latest has no stable release", "Acceptable while the current public build is alpha/prerelease.");
    } else {
      record(false, "GitHub Latest check failed", `${error.status || ""} ${error.message}`.trim());
    }
  }

  for (const check of checks) {
    const suffix = check.detail ? `: ${check.detail}` : "";
    console[check.ok ? "log" : "error"](`[${check.ok ? "PASS" : "FAIL"}] ${check.message}${suffix}`);
  }

  const failures = checks.filter((check) => !check.ok);
  if (failures.length) {
    console.error(
      shouldFix
        ? `GitHub public state still has ${failures.length} issue(s). Check token permissions if fixes failed.`
        : `GitHub public state has ${failures.length} issue(s). Run with GITHUB_TOKEN=... npm run github:public:fix to apply supported fixes.`,
    );
    process.exit(1);
  }

  console.log("GitHub public state is ready for promotion.");
}

if (fs.existsSync(".git")) {
  main().catch((error) => {
    console.error(`[FAIL] ${error.stack || error.message}`);
    process.exit(1);
  });
} else {
  console.error("[FAIL] run this script from the repository root");
  process.exit(1);
}
