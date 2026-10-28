import { spawnSync } from "node:child_process";

const commitPattern = /^[0-9a-f]{40,64}$/i;

function git(rootDir, args) {
  return spawnSync("git", args, {
    cwd: rootDir,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
}

function stdout(result) {
  return String(result.stdout || "").trim();
}

export function currentSourceCommit(rootDir) {
  const result = git(rootDir, ["rev-parse", "HEAD"]);
  return result.status === 0 ? stdout(result) : "";
}

export function createReleaseProvenance(rootDir, env = process.env) {
  const commit = currentSourceCommit(rootDir);
  const status = git(rootDir, ["status", "--porcelain", "--untracked-files=normal"]);
  const exactTag = git(rootDir, ["describe", "--tags", "--exact-match", "HEAD"]);
  const branch = git(rootDir, ["branch", "--show-current"]);

  return {
    schema: "ownorbit-release-source.v1",
    commit,
    ref: String(env.GITHUB_REF_NAME || (exactTag.status === 0 ? stdout(exactTag) : stdout(branch)) || "detached"),
    dirty: status.status !== 0 || stdout(status) !== "",
  };
}

export function releaseProvenanceFailures(source, { expectedCommit = "", expectedRef = "", requireClean = true } = {}) {
  const failures = [];
  if (!source || typeof source !== "object") {
    return ["release manifest is missing source provenance"];
  }
  if (source.schema !== "ownorbit-release-source.v1") {
    failures.push(`release manifest source schema is unsupported: ${source.schema || "(missing)"}`);
  }
  if (!commitPattern.test(String(source.commit || ""))) {
    failures.push("release manifest source commit must be a full Git commit hash");
  }
  if (expectedCommit && String(source.commit || "") !== expectedCommit) {
    failures.push(`release manifest was built from ${source.commit || "(missing)"}, expected ${expectedCommit}`);
  }
  if (requireClean && source.dirty !== false) {
    failures.push("release manifest was generated from a dirty worktree; commit the source and rebuild every package");
  }
  if (!String(source.ref || "").trim()) {
    failures.push("release manifest source ref is missing");
  }
  if (expectedRef && String(source.ref || "") !== expectedRef) {
    failures.push(`release manifest source ref is ${source.ref || "(missing)"}, expected ${expectedRef}`);
  }
  return failures;
}

export function assertReleaseProvenance(source, options = {}) {
  const failures = releaseProvenanceFailures(source, options);
  if (failures.length > 0) throw new Error(failures.join("\n"));
}

