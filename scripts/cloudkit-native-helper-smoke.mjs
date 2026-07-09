#!/usr/bin/env node
import { getIcloudDataSyncReadiness } from "../server/icloudDataSyncReadiness.ts";
import { runCloudKitNativeHelper } from "../server/cloudKitNativeHelper.ts";

function parseArgs(argv) {
  const result = { operation: "probe", strict: false };
  for (let index = 0; index < argv.length; index += 1) {
    const item = argv[index];
    if (item === "--roundtrip") result.operation = "roundtrip";
    else if (item === "--subscription-probe") result.operation = "subscription-probe";
    else if (item === "--probe") result.operation = "probe";
    else if (item === "--operation") result.operation = argv[++index] || result.operation;
    else if (item === "--strict") result.strict = true;
  }
  return result;
}

const args = parseArgs(process.argv.slice(2));
const readiness = getIcloudDataSyncReadiness({ platformSupported: process.platform === "darwin" });
const result = await runCloudKitNativeHelper(readiness, { operation: args.operation });

console.log(JSON.stringify(result, null, 2));

if (result.status === "failed") process.exit(1);
if (result.status === "skipped" && args.strict) process.exit(2);
