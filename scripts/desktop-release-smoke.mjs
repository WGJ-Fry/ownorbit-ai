import { spawnSync } from "node:child_process";
import process from "node:process";

const npmCommand = process.platform === "win32" ? "npm.cmd" : "npm";
const fast = process.env.LIFEOS_RELEASE_SMOKE_FAST === "1";
const launchPackagedMacApp = process.env.LIFEOS_RELEASE_SMOKE_LAUNCH === "1";

function run(script, extraEnv = {}) {
  const result = spawnSync(npmCommand, ["run", script], {
    cwd: process.cwd(),
    env: { ...process.env, ...extraEnv },
    encoding: "utf8",
    stdio: "inherit",
    shell: process.platform === "win32",
  });
  if (result.error) {
    console.error(`Failed to run npm script "${script}": ${result.error.message}`);
    process.exit(1);
  }
  if (result.status !== 0) {
    process.exit(result.status || 1);
  }
}

const qualityGate = fast
  ? process.platform === "win32"
    ? ["lint", "test:desktop"]
    : ["lint", "test:smoke", "test:desktop"]
  : ["lint", "test", "test:e2e", "test:desktop"];

for (const script of qualityGate) run(script);

if (process.platform === "darwin") {
  run("desktop:zip:unsigned");
} else if (process.platform === "win32") {
  run("desktop:dist:win", { CSC_IDENTITY_AUTO_DISCOVERY: "false" });
  run("release:feed");
} else if (process.platform === "linux") {
  run("desktop:dist:linux", { CSC_IDENTITY_AUTO_DISCOVERY: "false" });
  run("release:feed");
} else {
  console.error(`Unsupported desktop release smoke platform: ${process.platform}`);
  process.exit(1);
}

run("desktop:artifact:smoke");
if (process.platform === "darwin" && launchPackagedMacApp) {
  run("desktop:artifact:smoke:launch");
}
run("release:check:unsigned");
