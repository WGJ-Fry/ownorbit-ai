import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const rootDir = path.resolve(fileURLToPath(new URL("..", import.meta.url)));
const packageJson = JSON.parse(await readFile(path.join(rootDir, "package.json"), "utf8"));
const currentPublicVersion = packageJson.version.includes("-") && packageJson.version.endsWith(".0")
  ? packageJson.version.slice(0, -2)
  : packageJson.version;
const currentTag = `v${currentPublicVersion}`;
const publicMacZipName = `LifeOS.AI-${packageJson.version}-arm64-unsigned.zip`;
const publicWinInstallerName = `LifeOS.AI.Setup.${packageJson.version}.exe`;
const publicLinuxAppImageName = `LifeOS.AI-${packageJson.version}.AppImage`;
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

function currentRelease(overrides = {}) {
  return {
    tag_name: currentTag,
    name: `LifeOS AI ${currentTag}`,
    draft: false,
    prerelease: true,
    url: "/release/current",
    body: "Docker Compose quickstart\nDo not expose the local core directly to the public internet",
    assets: [
      publicMacZipName,
      publicWinInstallerName,
      publicLinuxAppImageName,
      "SHA256SUMS",
      "USER-INSTALL.md",
      "INSTALL-unsigned-mac.md",
      "release-manifest.json",
    ].map((name) => ({ name })),
    ...overrides,
  };
}

async function withMockGitHubApi({ releases, latest, repository = {} }, fn) {
  const server = createServer((req, res) => {
    res.setHeader("content-type", "application/json");
    if (req.method === "GET" && req.url === "/repos/WGJ-Fry/lifeos-ai") {
      res.end(JSON.stringify({
        description: desiredDescription,
        has_discussions: true,
        topics: desiredTopics,
        ...repository,
      }));
      return;
    }
    if (req.method === "GET" && req.url?.startsWith("/repos/WGJ-Fry/lifeos-ai/releases?")) {
      res.end(JSON.stringify(releases));
      return;
    }
    if (req.method === "GET" && req.url === "/repos/WGJ-Fry/lifeos-ai/releases/latest") {
      if (latest) {
        res.end(JSON.stringify(latest));
      } else {
        res.statusCode = 404;
        res.end(JSON.stringify({ message: "Not Found" }));
      }
      return;
    }
    res.statusCode = 404;
    res.end(JSON.stringify({ message: "Unexpected mock route" }));
  });

  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  try {
    const { port } = server.address();
    return await fn(`http://127.0.0.1:${port}/repos/WGJ-Fry/lifeos-ai`);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
}

function runGithubPublicState(apiBaseUrl) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, ["scripts/github-public-state.mjs"], {
      cwd: rootDir,
      env: {
        ...process.env,
        LIFEOS_GITHUB_API_BASE_URL: apiBaseUrl,
      },
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => { stdout += chunk.toString(); });
    child.stderr.on("data", (chunk) => { stderr += chunk.toString(); });
    child.on("close", (status) => resolve({ status, stdout, stderr }));
  });
}

test("GitHub public state check blocks any older stable release from stealing Latest", async () => {
  await withMockGitHubApi({
    releases: [
      currentRelease(),
      { tag_name: "v0.1.2", draft: false, prerelease: false, url: "/release/old-stable", body: "", assets: [] },
    ],
    latest: { tag_name: "v0.1.2" },
  }, async (apiBaseUrl) => {
    const result = await runGithubPublicState(apiBaseUrl);
    const output = `${result.stdout}\n${result.stderr}`;
    assert.notEqual(result.status, 0, output);
    assert.match(output, /v0\.1\.2 is still a stable release older than/);
    assert.match(output, /GitHub Latest points to stale stable release v0\.1\.2/);
  });
});

test("GitHub public state check accepts prerelease-only alpha when Latest is absent", async () => {
  await withMockGitHubApi({
    releases: [currentRelease()],
    latest: null,
  }, async (apiBaseUrl) => {
    const result = await runGithubPublicState(apiBaseUrl);
    assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
    assert.match(result.stdout, /no older stable release can steal GitHub Latest/);
    assert.match(result.stdout, /GitHub Latest has no stable release/);
  });
});

test("GitHub public state check blocks incomplete discoverability topics", async () => {
  await withMockGitHubApi({
    releases: [currentRelease()],
    latest: null,
    repository: {
      topics: desiredTopics.filter((topic) => topic !== "personal-knowledge-management"),
    },
  }, async (apiBaseUrl) => {
    const result = await runGithubPublicState(apiBaseUrl);
    const output = `${result.stdout}\n${result.stderr}`;
    assert.notEqual(result.status, 0, output);
    assert.match(output, /repository topics need discoverability update/);
    assert.match(output, /missing=personal-knowledge-management/);
  });
});
