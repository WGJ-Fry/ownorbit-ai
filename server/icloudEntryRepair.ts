import type { DeviceIcloudHandoffEvent } from "./devices";

function eventTime(event?: DeviceIcloudHandoffEvent | null) {
  return Math.max(Number(event?.ignoredAt || 0), Number(event?.createdAt || 0));
}

function cleanBaseUrl(value?: string) {
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
    return raw.replace(/\/+$/, "");
  }
}

export function buildLatestIcloudEntryRepairSummary(input: {
  latestEntryOpenEvent?: DeviceIcloudHandoffEvent | null;
  latestIgnoredEntryEvent?: DeviceIcloudHandoffEvent | null;
  latestEntryIssueEvent?: DeviceIcloudHandoffEvent | null;
  recommendedBaseUrl?: string;
  lastExportedBaseUrl?: string;
  handoffNeedsRefresh?: boolean;
  phoneConfirmationAction?: string;
  pairingSessionAction?: string;
}) {
  const ignoredEvent = input.latestIgnoredEntryEvent || null;
  const issueEvent = input.latestEntryIssueEvent || null;
  const openEvent = input.latestEntryOpenEvent || null;
  const issueAt = eventTime(issueEvent);
  const ignoredAt = eventTime(ignoredEvent);
  const openAt = eventTime(openEvent);
  const problemEvent = issueAt >= ignoredAt ? issueEvent : ignoredEvent;
  const problemAt = Math.max(issueAt, ignoredAt);
  const latestOpenConfirmsCurrentEntry = Boolean(openEvent && openEvent.eventType === "opened-current-entry" && openAt >= problemAt);
  const activeProblemEvent = Boolean(problemEvent && problemAt >= openAt && !latestOpenConfirmsCurrentEntry);
  const recommendedBaseUrl = cleanBaseUrl(input.recommendedBaseUrl || input.lastExportedBaseUrl || "");
  const lastExportedBaseUrl = cleanBaseUrl(input.lastExportedBaseUrl || "");
  const event = activeProblemEvent ? problemEvent : openEvent || problemEvent || null;
  const eventEntryBaseUrl = cleanBaseUrl(event?.entryBaseUrl || "");
  const mismatchWithRecommended = Boolean(!latestOpenConfirmsCurrentEntry && eventEntryBaseUrl && recommendedBaseUrl && eventEntryBaseUrl !== recommendedBaseUrl);
  const needsQr = (!latestOpenConfirmsCurrentEntry && input.pairingSessionAction === "regenerate-qr") || activeProblemEvent;
  const needsRefresh = Boolean(
    activeProblemEvent ||
    (!latestOpenConfirmsCurrentEntry && input.handoffNeedsRefresh) ||
    (!latestOpenConfirmsCurrentEntry && input.phoneConfirmationAction === "refresh-entry") ||
    mismatchWithRecommended,
  );

  if (activeProblemEvent && problemEvent) {
    const status = problemEvent.eventType === "ignored-superseded-entry" ? "old-entry-opened" as const : "problem-entry-opened" as const;
    return {
      status,
      severity: problemEvent.eventType === "opened-expired-entry" || problemEvent.eventType === "opened-address-mismatch-entry" ? "danger" as const : "warning" as const,
      action: needsQr ? "refresh-and-regenerate-qr" as const : "refresh-icloud" as const,
      eventId: problemEvent.id,
      eventType: problemEvent.eventType,
      deviceId: problemEvent.deviceId,
      deviceName: problemEvent.deviceName || "",
      deviceType: problemEvent.deviceType || "",
      eventAt: problemAt,
      entryBaseUrl: eventEntryBaseUrl,
      currentBaseUrl: cleanBaseUrl(problemEvent.currentBaseUrl),
      storedBaseUrl: cleanBaseUrl(problemEvent.storedBaseUrl),
      recommendedBaseUrl,
      lastExportedBaseUrl,
      entryGeneratedAt: Number(problemEvent.entryGeneratedAt || 0),
      storedGeneratedAt: Number(problemEvent.storedGeneratedAt || 0),
      checksumPresent: Boolean(problemEvent.checksumSha256),
      needsRefresh: true,
      needsQr,
      reason: status,
    };
  }

  if (needsRefresh) {
    return {
      status: "needs-refresh" as const,
      severity: "warning" as const,
      action: needsQr ? "refresh-and-regenerate-qr" as const : "refresh-icloud" as const,
      eventId: event?.id || "",
      eventType: event?.eventType || "",
      deviceId: event?.deviceId || "",
      deviceName: event?.deviceName || "",
      deviceType: event?.deviceType || "",
      eventAt: eventTime(event),
      entryBaseUrl: eventEntryBaseUrl,
      currentBaseUrl: cleanBaseUrl(event?.currentBaseUrl || ""),
      storedBaseUrl: cleanBaseUrl(event?.storedBaseUrl || ""),
      recommendedBaseUrl,
      lastExportedBaseUrl,
      entryGeneratedAt: Number(event?.entryGeneratedAt || 0),
      storedGeneratedAt: Number(event?.storedGeneratedAt || 0),
      checksumPresent: Boolean(event?.checksumSha256),
      needsRefresh: true,
      needsQr,
      reason: mismatchWithRecommended ? "entry-address-mismatch" : "desktop-entry-needs-refresh",
    };
  }

  if (openEvent) {
    return {
      status: "current-entry-opened" as const,
      severity: "ok" as const,
      action: "none" as const,
      eventId: openEvent.id,
      eventType: openEvent.eventType,
      deviceId: openEvent.deviceId,
      deviceName: openEvent.deviceName || "",
      deviceType: openEvent.deviceType || "",
      eventAt: openAt,
      entryBaseUrl: eventEntryBaseUrl,
      currentBaseUrl: cleanBaseUrl(openEvent.currentBaseUrl),
      storedBaseUrl: cleanBaseUrl(openEvent.storedBaseUrl),
      recommendedBaseUrl,
      lastExportedBaseUrl,
      entryGeneratedAt: Number(openEvent.entryGeneratedAt || 0),
      storedGeneratedAt: Number(openEvent.storedGeneratedAt || 0),
      checksumPresent: Boolean(openEvent.checksumSha256),
      needsRefresh: false,
      needsQr: false,
      reason: "phone-opened-current-entry",
    };
  }

  return {
    status: "none" as const,
    severity: "warning" as const,
    action: "open-on-phone" as const,
    eventId: "",
    eventType: "",
    deviceId: "",
    deviceName: "",
    deviceType: "",
    eventAt: 0,
    entryBaseUrl: "",
    currentBaseUrl: "",
    storedBaseUrl: "",
    recommendedBaseUrl,
    lastExportedBaseUrl,
    entryGeneratedAt: 0,
    storedGeneratedAt: 0,
    checksumPresent: false,
    needsRefresh: false,
    needsQr: false,
    reason: "no-phone-open-event",
  };
}
