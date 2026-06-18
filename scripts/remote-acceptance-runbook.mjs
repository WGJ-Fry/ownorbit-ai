#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { runRemoteConnectionSmoke } from "./remote-connection-smoke.mjs";

function parseArgs(argv) {
  const result = { url: "", out: "", json: false };
  for (let index = 0; index < argv.length; index += 1) {
    const value = argv[index];
    if (value === "--json") result.json = true;
    else if (value === "--out") result.out = argv[++index] || "";
    else if (!result.url) result.url = value;
  }
  return result;
}

function longTermStatus(kind, smoke) {
  if (!smoke.longTermCandidate) return { ok: false, reason: smoke.longTermReason };
  if (kind === "temporary-cloudflare") return { ok: false, reason: "Temporary trycloudflare.com entries are for testing only. Use Tailscale HTTPS Serve or Cloudflare Named Tunnel for long-term use." };
  if (!smoke.ok) return { ok: false, reason: "Remote smoke checks did not all pass." };
  return { ok: true, reason: "Remote entry is HTTPS, non-temporary, and passed automated smoke checks." };
}

function manualSteps(kind) {
  return [
    {
      id: "cellular-mobile-chat",
      title: "Phone cellular /mobile/chat",
      instruction: "Turn off phone Wi-Fi, open the saved mobile entry on cellular data, send one chat message, and confirm realtime/retry state is healthy.",
      required: true,
    },
    {
      id: "restart-restore",
      title: "Desktop restart restore",
      instruction: "Quit and reopen the desktop app, run the remote health check again, and confirm the same HTTPS entry still serves /api/v1/health, /mobile/chat, and WebSocket.",
      required: true,
    },
    {
      id: "network-interruption",
      title: "Network interruption recovery",
      instruction: kind === "tailscale-https"
        ? "Disconnect and reconnect Tailscale or network, then confirm the phone explains connection state and recovers without changing the QR entry."
        : "Restart the Tunnel/network path, confirm the desktop diagnostics refresh, and confirm the phone gets a clear recovery message.",
      required: true,
    },
    {
      id: "diagnostic-export",
      title: "Export diagnostic evidence",
      instruction: "Export the admin diagnostic bundle after the manual checks. It should include remote health, smoke report, acceptance checklist, and manual acceptance records.",
      required: true,
    },
  ];
}

export async function runRemoteAcceptanceRunbook(inputUrl, options = {}) {
  const smoke = await runRemoteConnectionSmoke(inputUrl, options);
  const kind = smoke.entryKind;
  const status = longTermStatus(kind, smoke);
  const manualAcceptance = manualSteps(kind);
  const realWorldAcceptanceRequired = manualAcceptance.some((step) => step.required);
  return {
    generatedAt: new Date().toISOString(),
    baseUrl: smoke.baseUrl,
    entryKind: kind,
    longTermReady: status.ok,
    longTermReason: status.reason,
    realWorldAcceptanceRequired,
    completionStatus: status.ok && realWorldAcceptanceRequired ? "automated-ready-manual-required" : status.ok ? "ready" : "not-ready",
    automatedChecks: {
      ok: smoke.ok,
      passed: smoke.passed,
      total: smoke.total,
      latencyMs: smoke.latencyMs,
      steps: smoke.steps,
    },
    manualAcceptance,
  };
}

function printHuman(report) {
  const label = report.completionStatus === "automated-ready-manual-required" ? "AUTOMATED READY, MANUAL CHECKS REQUIRED" : report.longTermReady ? "READY" : "NOT READY";
  console.log(`[${label}] Remote acceptance runbook`);
  console.log(`Base URL: ${report.baseUrl}`);
  console.log(`Entry kind: ${report.entryKind}`);
  console.log(`Reason: ${report.longTermReason}`);
  console.log(`Automated checks: ${report.automatedChecks.passed}/${report.automatedChecks.total}`);
  for (const step of report.automatedChecks.steps) {
    console.log(`- ${step.ok ? "PASS" : "FAIL"} ${step.url}${step.error ? ` (${step.error})` : ""}`);
  }
  console.log("Manual acceptance still required:");
  for (const step of report.manualAcceptance) {
    console.log(`- ${step.title}: ${step.instruction}`);
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const args = parseArgs(process.argv.slice(2));
  runRemoteAcceptanceRunbook(args.url)
    .then((report) => {
      const outPath = args.out || process.env.LIFEOS_REMOTE_ACCEPTANCE_OUT || "";
      if (outPath) {
        fs.mkdirSync(path.dirname(path.resolve(outPath)), { recursive: true });
        fs.writeFileSync(outPath, `${JSON.stringify(report, null, 2)}\n`, { mode: 0o600 });
      }
      if (args.json || process.env.LIFEOS_REMOTE_ACCEPTANCE_JSON === "1") console.log(JSON.stringify(report, null, 2));
      else printHuman(report);
      if (!report.automatedChecks.ok) process.exitCode = 1;
    })
    .catch((error) => {
      console.error(`[FAIL] ${error?.message || error}`);
      process.exitCode = 1;
    });
}
