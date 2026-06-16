import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import dotenv from "dotenv";

const rootDir = process.cwd();
const signingEnvPath = path.join(rootDir, ".env.signing.local");

if (fs.existsSync(signingEnvPath)) {
  dotenv.config({ path: signingEnvPath, override: false });
  console.log(`[INFO] Loaded signing environment from ${path.relative(rootDir, signingEnvPath)}`);
} else {
  console.log("[INFO] .env.signing.local was not found; using current shell environment");
}

const [command, ...args] = process.argv.slice(2);

if (!command) {
  console.error("Usage: node scripts/with-signing-env.mjs <command> [...args]");
  process.exit(1);
}

const child = spawn(command, args, {
  cwd: rootDir,
  env: process.env,
  stdio: "inherit",
  shell: false,
});

child.on("exit", (code, signal) => {
  if (signal) {
    process.kill(process.pid, signal);
    return;
  }
  process.exit(code ?? 0);
});
