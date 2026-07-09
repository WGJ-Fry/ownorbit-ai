import crypto from "crypto";
import { redactAuditString } from "./audit";
import { getClientState, setClientState } from "./clientState";

const ICLOUD_REPAIR_IMPORTS_KEY = "lifeos_icloud_repair_imports";
const MAX_REPAIR_IMPORTS = 5;

export type IcloudRepairImportRecord = {
  id: string;
  importedAt: number;
  reason: string;
  severity: "ok" | "warning" | "danger";
  parsed: {
    status: string;
    action: string;
    oneNextAction: string;
    entryBaseUrl: string;
    currentBaseUrl: string;
    mode: string;
    stability: string;
    label: string;
    generatedAt: number;
    expiresAt: number;
    lastConnectivityOk: boolean | null;
    lastConnectivityError: string;
  };
  desktop: {
    desktopId: string;
    desktopName: string;
    recommendedBaseUrl: string;
    lastExportedBaseUrl: string;
    handoffStatus: string;
    handoffNeedsRefresh: boolean;
    remoteReadiness: string;
    recommendedMode: string;
    recommendedStability: string;
  };
  recommendations: Array<{
    id: string;
    severity: "ok" | "warning" | "danger";
    detail: string;
  }>;
  nextAction: {
    id: string;
    severity: "ok" | "warning" | "danger";
    detail: string;
  };
};

function cleanUrl(value: unknown) {
  const raw = String(value || "").trim();
  if (!raw) return "";
  try {
    const url = new URL(raw);
    url.username = "";
    url.password = "";
    url.search = "";
    url.hash = "";
    const pathname = url.pathname.replace(/\/+$/, "");
    return `${url.origin}${pathname === "/" ? "" : pathname}`.replace(/\/$/, "");
  } catch {
    return redactAuditString(raw).slice(0, 240);
  }
}

function safeText(value: unknown, maxLength = 160) {
  return redactAuditString(String(value || ""))
    .replace(/\b(api[-_]?key|token|secret|password|passphrase|authorization|cookie)=\S+/gi, "$1=[redacted]")
    .slice(0, maxLength);
}

function safeTime(value: unknown) {
  const numeric = Number(value || 0);
  return Number.isFinite(numeric) && numeric > 0 ? numeric : 0;
}

function safeSeverity(value: unknown): "ok" | "warning" | "danger" {
  return value === "ok" || value === "warning" || value === "danger" ? value : "warning";
}

const NEXT_ACTION_PRIORITY = [
  "refresh-icloud",
  "regenerate-qr",
  "start-tailscale",
  "start-cloudflare",
  "save-stable-entry",
  "open-latest-entry",
  "test-phone-entry",
  "cleanup-old-entry",
  "ready",
];

function normalizeRecommendation(value: unknown) {
  const item = value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
  return {
    id: safeText(item.id, 80),
    severity: safeSeverity(item.severity),
    detail: safeText(item.detail, 220),
  };
}

function chooseNextAction(recommendations: Array<{ id: string; severity: "ok" | "warning" | "danger"; detail: string }>, input: unknown) {
  const normalizedInput = normalizeRecommendation(input);
  if (normalizedInput.id) return normalizedInput;
  for (const id of NEXT_ACTION_PRIORITY) {
    const recommendation = recommendations.find((item) => item.id === id);
    if (recommendation) return recommendation;
  }
  return recommendations[0] || {
    id: "ready",
    severity: "ok" as const,
    detail: "The phone repair info matches the current desktop entry.",
  };
}

function normalizeRecord(value: unknown): IcloudRepairImportRecord | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const item = value as Record<string, any>;
  const parsed = item.parsed && typeof item.parsed === "object" ? item.parsed : {};
  const desktop = item.desktop && typeof item.desktop === "object" ? item.desktop : {};
  const recommendations = (Array.isArray(item.recommendations) ? item.recommendations : [])
    .slice(0, 8)
    .map(normalizeRecommendation);
  return {
    id: safeText(item.id || crypto.randomUUID(), 80),
    importedAt: safeTime(item.importedAt),
    reason: safeText(item.reason || "unknown", 80),
    severity: safeSeverity(item.severity),
    parsed: {
      status: safeText(parsed.status, 80),
      action: safeText(parsed.action, 140),
      oneNextAction: safeText(parsed.oneNextAction, 80),
      entryBaseUrl: cleanUrl(parsed.entryBaseUrl),
      currentBaseUrl: cleanUrl(parsed.currentBaseUrl),
      mode: safeText(parsed.mode, 40),
      stability: safeText(parsed.stability, 40),
      label: safeText(parsed.label, 100),
      generatedAt: safeTime(parsed.generatedAt),
      expiresAt: safeTime(parsed.expiresAt),
      lastConnectivityOk: typeof parsed.lastConnectivityOk === "boolean" ? parsed.lastConnectivityOk : null,
      lastConnectivityError: safeText(parsed.lastConnectivityError, 200),
    },
    desktop: {
      desktopId: safeText(desktop.desktopId, 120),
      desktopName: safeText(desktop.desktopName, 120),
      recommendedBaseUrl: cleanUrl(desktop.recommendedBaseUrl),
      lastExportedBaseUrl: cleanUrl(desktop.lastExportedBaseUrl),
      handoffStatus: safeText(desktop.handoffStatus, 80),
      handoffNeedsRefresh: Boolean(desktop.handoffNeedsRefresh),
      remoteReadiness: safeText(desktop.remoteReadiness, 80),
      recommendedMode: safeText(desktop.recommendedMode, 40),
      recommendedStability: safeText(desktop.recommendedStability, 40),
    },
    recommendations,
    nextAction: chooseNextAction(recommendations, item.nextAction),
  };
}

export function getIcloudRepairImportRecords() {
  const value = getClientState(ICLOUD_REPAIR_IMPORTS_KEY)?.value;
  const records = Array.isArray(value) ? value.map(normalizeRecord).filter(Boolean) as IcloudRepairImportRecord[] : [];
  return records
    .filter((record) => record.importedAt > 0)
    .sort((a, b) => b.importedAt - a.importedAt)
    .slice(0, MAX_REPAIR_IMPORTS);
}

export function getLatestIcloudRepairImportRecord() {
  return getIcloudRepairImportRecords()[0] || null;
}

export function saveIcloudRepairImportAnalysis(analysis: any, actor?: { type: string; id: string }) {
  const record = normalizeRecord({
    id: crypto.randomUUID(),
    importedAt: Date.now(),
    reason: analysis?.reason,
    severity: analysis?.severity,
    parsed: analysis?.parsed,
    desktop: analysis?.desktop,
    recommendations: analysis?.recommendations,
    nextAction: analysis?.nextAction,
  });
  if (!record) throw new Error("Invalid iCloud repair analysis");
  const previous = getIcloudRepairImportRecords();
  const next = [
    record,
    ...previous.filter((item) => !(item.parsed.entryBaseUrl === record.parsed.entryBaseUrl && item.parsed.generatedAt === record.parsed.generatedAt && item.reason === record.reason)),
  ].slice(0, MAX_REPAIR_IMPORTS);
  setClientState(ICLOUD_REPAIR_IMPORTS_KEY, next, actor);
  return record;
}
