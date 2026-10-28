#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

if (process.platform !== "darwin") {
  console.log("[SKIP] iOS XCTest requires macOS; the dedicated macOS workflow is a release gate.");
  process.exit(0);
}

const result = spawnSync(
  process.execPath,
  [path.join(rootDir, "scripts", "build-ios-mobile-shell.mjs")],
  {
    cwd: rootDir,
    env: {
      ...process.env,
      LIFEOS_IOS_NATIVE_RUN_TESTS: "1",
      LIFEOS_IOS_NATIVE_BUILD_DIR: path.join(
        rootDir,
        "build",
        "native",
        "mobile-shell-xctest",
      ),
    },
    stdio: "inherit",
  },
);

if (result.error) {
  console.error(`[FAIL] Unable to start the iOS XCTest gate: ${result.error.message}`);
  process.exit(1);
}

process.exit(result.status ?? 1);
