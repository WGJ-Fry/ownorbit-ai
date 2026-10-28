import type express from "express";
import { redactAuditString } from "./audit";
import { getConfiguredPublicBaseUrl, getConfiguredPublicOrigin } from "./publicBaseUrl";

type RateBucket = {
  count: number;
  resetAt: number;
};

const buckets = new Map<string, RateBucket>();
const MAX_RATE_LIMIT_BUCKETS = 5_000;
const RATE_LIMIT_SWEEP_INTERVAL_MS = 30_000;
let lastRateLimitSweepAt = 0;
const API_ERROR_TEXT_KEY = /^(error|message|detail|details|reason|lastError)$/i;

function pruneRateLimitBuckets(now: number) {
  if (buckets.size < MAX_RATE_LIMIT_BUCKETS && now - lastRateLimitSweepAt < RATE_LIMIT_SWEEP_INTERVAL_MS) return;
  for (const [key, bucket] of buckets) {
    if (bucket.resetAt <= now) buckets.delete(key);
  }
  if (buckets.size > MAX_RATE_LIMIT_BUCKETS) {
    const overflow = buckets.size - MAX_RATE_LIMIT_BUCKETS;
    const oldest = Array.from(buckets.entries())
      .sort((left, right) => left[1].resetAt - right[1].resetAt)
      .slice(0, overflow);
    for (const [key] of oldest) buckets.delete(key);
  }
  lastRateLimitSweepAt = now;
}

export function getCookie(req: express.Request, name: string) {
  const cookieHeader = req.headers.cookie || "";
  for (const cookie of cookieHeader.split(";")) {
    const [rawName, ...rawValue] = cookie.trim().split("=");
    if (rawName === name) return decodeURIComponent(rawValue.join("="));
  }
  return null;
}

export function setHttpOnlyCookie(res: express.Response, name: string, value: string, expiresAt: number) {
  const secure = process.env.LIFEOS_COOKIE_SECURE === "true" || getConfiguredPublicBaseUrl().startsWith("https://");
  const parts = [
    `${name}=${encodeURIComponent(value)}`,
    "Path=/",
    "HttpOnly",
    "SameSite=Lax",
    `Expires=${new Date(expiresAt).toUTCString()}`,
  ];
  if (secure) parts.push("Secure");
  const existing = res.getHeader("Set-Cookie");
  const cookie = parts.join("; ");
  if (Array.isArray(existing)) res.setHeader("Set-Cookie", [...existing, cookie]);
  else if (existing) res.setHeader("Set-Cookie", [String(existing), cookie]);
  else res.setHeader("Set-Cookie", cookie);
}

export function setClientCookie(res: express.Response, name: string, value: string, expiresAt: number) {
  const secure = process.env.LIFEOS_COOKIE_SECURE === "true" || getConfiguredPublicBaseUrl().startsWith("https://");
  const parts = [`${name}=${encodeURIComponent(value)}`, "Path=/", "SameSite=Lax", `Expires=${new Date(expiresAt).toUTCString()}`];
  if (secure) parts.push("Secure");
  const existing = res.getHeader("Set-Cookie");
  const cookie = parts.join("; ");
  if (Array.isArray(existing)) res.setHeader("Set-Cookie", [...existing, cookie]);
  else if (existing) res.setHeader("Set-Cookie", [String(existing), cookie]);
  else res.setHeader("Set-Cookie", cookie);
}

export function clearHttpOnlyCookie(res: express.Response, name: string) {
  const existing = res.getHeader("Set-Cookie");
  const cookie = `${name}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`;
  if (Array.isArray(existing)) res.setHeader("Set-Cookie", [...existing, cookie]);
  else if (existing) res.setHeader("Set-Cookie", [String(existing), cookie]);
  else res.setHeader("Set-Cookie", cookie);
}

export function getClientIp(req: express.Request) {
  const forwarded = process.env.LIFEOS_TRUST_PROXY === "1" ? String(req.headers["x-forwarded-for"] || "").split(",")[0].trim() : "";
  return forwarded || req.socket.remoteAddress || "unknown";
}

export function rateLimit(options: { windowMs: number; max: number; keyPrefix: string }) {
  return (req: express.Request, res: express.Response, next: express.NextFunction) => {
    const ip = getClientIp(req);
    const key = `${options.keyPrefix}:${ip}`;
    const now = Date.now();
    pruneRateLimitBuckets(now);
    const existing = buckets.get(key);
    const bucket = existing && existing.resetAt > now ? existing : { count: 0, resetAt: now + options.windowMs };

    bucket.count += 1;
    buckets.set(key, bucket);

    if (bucket.count > options.max) {
      res.setHeader("Retry-After", String(Math.ceil((bucket.resetAt - now) / 1000)));
      return res.status(429).json({ error: "Too many requests, please try again later" });
    }

    next();
  };
}

export function requestOriginAllowed(req: express.Request) {
  const origin = req.headers.origin;
  if (!origin) return true;
  const allowedOrigins = new Set<string>();
  const host = req.get("host");
  if (host) {
    allowedOrigins.add(`${req.protocol}://${host}`);
    allowedOrigins.add(`http://${host}`);
    allowedOrigins.add(`https://${host}`);
  }
  const publicBaseUrl = getConfiguredPublicBaseUrl();
  const publicOrigin = getConfiguredPublicOrigin();
  if (publicBaseUrl) allowedOrigins.add(publicBaseUrl.replace(/\/$/, ""));
  if (publicOrigin) allowedOrigins.add(publicOrigin);
  return allowedOrigins.has(origin.replace(/\/$/, ""));
}

export function securityHeaders(_req: express.Request, res: express.Response, next: express.NextFunction) {
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("Referrer-Policy", "same-origin");
  res.setHeader("Permissions-Policy", "camera=(), geolocation=(), microphone=()");
  res.setHeader("X-Frame-Options", "DENY");
  next();
}

export function redactApiErrorPayload(value: unknown, key = ""): unknown {
  if (Array.isArray(value)) return value.map((item) => redactApiErrorPayload(item, key));
  if (typeof value === "string") return API_ERROR_TEXT_KEY.test(key) ? redactAuditString(value) : value;
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(Object.entries(value as Record<string, unknown>).map(([entryKey, item]) => [
    entryKey,
    redactApiErrorPayload(item, entryKey),
  ]));
}

export function redactApiErrorResponses(req: express.Request, res: express.Response, next: express.NextFunction) {
  if (!req.path.startsWith("/api/")) return next();
  const originalJson = res.json.bind(res);
  res.json = ((body?: any) => originalJson(redactApiErrorPayload(body))) as typeof res.json;
  next();
}

export function requireCsrf(req: express.Request, res: express.Response, next: express.NextFunction) {
  if (["GET", "HEAD", "OPTIONS"].includes(req.method)) return next();
  if (!getCookie(req, "lifeos_admin_session")) return next();
  if (!requestOriginAllowed(req)) {
    return res.status(403).json({ error: "Origin validation failed" });
  }
  const cookieToken = getCookie(req, "lifeos_csrf");
  const headerToken = String(req.headers["x-lifeos-csrf"] || "");
  if (!cookieToken || !headerToken || cookieToken !== headerToken) {
    return res.status(403).json({ error: "CSRF validation failed" });
  }
  next();
}

export function apiRequestErrorHandler(error: any, req: express.Request, res: express.Response, next: express.NextFunction) {
  if (error?.type === "entity.too.large" || error?.status === 413) {
    return res.status(413).json({ error: "Request body is too large" });
  }
  if (error instanceof SyntaxError && "body" in error) {
    return res.status(400).json({ error: "Request body is not valid JSON" });
  }
  next(error);
}
