import fs from "node:fs";
import path from "node:path";

const rootDir = process.cwd();
const packageJson = JSON.parse(fs.readFileSync(path.join(rootDir, "package.json"), "utf8"));
const version = packageJson.version;
const publicTag = version.includes("-") && version.endsWith(".0") ? version.slice(0, -2) : version;
const releaseTag = `v${publicTag}`;
const image = `ghcr.io/wgj-fry/lifeos-ai:${releaseTag}`;
const failures = [];
const passes = [];

function read(relativePath) {
  return fs.readFileSync(path.join(rootDir, relativePath), "utf8");
}

function exists(relativePath) {
  return fs.existsSync(path.join(rootDir, relativePath));
}

function check(condition, passMessage, failMessage = passMessage) {
  if (condition) passes.push(passMessage);
  else failures.push(failMessage);
}

async function checkGhcrManifest() {
  if (process.env.LIFEOS_CHECK_GHCR !== "1") {
    passes.push("GHCR anonymous manifest check skipped; set LIFEOS_CHECK_GHCR=1 before public announcement");
    return;
  }

  const imageName = "wgj-fry/lifeos-ai";
  const accept = [
    "application/vnd.oci.image.index.v1+json",
    "application/vnd.docker.distribution.manifest.list.v2+json",
    "application/vnd.oci.image.manifest.v1+json",
    "application/vnd.docker.distribution.manifest.v2+json",
  ].join(", ");
  const tokenUrl = `https://ghcr.io/token?service=ghcr.io&scope=repository:${imageName}:pull`;
  const tokenResponse = await fetch(tokenUrl);
  if (!tokenResponse.ok) {
    failures.push(`GHCR anonymous token request failed: HTTP ${tokenResponse.status}`);
    return;
  }
  const tokenBody = await tokenResponse.json().catch(() => ({}));
  if (!tokenBody.token) {
    failures.push("GHCR anonymous token response did not include a token");
    return;
  }

  const manifestResponse = await fetch(`https://ghcr.io/v2/${imageName}/manifests/${releaseTag}`, {
    headers: {
      Accept: accept,
      Authorization: `Bearer ${tokenBody.token}`,
    },
  });
  if (!manifestResponse.ok) {
    const body = await manifestResponse.text().catch(() => "");
    failures.push(`GHCR image is not anonymously pullable for ${releaseTag}: HTTP ${manifestResponse.status} ${body.slice(0, 240)}`.trim());
    return;
  }
  passes.push(`GHCR image is anonymously pullable: ${image}`);
}

async function checkGithubRelease() {
  if (process.env.LIFEOS_CHECK_GITHUB_RELEASE !== "1") {
    passes.push("GitHub public Release check skipped; set LIFEOS_CHECK_GITHUB_RELEASE=1 before public announcement");
    return;
  }

  const response = await fetch(`https://api.github.com/repos/WGJ-Fry/ownorbit-ai/releases/tags/${releaseTag}`, {
    headers: {
      Accept: "application/vnd.github+json",
      "User-Agent": "ownorbit-cold-launch-check",
    },
  });
  if (!response.ok) {
    const body = await response.text().catch(() => "");
    failures.push(`GitHub public Release is not visible for ${releaseTag}: HTTP ${response.status} ${body.slice(0, 240)}`.trim());
    return;
  }

  const release = await response.json().catch(() => ({}));
  if (release.draft) {
    failures.push(`GitHub Release ${releaseTag} is still a draft; publish it before public announcement`);
    return;
  }
  if (release.tag_name !== releaseTag) {
    failures.push(`GitHub Release tag mismatch: expected ${releaseTag}, got ${release.tag_name || "(missing)"}`);
    return;
  }
  passes.push(`GitHub public Release is visible: ${releaseTag}`);
}

const readme = read("README.md");
const readmeZh = exists("README.zh-CN.md") ? read("README.zh-CN.md") : "";
const compose = read("docker-compose.yml");
const coldLaunch = read("docs/cold-launch-checklist.md");
const appSecrets = read("server/appSecrets.ts");
const aiRuntime = read("server/aiProviderRuntime.ts");
const aiRoutes = read("server/aiRoutes.ts");
const dockerWorkflow = exists(".github/workflows/docker.yml") ? read(".github/workflows/docker.yml") : "";
const releaseNotesPath = `docs/release-notes-${releaseTag}.md`;

check(packageJson.private === false, "package.json is publishable", "package.json must keep private=false for public launch");
check(
  /^0\.\d+\.\d+-alpha\.0$/.test(version),
  "package version is the current alpha package version",
  `package.json version is ${version}, expected an alpha package version like 0.x.y-alpha.0`,
);
check(exists("Dockerfile"), "Dockerfile exists");
check(exists("docker-compose.yml"), "docker-compose.yml exists");
check(Boolean(dockerWorkflow), "Docker image workflow exists", ".github/workflows/docker.yml is missing");
check(
  dockerWorkflow.includes('tags:\n      - "v*"') && dockerWorkflow.includes("packages: write") && dockerWorkflow.includes("docker/build-push-action@v6") && dockerWorkflow.includes("push: true"),
  "Docker image workflow builds and pushes GHCR images for version tags",
  "Docker image workflow must trigger on v* tags, allow packages: write, and push images to GHCR",
);
check(compose.includes(`image: ${image}`), "docker-compose image uses the current public alpha tag", `docker-compose.yml must use image: ${image}`);
check(compose.includes("LOCAL_MODEL_NAME=llama3.2"), "docker-compose selects llama3.2 for the quickstart local model");
check(readme.includes(image), "README exposes the same GHCR image tag", `README.md must mention ${image}`);
check(readme.includes(`release tag is \`${releaseTag}\``), "README explains release tag versus package version", `README.md must explain release tag ${releaseTag}`);
check(coldLaunch.includes(image), "cold launch checklist verifies the same GHCR image tag", `docs/cold-launch-checklist.md must mention ${image}`);
check(coldLaunch.includes(`docker pull ${image}`), "cold launch checklist includes anonymous docker pull proof", `docs/cold-launch-checklist.md must include docker pull ${image}`);
check(coldLaunch.includes(`Tag: ${releaseTag}`), "cold launch checklist uses the current release tag", `docs/cold-launch-checklist.md must use Tag: ${releaseTag}`);
check(exists(releaseNotesPath), "release notes exist for the current alpha tag", `missing ${releaseNotesPath}`);
check(Boolean(readmeZh), "Chinese README exists");
check(readme.includes("README.zh-CN.md") && readmeZh.includes("README.md"), "README files link across languages", "README.md and README.zh-CN.md must link across languages");
check(exists("docs/assets/real-demo-en.gif"), "English README demo GIF exists");
check(exists("docs/assets/real-demo.gif"), "Chinese README demo GIF exists");
check(readme.includes("docs/assets/real-demo-en.gif"), "English README uses the English demo GIF", "README.md must use docs/assets/real-demo-en.gif");
check(readmeZh.includes("docs/assets/real-demo.gif"), "Chinese README uses the Chinese demo GIF", "README.zh-CN.md must use docs/assets/real-demo.gif");
const ownOrbitVisualAssets = [
  "docs/assets/promo/ownorbit-ai-30s-en-cover.png",
  "docs/assets/promo/ownorbit-ai-30s-en.gif",
  "docs/assets/promo/ownorbit-ai-30s-en.mp4",
  "docs/assets/promo/ownorbit-ai-30s-zh-cover.png",
  "docs/assets/promo/ownorbit-ai-30s-zh.gif",
  "docs/assets/promo/ownorbit-ai-30s-zh.mp4",
  "docs/assets/readme/ownorbit-readme-hero-en.svg",
  "docs/assets/readme/ownorbit-readme-hero-zh.svg",
  "docs/assets/readme/ownorbit-feature-map-en.svg",
  "docs/assets/readme/ownorbit-feature-map-zh.svg",
];
const legacyBrandVisualAssets = [
  "docs/assets/promo/lifeos-ai-30s-en-cover.png",
  "docs/assets/promo/lifeos-ai-30s-en.gif",
  "docs/assets/promo/lifeos-ai-30s-en.mp4",
  "docs/assets/promo/lifeos-ai-30s-zh-cover.png",
  "docs/assets/promo/lifeos-ai-30s-zh.gif",
  "docs/assets/promo/lifeos-ai-30s-zh.mp4",
  "public/promo/lifeos-ai-jike-cover.jpg",
  "public/promo/lifeos-ai-jike-demo.gif",
];
check(
  ownOrbitVisualAssets.every(exists),
  "OwnOrbit bilingual README and 30-second visual assets exist",
  `Missing OwnOrbit visual assets: ${ownOrbitVisualAssets.filter((asset) => !exists(asset)).join(", ")}`,
);
check(
  ownOrbitVisualAssets.every((asset) => readme.includes(asset) || readmeZh.includes(asset)),
  "README files reference OwnOrbit-branded visual asset paths",
  "README files must reference every current OwnOrbit visual asset path",
);
check(
  legacyBrandVisualAssets.every((asset) => !exists(asset)),
  "Legacy LifeOS-branded promo files are absent",
  `Remove legacy promo files: ${legacyBrandVisualAssets.filter(exists).join(", ")}`,
);
check(readmeZh.includes(image), "Chinese README exposes the same GHCR image tag", `README.zh-CN.md must mention ${image}`);
check(readmeZh.includes(`release tag 是 \`${releaseTag}\``), "Chinese README explains release tag versus package version", `README.zh-CN.md must explain release tag ${releaseTag}`);
check(readmeZh.includes(`package version 是 \`${version}\``), "Chinese README explains the package version", `README.zh-CN.md must explain package version ${version}`);
check(appSecrets.includes('defaultModel: "llama3.2"'), "local provider defaults to llama3.2");
check(["llama3.2", "qwen2.5", "deepseek-r1", "mistral"].every((model) => appSecrets.includes(`"${model}"`)), "local provider catalog includes llama3.2 and compatible alternatives");
check(appSecrets.includes("process.env.LIFEOS_LOCAL_MODEL_NAME || process.env.LOCAL_MODEL_NAME"), "selected local model honors LOCAL_MODEL_NAME");
check(aiRuntime.includes('process.env.LIFEOS_QUICKSTART === "1"') && aiRuntime.includes('return "local"'), "quickstart forces local provider over frontend hints");
check(aiRuntime.includes('if (providerId === "local") return selectedModel'), "local provider rejects frontend non-local model names");
check(
  aiRoutes.includes("loadVaultMarkdownContext()")
    && aiRoutes.includes("LOCAL MEMORY CONTEXT - UNTRUSTED USER DATA")
    && readme.includes("LIFEOS_CALENDAR_ICS_DIR=/app/vault/calendar")
    && readme.includes("VTODO")
    && readmeZh.includes("LIFEOS_CALENDAR_ICS_DIR=/app/vault/calendar"),
  "chat route injects local Markdown and ICS memory context safely",
);

await checkGhcrManifest();
await checkGithubRelease();

for (const message of passes) console.log(`[PASS] ${message}`);
for (const message of failures) console.error(`[FAIL] ${message}`);

if (failures.length) {
  console.error(`Cold launch readiness failed: ${failures.length} issue(s).`);
  process.exit(1);
}

console.log(`Cold launch readiness passed for ${releaseTag}.`);
