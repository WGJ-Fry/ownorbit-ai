#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { WebSocket } from "ws";

const DEFAULT_TIMEOUT_MS = 10_000;

export function normalizeRemoteBaseUrl(value) {
  const raw = String(value || "").trim();
  if (!raw) throw new Error("Remote base URL is required. Pass it as an argument or LIFEOS_REMOTE_BASE_URL.");
  let parsed;
  try {
    parsed = new URL(raw);
  } catch {
    throw new Error("Remote base URL must be a valid HTTP/HTTPS URL.");
  }
  if (!["http:", "https:"].includes(parsed.protocol)) {
    throw new Error("Remote base URL must use HTTP or HTTPS.");
  }
  if (parsed.username || parsed.password) {
    throw new Error("Remote base URL must not include username or password.");
  }
  if (parsed.search || parsed.hash) {
    throw new Error("Remote base URL must not include query parameters or fragments.");
  }
  parsed.search = "";
  parsed.hash = "";
  const pathname = parsed.pathname === "/" ? "" : parsed.pathname.replace(/\/+$/, "");
  return `${parsed.origin}${pathname}`;
}

function desktopRuntimeConfigPath() {
  return path.join(process.env.LIFEOS_DATA_DIR || path.join(process.cwd(), "data"), "desktop-runtime-config.json");
}

export function resolveRemoteBaseUrl(inputUrl, env = process.env) {
  const direct = String(inputUrl || "").trim();
  if (direct) return normalizeRemoteBaseUrl(direct);
  const fromEnv = String(env.LIFEOS_REMOTE_BASE_URL || env.PUBLIC_BASE_URL || env.APP_URL || "").trim();
  if (fromEnv) return normalizeRemoteBaseUrl(fromEnv);

  const configPath = env.LIFEOS_DESKTOP_RUNTIME_CONFIG || desktopRuntimeConfigPath();
  if (!fs.existsSync(configPath)) {
    throw new Error("Remote base URL is required. Pass it as an argument, set LIFEOS_REMOTE_BASE_URL, or save a remote entry in the desktop connection guide.");
  }
  let config;
  try {
    config = JSON.parse(fs.readFileSync(configPath, "utf8"));
  } catch {
    throw new Error(`Desktop runtime config is not readable JSON: ${configPath}`);
  }
  const mode = String(config?.mode || "");
  const configuredUrl = String(config?.publicBaseUrl || config?.baseUrl || "").trim();
  if (!configuredUrl || mode === "local" || mode === "lan") {
    throw new Error("Saved desktop connection config is local/LAN only. Save a Tailscale, Cloudflare, or trusted HTTPS remote entry first.");
  }
  return normalizeRemoteBaseUrl(configuredUrl);
}

function joinUrl(baseUrl, suffix) {
  return `${baseUrl}${suffix}`;
}

function websocketUrl(baseUrl, suffix) {
  const parsed = new URL(joinUrl(baseUrl, suffix));
  parsed.protocol = parsed.protocol === "https:" ? "wss:" : "ws:";
  return parsed.toString();
}

export function classifyRemoteEntry(baseUrl) {
  const parsed = new URL(baseUrl);
  const host = parsed.hostname.toLowerCase();
  if (host === "localhost" || host === "127.0.0.1" || host === "::1") {
    return { entryKind: "local", longTermCandidate: false, longTermReason: "Localhost is only reachable on the desktop and cannot be a long-term phone entry." };
  }
  if (parsed.protocol !== "https:") {
    return { entryKind: "insecure-http", longTermCandidate: false, longTermReason: "Long-term remote entries must use HTTPS for PWA, WebCrypto, and WebSocket reliability." };
  }
  if (host.endsWith(".trycloudflare.com")) {
    return { entryKind: "temporary-cloudflare", longTermCandidate: false, longTermReason: "Temporary trycloudflare.com tunnels are for testing only and can change after restart." };
  }
  if (host.endsWith(".ts.net") || host.includes(".tailscale")) {
    return { entryKind: "tailscale-https", longTermCandidate: true, longTermReason: "Tailscale HTTPS Serve is a recommended long-term remote entry." };
  }
  return { entryKind: "stable-https", longTermCandidate: true, longTermReason: "This is an HTTPS non-temporary remote entry; confirm the domain is controlled and restart recovery works." };
}

function evaluateHttpsStatus(baseUrl, steps = []) {
  const parsed = new URL(baseUrl);
  const https = parsed.protocol === "https:";
  const tlsError = steps.find((step) => step.url?.startsWith("https://") && !step.ok && /certificate|cert|tls|ssl|self-signed/i.test(step.error || ""));
  return {
    ok: https && !tlsError,
    protocol: parsed.protocol.replace(":", ""),
    requiredForLongTerm: true,
    trustedByRuntime: https && !tlsError,
    error: !https ? "Remote smoke is not using HTTPS." : tlsError?.error,
  };
}

async function probeFetchStep(baseUrl, suffix, validate, timeoutMs) {
  const url = joinUrl(baseUrl, suffix);
  const startedAt = Date.now();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs).unref();
  try {
    const response = await fetch(url, {
      cache: "no-store",
      redirect: "follow",
      signal: controller.signal,
    });
    const text = await response.text();
    const valid = validate(response, text);
    return {
      ok: response.ok && valid.ok,
      status: response.status,
      url,
      latencyMs: Date.now() - startedAt,
      error: response.ok ? valid.error : `HTTP ${response.status}`,
    };
  } catch (error) {
    return {
      ok: false,
      status: 0,
      url,
      latencyMs: Date.now() - startedAt,
      error: error?.name === "AbortError" ? "Timed out" : error?.message || "Fetch failed",
    };
  } finally {
    clearTimeout(timer);
  }
}

function probeWebSocketOnce(baseUrl, timeoutMs) {
  const url = websocketUrl(baseUrl, "/api/v1/ws");
  const startedAt = Date.now();
  return new Promise((resolve) => {
    let settled = false;
    const finish = (result) => {
      if (settled) return;
      settled = true;
      resolve({
        status: result.ok ? 101 : 0,
        url,
        latencyMs: Date.now() - startedAt,
        ...result,
      });
    };

    const ws = new WebSocket(url, {
      handshakeTimeout: timeoutMs,
      followRedirects: true,
    });
    const timer = setTimeout(() => {
      try {
        ws.terminate();
      } catch {}
      finish({ ok: false, error: "Timed out" });
    }, timeoutMs).unref();

    ws.once("open", () => {
      clearTimeout(timer);
      try {
        ws.close(1000, "remote-smoke-ok");
      } catch {}
      finish({ ok: true });
    });
    ws.once("error", (error) => {
      clearTimeout(timer);
      finish({ ok: false, error: error?.message || "WebSocket failed" });
    });
  });
}

async function probeWebSocketStep(baseUrl, timeoutMs) {
  const first = await probeWebSocketOnce(baseUrl, timeoutMs);
  if (first.ok) return first;
  await new Promise((resolve) => setTimeout(resolve, 750));
  const second = await probeWebSocketOnce(baseUrl, timeoutMs);
  if (second.ok) {
    return {
      ...second,
      latencyMs: first.latencyMs + 750 + second.latencyMs,
      retried: true,
      firstError: first.error,
    };
  }
  return {
    ...second,
    latencyMs: first.latencyMs + 750 + second.latencyMs,
    retried: true,
    firstError: first.error,
    error: second.error || first.error,
  };
}

export async function runRemoteConnectionSmoke(inputUrl, options = {}) {
  const timeoutMs = Number.parseInt(String(options.timeoutMs || process.env.LIFEOS_REMOTE_SMOKE_TIMEOUT_MS || DEFAULT_TIMEOUT_MS), 10);
  const baseUrl = resolveRemoteBaseUrl(inputUrl, options.env || process.env);
  const startedAt = Date.now();
  const steps = [];

  steps.push(await probeFetchStep(
    baseUrl,
    "/api/v1/health",
    (_response, text) => {
      try {
        const parsed = JSON.parse(text);
        return parsed?.service === "lifeos-local-core"
          ? { ok: true }
          : { ok: false, error: "Health response is not OwnOrbit local core." };
      } catch {
        return { ok: false, error: "Health response is not JSON." };
      }
    },
    timeoutMs,
  ));

  steps.push(await probeFetchStep(
    baseUrl,
    "/mobile/chat",
    (_response, text) => {
      const looksLikeShell = /<div id=["']root["']/.test(text) || /OwnOrbit AI/i.test(text);
      return looksLikeShell ? { ok: true } : { ok: false, error: "Mobile shell did not render OwnOrbit." };
    },
    timeoutMs,
  ));

  steps.push(await probeWebSocketStep(baseUrl, timeoutMs));

  const ok = steps.every((step) => step.ok);
  const passed = steps.filter((step) => step.ok).length;
  const classification = classifyRemoteEntry(baseUrl);
  const httpsStatus = evaluateHttpsStatus(baseUrl, steps);
  return {
    ok,
    baseUrl,
    ...classification,
    httpsStatus,
    passed,
    total: steps.length,
    latencyMs: Date.now() - startedAt,
    steps,
  };
}

function printHuman(result) {
  const status = result.ok ? "PASS" : "FAIL";
  console.log(`[${status}] Remote connection ${result.passed}/${result.total} checks passed in ${result.latencyMs}ms`);
  console.log(`Base URL: ${result.baseUrl}`);
  console.log(`Entry kind: ${result.entryKind}`);
  console.log(`Long-term candidate: ${result.longTermCandidate ? "yes" : "no"} - ${result.longTermReason}`);
  console.log(`HTTPS status: ${result.httpsStatus.ok ? "ok" : "not ready"} (${result.httpsStatus.protocol}${result.httpsStatus.error ? `, ${result.httpsStatus.error}` : ""})`);
  for (const step of result.steps) {
    console.log(`- ${step.ok ? "PASS" : "FAIL"} ${step.url} (${step.latencyMs}ms${step.error ? `, ${step.error}` : ""})`);
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const remoteUrl = process.argv[2] || "";
  runRemoteConnectionSmoke(remoteUrl)
    .then((result) => {
      if (process.env.LIFEOS_REMOTE_SMOKE_JSON === "1") {
        console.log(JSON.stringify(result, null, 2));
      } else {
        printHuman(result);
      }
      if (!result.ok) process.exitCode = 1;
    })
    .catch((error) => {
      console.error(`[FAIL] ${error?.message || error}`);
      process.exitCode = 1;
    });
}
