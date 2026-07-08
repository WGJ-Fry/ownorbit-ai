#!/usr/bin/env node
import { mkdirSync } from "fs";
import { dirname, resolve } from "path";
import { spawnSync } from "child_process";

const rootDir = resolve(new URL("..", import.meta.url).pathname);
const source = resolve(rootDir, "native/apple/cloudkit-helper/LifeOSCloudKitHelper.swift");
const output = resolve(process.env.LIFEOS_CLOUDKIT_HELPER_OUT || resolve(rootDir, "build/native/LifeOSCloudKitHelper"));

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: rootDir,
    stdio: options.stdio || "pipe",
    encoding: "utf8",
  });
  return {
    ok: result.status === 0,
    status: result.status,
    stdout: result.stdout || "",
    stderr: result.stderr || "",
  };
}

if (process.platform !== "darwin") {
  console.error("CloudKit helper build requires macOS because it links Apple CloudKit.framework.");
  process.exit(2);
}

const swiftCommand = run("xcrun", ["--find", "swiftc"]).ok ? "xcrun" : "swiftc";
const swiftArgsPrefix = swiftCommand === "xcrun" ? ["swiftc"] : [];

mkdirSync(dirname(output), { recursive: true });

const build = run(swiftCommand, [
  ...swiftArgsPrefix,
  "-O",
  "-parse-as-library",
  "-framework",
  "CloudKit",
  source,
  "-o",
  output,
]);

if (!build.ok) {
  if (build.stdout) process.stdout.write(build.stdout);
  if (build.stderr) process.stderr.write(build.stderr);
  process.exit(build.status || 1);
}

console.log(`Built LifeOS CloudKit helper: ${output}`);
console.log(`Use with: LIFEOS_CLOUDKIT_HELPER_BIN="${output}" npm run icloud:helper:smoke -- --probe`);
