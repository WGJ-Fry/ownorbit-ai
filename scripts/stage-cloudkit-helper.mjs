#!/usr/bin/env node
import { stageCloudKitHelper } from "./cloudkit-helper-bundle.mjs";

try {
  const result = stageCloudKitHelper({ required: process.argv.includes("--require") || undefined });
  if (result.manifest.included) {
    console.log(`Prepared verified CloudKit helper desktop resource for ${result.manifest.bundleId}.`);
  } else {
    console.log(`Prepared desktop resources without CloudKit helper: ${result.manifest.reason}.`);
  }
} catch (error) {
  console.error(`CloudKit helper desktop resource preparation failed: ${error?.message || error}`);
  process.exitCode = 1;
}
