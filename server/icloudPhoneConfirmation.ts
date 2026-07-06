import type { DeviceIcloudHandoffEvent } from "./devices";

type HandoffHealthLike = {
  status: string;
  needsRefresh: boolean;
  lastExportedAt: number;
  lastExportedBaseUrl: string;
};

type Input = {
  handoffHealth: HandoffHealthLike;
  recommendedBaseUrl?: string;
  latestEntryOpenEvent?: DeviceIcloudHandoffEvent | null;
  latestIgnoredEntryEvent?: DeviceIcloudHandoffEvent | null;
  latestEntryIssueEvent?: DeviceIcloudHandoffEvent | null;
};

function eventTime(event?: DeviceIcloudHandoffEvent | null) {
  return event?.ignoredAt || event?.createdAt || 0;
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

export function buildIcloudPhoneConfirmationStatus(input: Input) {
  const openEvent = input.latestEntryOpenEvent || null;
  const ignoredEvent = input.latestIgnoredEntryEvent || null;
  const issueEvent = input.latestEntryIssueEvent || null;
  const confirmedAt = eventTime(openEvent);
  const ignoredAt = eventTime(ignoredEvent);
  const issueAt = eventTime(issueEvent);
  const latestProblemEvent = issueAt >= ignoredAt ? issueEvent : ignoredEvent;
  const latestProblemAt = Math.max(issueAt, ignoredAt);
  const expectedEntryGeneratedAt = Number(input.handoffHealth?.lastExportedAt || 0);
  const exportedBaseUrl = cleanBaseUrl(input.handoffHealth?.lastExportedBaseUrl || "");
  const expectedBaseUrl = cleanBaseUrl(input.handoffHealth?.lastExportedBaseUrl || input.recommendedBaseUrl || "");
  const hasExpectedEntry = expectedEntryGeneratedAt > 0 || Boolean(exportedBaseUrl);
  const confirmedEntryBaseUrl = cleanBaseUrl(openEvent?.entryBaseUrl || "");
  const confirmedEntryGeneratedAt = Number(openEvent?.entryGeneratedAt || 0);

  if (!openEvent || !confirmedAt) {
    return {
      status: "missing" as const,
      severity: "warning" as const,
      action: "open-on-phone" as const,
      confirmedAt: 0,
      confirmedDeviceId: "",
      confirmedDeviceName: "",
      confirmedDeviceType: "",
      confirmedEntryBaseUrl: "",
      confirmedEntryGeneratedAt: 0,
      expectedEntryGeneratedAt,
      expectedBaseUrl,
      latestProblemAt,
      latestProblemEventType: latestProblemEvent?.eventType || "",
      latestProblemDeviceName: latestProblemEvent?.deviceName || "",
      reason: "No phone has confirmed opening the current iCloud entry yet.",
    };
  }

  if (latestProblemAt > confirmedAt) {
    return {
      status: "issue-after-confirm" as const,
      severity: issueEvent && issueAt >= ignoredAt ? "danger" as const : "warning" as const,
      action: "refresh-entry" as const,
      confirmedAt,
      confirmedDeviceId: openEvent.deviceId,
      confirmedDeviceName: openEvent.deviceName || "",
      confirmedDeviceType: openEvent.deviceType || "",
      confirmedEntryBaseUrl,
      confirmedEntryGeneratedAt,
      expectedEntryGeneratedAt,
      expectedBaseUrl,
      latestProblemAt,
      latestProblemEventType: latestProblemEvent?.eventType || "",
      latestProblemDeviceName: latestProblemEvent?.deviceName || "",
      reason: "A phone opened an old or problematic iCloud entry after the latest confirmation.",
    };
  }

  if (
    (hasExpectedEntry && input.handoffHealth?.needsRefresh) ||
    (expectedEntryGeneratedAt > 0 && confirmedEntryGeneratedAt > 0 && confirmedEntryGeneratedAt < expectedEntryGeneratedAt) ||
    (hasExpectedEntry && expectedBaseUrl && confirmedEntryBaseUrl && expectedBaseUrl !== confirmedEntryBaseUrl)
  ) {
    return {
      status: "stale" as const,
      severity: "warning" as const,
      action: "refresh-entry" as const,
      confirmedAt,
      confirmedDeviceId: openEvent.deviceId,
      confirmedDeviceName: openEvent.deviceName || "",
      confirmedDeviceType: openEvent.deviceType || "",
      confirmedEntryBaseUrl,
      confirmedEntryGeneratedAt,
      expectedEntryGeneratedAt,
      expectedBaseUrl,
      latestProblemAt,
      latestProblemEventType: latestProblemEvent?.eventType || "",
      latestProblemDeviceName: latestProblemEvent?.deviceName || "",
      reason: "The last phone confirmation does not match the current iCloud entry.",
    };
  }

  return {
    status: "confirmed" as const,
    severity: "ok" as const,
    action: "none" as const,
    confirmedAt,
    confirmedDeviceId: openEvent.deviceId,
    confirmedDeviceName: openEvent.deviceName || "",
    confirmedDeviceType: openEvent.deviceType || "",
    confirmedEntryBaseUrl,
    confirmedEntryGeneratedAt,
    expectedEntryGeneratedAt,
    expectedBaseUrl,
    latestProblemAt,
    latestProblemEventType: latestProblemEvent?.eventType || "",
    latestProblemDeviceName: latestProblemEvent?.deviceName || "",
    reason: "A phone has confirmed opening the current iCloud entry.",
  };
}
