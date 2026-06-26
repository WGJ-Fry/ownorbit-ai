import fs from "node:fs";

const owner = "WGJ-Fry";
const repo = "lifeos-ai";
const baseUrl = `https://api.github.com/repos/${owner}/${repo}`;
const currentTag = "v0.1.2-alpha";
const oldStableTag = "v0.1.0";
const deprecatedTag = "v0.0.0";
const desiredDescription =
  "Local-first personal AI assistant for memory, mobile companion, remote access, and generated problem-solving tools.";
const args = new Set(process.argv.slice(2));
const shouldFix = args.has("--fix");
const token = process.env.GITHUB_TOKEN || process.env.GH_TOKEN || "";
const checks = [];

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

function releaseBody() {
  return `## LifeOS AI v0.1.2-alpha

LifeOS AI turns your desktop into a private AI core and your phone into a paired personal AI companion.

### What this public alpha includes

- Docker Compose quickstart with Ollama and local Markdown notes.
- macOS Apple Silicon unsigned ZIP.
- Windows x64 NSIS installer.
- Linux x64 AppImage.
- Desktop admin setup, AI provider settings, backup/restore, diagnostics, and device pairing.
- Mobile PWA chat, offline queue, device status, and action permissions.
- LAN, Tailscale, and Cloudflare Tunnel connection diagnostics with public-exposure warnings.
- Studio generated problem-solving programs with runtime logs, state storage, debug instructions, and rollback.

### Downloads

- macOS Apple Silicon unsigned ZIP: \`LifeOS.AI-0.1.2-alpha.0-arm64-unsigned.zip\`
- Windows x64 NSIS installer: \`LifeOS.AI.Setup.0.1.2-alpha.0.exe\`
- Linux x64 AppImage: \`LifeOS.AI-0.1.2-alpha.0.AppImage\`
- Checksum: \`SHA256SUMS\`
- Install guide: \`USER-INSTALL.md\`
- macOS unsigned fallback guide: \`INSTALL-unsigned-mac.md\`

### Install

macOS: download the unsigned ZIP, unzip it, drag \`LifeOS AI.app\` to Applications, then follow \`INSTALL-unsigned-mac.md\` if Gatekeeper blocks the first launch.

Windows: download the NSIS \`.exe\` and follow the SmartScreen guidance in \`USER-INSTALL.md\`.

Linux: download the AppImage, run \`chmod +x "LifeOS.AI-0.1.2-alpha.0.AppImage"\`, then launch it.

### Verification

GitHub asset URLs use dot-separated filenames. The uploaded \`SHA256SUMS\` file may list the original electron-builder filenames with spaces; compare the hash value if your downloaded filename differs.

\`\`\`text
af53111d6689f0cc2ad67b118f3d7bb274fc9742141cc760fdf9f3d9f82c909e  LifeOS AI-0.1.2-alpha.0-arm64-unsigned.zip
b1502f090764909ea8be708474e7f5800d202ced2c48cfcded0a13c4c4f03f57  LifeOS AI Setup 0.1.2-alpha.0.exe
bd83e1c702f24586a81925a6db34deb74b2f68175416c85235e8750b6bf7c5fc  LifeOS AI-0.1.2-alpha.0.AppImage
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
> This early release is kept only for historical reference. New users should use [LifeOS AI v0.1.2-alpha](https://github.com/${owner}/${repo}/releases/tag/${currentTag}).
>
> 这个早期版本仅保留作历史记录。新用户请使用 [LifeOS AI v0.1.2-alpha](https://github.com/${owner}/${repo}/releases/tag/${currentTag})。
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
      "LifeOS.AI-0.1.2-alpha.0-arm64-unsigned.zip",
      "LifeOS.AI.Setup.0.1.2-alpha.0.exe",
      "LifeOS.AI-0.1.2-alpha.0.AppImage",
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
        name: "LifeOS AI v0.1.2-alpha - Desktop core + mobile personal AI assistant",
        body: releaseBody(),
        prerelease: true,
      });
    }
  }

  if (oldStableRelease) {
    if (oldStableRelease.prerelease) {
      record(true, `${oldStableTag} no longer competes for GitHub Latest`);
    } else {
      record(false, `${oldStableTag} is still a stable release`, "It can steal GitHub Latest from the current alpha.");
      await safePatch(`${oldStableTag} prerelease flag`, oldStableRelease.url, {
        prerelease: true,
        make_latest: "false",
      });
    }
  }

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
    if (latest.tag_name === oldStableTag) {
      record(false, "GitHub Latest still points to old v0.1.0", "Mark v0.1.0 as prerelease or publish a stable replacement.");
    } else {
      record(true, `GitHub Latest is not the stale ${oldStableTag}`, latest.tag_name);
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
