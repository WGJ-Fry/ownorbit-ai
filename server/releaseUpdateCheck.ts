import { getPackageVersion } from "./version";

const DEFAULT_OWNER = "WGJ-Fry";
const DEFAULT_REPO = "ownorbit-ai";
const RELEASE_CHECK_TIMEOUT_MS = Number(process.env.LIFEOS_RELEASE_CHECK_TIMEOUT_MS || 5000);

export type ReleaseUpdateAsset = {
  name: string;
  size: number;
  downloadUrl: string;
};

export type ReleaseUpdatePlatform = "macos" | "windows" | "linux" | "unknown";

export type ReleaseManualUpdateStep = {
  id: "backup" | "download" | "checksum" | "install" | "restart";
  label: string;
  required: boolean;
  command?: string;
  url?: string;
};

export type ReleaseAutoUpdateState = {
  configured: boolean;
  enabled: boolean;
  mode: "manual" | "feed-ready" | "blocked";
  feedUrl: string | null;
  updateUrlHost: string;
  reason: "not_configured" | "opt_in_required" | "ready" | "non_https" | "url_contains_credentials_or_tokens" | "url_points_to_artifact" | "invalid_url";
  requirements: string[];
};

export type ReleaseManualUpdatePlan = {
  platform: ReleaseUpdatePlatform;
  assetName: string | null;
  assetUrl: string | null;
  checksumUrl: string | null;
  checksumCommand: string;
  installCommand: string;
  backupRequired: true;
  sha256Required: true;
  autoUpdateBlockedReason: string;
  steps: ReleaseManualUpdateStep[];
};

export type ReleaseUpdateCheck = {
  checkedAt: string;
  status: "up-to-date" | "update-available" | "unavailable" | "error";
  current: {
    version: string;
    tag: string;
  };
  latest: {
    version: string;
    tag: string;
    name: string;
    url: string;
    prerelease: boolean;
    publishedAt: string;
    assetCount: number;
    assets: ReleaseUpdateAsset[];
    checksumAsset?: ReleaseUpdateAsset;
  } | null;
  updateAvailable: boolean;
  manualUpdateRequired: boolean;
  autoUpdateEnabled: boolean;
  autoUpdate: ReleaseAutoUpdateState;
  manualUpdatePlan: ReleaseManualUpdatePlan | null;
  reason: string;
  recommendations: string[];
};

type ReleaseApiRecord = {
  tag_name?: string;
  name?: string;
  html_url?: string;
  draft?: boolean;
  prerelease?: boolean;
  published_at?: string;
  assets?: Array<{
    name?: string;
    size?: number;
    browser_download_url?: string;
  }>;
};

type VersionParts = {
  major: number;
  minor: number;
  patch: number;
  prereleaseRank: number;
  prereleaseNumber: number;
};

function configuredRepository() {
  const raw = process.env.LIFEOS_RELEASE_REPOSITORY || `${DEFAULT_OWNER}/${DEFAULT_REPO}`;
  const match = raw.trim().match(/^([A-Za-z0-9_.-]+)\/([A-Za-z0-9_.-]+)$/);
  if (!match) return { owner: DEFAULT_OWNER, repo: DEFAULT_REPO };
  return { owner: match[1], repo: match[2] };
}

export function packageVersionToReleaseTag(version = getPackageVersion()) {
  const normalized = version.trim();
  const prerelease = normalized.match(/^(\d+\.\d+\.\d+)-(alpha|beta|rc)(?:\.\d+)?$/);
  if (prerelease) return `v${prerelease[1]}-${prerelease[2]}`;
  return `v${normalized}`;
}

function parseVersionTag(value: string): VersionParts | null {
  const match = value.trim().match(/^v?(\d+)\.(\d+)\.(\d+)(?:-([a-z]+)(?:\.(\d+))?)?$/i);
  if (!match) return null;
  const prerelease = (match[4] || "").toLowerCase();
  const prereleaseRank = prerelease === "alpha" ? 0 : prerelease === "beta" ? 1 : prerelease === "rc" ? 2 : 3;
  return {
    major: Number(match[1]),
    minor: Number(match[2]),
    patch: Number(match[3]),
    prereleaseRank,
    prereleaseNumber: match[5] ? Number(match[5]) : 0,
  };
}

export function compareReleaseTags(left: string, right: string) {
  const a = parseVersionTag(left);
  const b = parseVersionTag(right);
  if (!a || !b) return left.localeCompare(right);
  for (const key of ["major", "minor", "patch", "prereleaseRank", "prereleaseNumber"] as const) {
    if (a[key] !== b[key]) return a[key] - b[key];
  }
  return 0;
}

function releaseVersionFromTag(tag: string) {
  return tag.replace(/^v/, "");
}

function normalizeAsset(asset: NonNullable<ReleaseApiRecord["assets"]>[number]): ReleaseUpdateAsset {
  return {
    name: String(asset.name || "download"),
    size: typeof asset.size === "number" && Number.isFinite(asset.size) ? asset.size : 0,
    downloadUrl: String(asset.browser_download_url || ""),
  };
}

function normalizeRelease(record: ReleaseApiRecord) {
  const tag = String(record.tag_name || "");
  const assets = Array.isArray(record.assets) ? record.assets.map(normalizeAsset) : [];
  return {
    version: releaseVersionFromTag(tag),
    tag,
    name: String(record.name || tag),
    url: String(record.html_url || ""),
    prerelease: Boolean(record.prerelease),
    publishedAt: String(record.published_at || ""),
    assetCount: assets.length,
    assets,
    checksumAsset: assets.find((asset) => asset.name === "SHA256SUMS"),
  };
}

function platformFromNodePlatform(platform = process.platform): ReleaseUpdatePlatform {
  if (platform === "darwin") return "macos";
  if (platform === "win32") return "windows";
  if (platform === "linux") return "linux";
  return "unknown";
}

function chooseAssetForPlatform(assets: ReleaseUpdateAsset[], platform: ReleaseUpdatePlatform) {
  const downloadableAssets = assets.filter((asset) => asset.name !== "SHA256SUMS" && asset.downloadUrl);
  const byName = (patterns: RegExp[]) => downloadableAssets.find((asset) => patterns.some((pattern) => pattern.test(asset.name)));
  if (platform === "macos") {
    return byName([/\.zip$/i, /\.dmg$/i, /mac|darwin/i]) || downloadableAssets[0] || null;
  }
  if (platform === "windows") {
    return byName([/setup.*\.exe$/i, /\.exe$/i, /win/i]) || downloadableAssets[0] || null;
  }
  if (platform === "linux") {
    return byName([/\.appimage$/i, /linux/i]) || downloadableAssets[0] || null;
  }
  return downloadableAssets[0] || null;
}

function checksumCommandForPlatform(platform: ReleaseUpdatePlatform, assetName: string | null) {
  const name = assetName || "downloaded-file";
  if (platform === "windows") return `Get-FileHash ".\\${name}" -Algorithm SHA256`;
  if (platform === "macos" || platform === "linux") return `shasum -a 256 "${name}"`;
  return `Compare the SHA256 hash of "${name}" with SHA256SUMS before opening it.`;
}

function installCommandForPlatform(platform: ReleaseUpdatePlatform, assetName: string | null) {
  const name = assetName || "downloaded package";
  if (platform === "macos") {
    return `Unzip "${name}", move OwnOrbit AI.app to /Applications, then open it after SHA256 verification.`;
  }
  if (platform === "windows") {
    return `Run "${name}" only after SHA256 verification. SmartScreen may warn because this alpha is unsigned.`;
  }
  if (platform === "linux") return `chmod +x "${name}" && ./"${name}"`;
  return `Open the verified package for your platform only after comparing it with SHA256SUMS.`;
}

function buildAutoUpdateState(): ReleaseAutoUpdateState {
  const raw = String(process.env.LIFEOS_UPDATE_URL || "").trim();
  const explicitOptIn = process.env.LIFEOS_ENABLE_DESKTOP_AUTO_UPDATE === "1";
  const signedDistribution = process.env.LIFEOS_DISTRIBUTION === "signed";
  const baseRequirements = [
    "Publish the complete release/update-feed directory to the HTTPS feed URL.",
    "Keep SHA256SUMS and release-manifest.json beside the latest*.yml feed files.",
    "Use signed/notarized packages for default automatic update checks, or set LIFEOS_ENABLE_DESKTOP_AUTO_UPDATE=1 after the feed URL is stable and public.",
  ];
  if (!raw) {
    return {
      configured: false,
      enabled: false,
      mode: "manual",
      feedUrl: null,
      updateUrlHost: "",
      reason: "not_configured",
      requirements: baseRequirements,
    };
  }
  try {
    const parsed = new URL(raw);
    const updateUrlHost = parsed.host;
    const blocked = (reason: ReleaseAutoUpdateState["reason"]): ReleaseAutoUpdateState => ({
      configured: true,
      enabled: false,
      mode: "blocked",
      feedUrl: raw,
      updateUrlHost,
      reason,
      requirements: baseRequirements,
    });
    if (parsed.protocol !== "https:") return blocked("non_https");
    if (parsed.username || parsed.password || parsed.search || parsed.hash) return blocked("url_contains_credentials_or_tokens");
    if (/\.(dmg|zip|exe|AppImage|yml|json)$/i.test(parsed.pathname)) return blocked("url_points_to_artifact");
    if (!explicitOptIn && !signedDistribution) {
      return {
        configured: true,
        enabled: false,
        mode: "manual",
        feedUrl: raw,
        updateUrlHost,
        reason: "opt_in_required",
        requirements: baseRequirements,
      };
    }
    return {
      configured: true,
      enabled: true,
      mode: "feed-ready",
      feedUrl: raw,
      updateUrlHost,
      reason: "ready",
      requirements: baseRequirements,
    };
  } catch {
    return {
      configured: true,
      enabled: false,
      mode: "blocked",
      feedUrl: raw,
      updateUrlHost: "invalid-url",
      reason: "invalid_url",
      requirements: baseRequirements,
    };
  }
}

function buildManualUpdatePlan(latest: NonNullable<ReleaseUpdateCheck["latest"]>, platform: ReleaseUpdatePlatform): ReleaseManualUpdatePlan {
  const asset = chooseAssetForPlatform(latest.assets, platform);
  const assetName = asset?.name || null;
  const checksumCommand = checksumCommandForPlatform(platform, assetName);
  const installCommand = installCommandForPlatform(platform, assetName);
  return {
    platform,
    assetName,
    assetUrl: asset?.downloadUrl || latest.url || null,
    checksumUrl: latest.checksumAsset?.downloadUrl || null,
    checksumCommand,
    installCommand,
    backupRequired: true,
    sha256Required: true,
    autoUpdateBlockedReason: "Unsigned alpha builds intentionally keep manual download and SHA256 verification until a trusted update feed is enabled.",
    steps: [
      { id: "backup", label: "Create a SQLite backup in the admin console.", required: true },
      { id: "download", label: assetName ? `Download ${assetName} from GitHub Releases.` : "Download the matching package from GitHub Releases.", required: true, url: asset?.downloadUrl || latest.url },
      { id: "checksum", label: "Verify the package against SHA256SUMS before opening it.", required: true, command: checksumCommand, url: latest.checksumAsset?.downloadUrl },
      { id: "install", label: "Install the verified package for this computer.", required: true, command: installCommand },
      { id: "restart", label: "Restart OwnOrbit AI and confirm the version in Settings.", required: true },
    ],
  };
}

function buildRecommendations(status: ReleaseUpdateCheck["status"], latestTag: string | null) {
  if (status === "update-available") {
    return [
      `Download ${latestTag} from GitHub Releases.`,
      "Verify SHA256SUMS before opening the new desktop package.",
      "Create a SQLite backup before replacing the current app.",
      "Automatic update is intentionally disabled for unsigned alpha packages.",
    ];
  }
  if (status === "up-to-date") {
    return [
      "This installation matches the newest visible GitHub prerelease.",
      "Keep manual SHA256 verification for unsigned alpha packages.",
    ];
  }
  return [
    "Open GitHub Releases manually and compare the newest tag before updating.",
    "Do not download installers from unofficial mirrors.",
  ];
}

export async function checkReleaseUpdate(options: { fetchImpl?: typeof fetch; now?: Date; platform?: NodeJS.Platform } = {}): Promise<ReleaseUpdateCheck> {
  const currentVersion = getPackageVersion();
  const currentTag = packageVersionToReleaseTag(currentVersion);
  const checkedAt = (options.now || new Date()).toISOString();
  const platform = platformFromNodePlatform(options.platform);
  const autoUpdate = buildAutoUpdateState();
  const { owner, repo } = configuredRepository();
  const url = process.env.LIFEOS_RELEASE_API_URL || `https://api.github.com/repos/${owner}/${repo}/releases?per_page=20`;
  const fetchImpl = options.fetchImpl || fetch;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), RELEASE_CHECK_TIMEOUT_MS);

  try {
    const response = await fetchImpl(url, {
      headers: {
        "Accept": "application/vnd.github+json",
        "User-Agent": "OwnOrbit-AI-Update-Check",
      },
      signal: controller.signal,
    });
    if (!response.ok) throw new Error(`release_api_http_${response.status}`);
    const records = await response.json();
    if (!Array.isArray(records)) throw new Error("release_api_invalid_response");
    const candidates = records
      .filter((release: ReleaseApiRecord) => !release.draft && parseVersionTag(String(release.tag_name || "")))
      .sort((a: ReleaseApiRecord, b: ReleaseApiRecord) => compareReleaseTags(String(a.tag_name || ""), String(b.tag_name || "")));
    const latestRecord = candidates[candidates.length - 1];
    if (!latestRecord) {
      return {
        checkedAt,
        status: "unavailable",
        current: { version: currentVersion, tag: currentTag },
        latest: null,
        updateAvailable: false,
        manualUpdateRequired: !autoUpdate.enabled,
        autoUpdateEnabled: autoUpdate.enabled,
        autoUpdate,
        manualUpdatePlan: null,
        reason: "no_public_release_found",
        recommendations: buildRecommendations("unavailable", null),
      };
    }
    const latest = normalizeRelease(latestRecord);
    const updateAvailable = compareReleaseTags(latest.tag, currentTag) > 0;
    const status = updateAvailable ? "update-available" : "up-to-date";
    return {
      checkedAt,
      status,
      current: { version: currentVersion, tag: currentTag },
      latest,
      updateAvailable,
      manualUpdateRequired: !autoUpdate.enabled,
      autoUpdateEnabled: autoUpdate.enabled,
      autoUpdate,
      manualUpdatePlan: buildManualUpdatePlan(latest, platform),
      reason: updateAvailable ? "newer_release_available" : "current_release_is_latest",
      recommendations: buildRecommendations(status, latest.tag),
    };
  } catch (error: any) {
    return {
      checkedAt,
      status: "error",
      current: { version: currentVersion, tag: currentTag },
      latest: null,
      updateAvailable: false,
      manualUpdateRequired: !autoUpdate.enabled,
      autoUpdateEnabled: autoUpdate.enabled,
      autoUpdate,
      manualUpdatePlan: null,
      reason: error?.name === "AbortError" ? "release_check_timeout" : String(error?.message || "release_check_failed").slice(0, 120),
      recommendations: buildRecommendations("error", null),
    };
  } finally {
    clearTimeout(timer);
  }
}
