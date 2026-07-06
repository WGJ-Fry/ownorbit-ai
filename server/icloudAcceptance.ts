import type { RemoteAcceptanceRecord } from "./remoteAcceptance";

const ICLOUD_ACCEPTANCE_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;

export type IcloudAcceptanceItemId =
  | "icloud-entry-synced"
  | "phone-opened-current-entry"
  | "pairing-qr-current"
  | "cellular-mobile-chat"
  | "network-switch"
  | "old-entry-repair";

export type IcloudAcceptanceItem = {
  id: IcloudAcceptanceItemId;
  status: "passed" | "needs-action" | "manual-required";
  severity: "ok" | "warning" | "danger";
  evidence: string;
  action: "export-icloud-entry" | "open-on-phone" | "regenerate-qr" | "record-real-world-check" | "ready";
  acceptedAt?: number;
  expiresAt?: number;
};

export type IcloudAcceptanceSummary = {
  ready: boolean;
  generatedAt: number;
  passed: number;
  total: number;
  needsAction: number;
  manualRequired: number;
  recommendedAction: IcloudAcceptanceItem["action"];
  nextReviewAt?: number;
  items: IcloudAcceptanceItem[];
};

type IcloudLike = {
  recommendedBaseUrl?: string;
  syncReadiness?: { status?: string; canOpenOnPhone?: boolean };
  handoffHealth?: {
    status?: string;
    lastExportedAt?: number;
    lastExportedBaseUrl?: string;
    expiresAt?: number;
    htmlConsistency?: { ok?: boolean };
  };
  indexConsistency?: { ok?: boolean };
  phoneConfirmation?: {
    status?: string;
    confirmedAt?: number;
    confirmedDeviceName?: string;
    confirmedDeviceId?: string;
  };
  pairingSession?: {
    status?: string;
    expiresAt?: number;
    secondsRemaining?: number;
  };
  latestEntryOpenEvent?: {
    eventType?: string;
    entryBaseUrl?: string;
    createdAt?: number;
    ignoredAt?: number;
  } | null;
  latestEntryIssueEvent?: {
    eventType?: string;
    entryBaseUrl?: string;
    createdAt?: number;
    ignoredAt?: number;
  } | null;
  latestIgnoredEntryEvent?: {
    eventType?: string;
    entryBaseUrl?: string;
    createdAt?: number;
    ignoredAt?: number;
  } | null;
};

function normalizeBaseUrl(value = "") {
  try {
    const parsed = new URL(value);
    parsed.username = "";
    parsed.password = "";
    parsed.search = "";
    parsed.hash = "";
    return parsed.toString().replace(/\/$/, "");
  } catch {
    return String(value || "").replace(/\/$/, "");
  }
}

function sameBaseUrl(left = "", right = "") {
  const normalizedLeft = normalizeBaseUrl(left);
  const normalizedRight = normalizeBaseUrl(right);
  return Boolean(normalizedLeft && normalizedRight && normalizedLeft === normalizedRight);
}

function latestRemoteRecord(records: RemoteAcceptanceRecord[], id: string, baseUrl: string, now: number) {
  const record = records
    .filter((item) => item.id === id && sameBaseUrl(item.baseUrl, baseUrl))
    .sort((left, right) => right.createdAt - left.createdAt)[0] || null;
  if (!record) return null;
  return now - record.createdAt <= ICLOUD_ACCEPTANCE_MAX_AGE_MS ? record : null;
}

function eventTime(event?: { createdAt?: number; ignoredAt?: number } | null) {
  return Number(event?.ignoredAt || event?.createdAt || 0);
}

function manualItem(
  id: Extract<IcloudAcceptanceItemId, "cellular-mobile-chat" | "network-switch" | "old-entry-repair">,
  record: RemoteAcceptanceRecord | null,
  actionEvidence: string,
): IcloudAcceptanceItem {
  if (record) {
    return {
      id,
      status: "passed",
      severity: "ok",
      evidence: record.note || `Accepted at ${new Date(record.createdAt).toISOString()}.`,
      action: "ready",
      acceptedAt: record.createdAt,
      expiresAt: record.createdAt + ICLOUD_ACCEPTANCE_MAX_AGE_MS,
    };
  }
  return {
    id,
    status: "manual-required",
    severity: "warning",
    evidence: actionEvidence,
    action: "record-real-world-check",
  };
}

export function buildIcloudAcceptanceSummary(input: {
  icloud: IcloudLike;
  remoteAcceptanceRecords?: RemoteAcceptanceRecord[];
  now?: number;
}): IcloudAcceptanceSummary {
  const now = input.now || Date.now();
  const icloud = input.icloud || {};
  const baseUrl = normalizeBaseUrl(icloud.recommendedBaseUrl || icloud.handoffHealth?.lastExportedBaseUrl || "");
  const records = input.remoteAcceptanceRecords || [];
  const entrySynced = Boolean(
    icloud.syncReadiness?.status === "ready" &&
    icloud.syncReadiness?.canOpenOnPhone &&
    icloud.handoffHealth?.status === "fresh" &&
    icloud.handoffHealth?.htmlConsistency?.ok &&
    icloud.indexConsistency?.ok
  );
  const phoneConfirmed = icloud.phoneConfirmation?.status === "confirmed";
  const qrCurrent = icloud.pairingSession?.status === "ready" || icloud.pairingSession?.status === "confirmed";
  const issueEvent = eventTime(icloud.latestEntryIssueEvent) >= eventTime(icloud.latestIgnoredEntryEvent)
    ? icloud.latestEntryIssueEvent
    : icloud.latestIgnoredEntryEvent;
  const issueEventAt = eventTime(issueEvent);
  const oldEntryRecord = latestRemoteRecord(records, "stale-qr-repair", baseUrl, now);
  const oldEntryEvidencePassed = Boolean(
    oldEntryRecord ||
    (issueEventAt > 0 && (!icloud.handoffHealth?.lastExportedAt || issueEventAt >= Number(icloud.handoffHealth.lastExportedAt)))
  );

  const items: IcloudAcceptanceItem[] = [
    entrySynced
      ? {
        id: "icloud-entry-synced",
        status: "passed",
        severity: "ok",
        evidence: `Fresh iCloud entry exported for ${baseUrl || "current mobile entry"}.`,
        action: "ready",
        acceptedAt: icloud.handoffHealth?.lastExportedAt,
        expiresAt: icloud.handoffHealth?.expiresAt,
      }
      : {
        id: "icloud-entry-synced",
        status: "needs-action",
        severity: icloud.syncReadiness?.status === "sync-stuck" ? "danger" : "warning",
        evidence: "The iCloud entry is missing, stale, still syncing, or the HTML/JSON files do not match.",
        action: "export-icloud-entry",
      },
    phoneConfirmed
      ? {
        id: "phone-opened-current-entry",
        status: "passed",
        severity: "ok",
        evidence: `${icloud.phoneConfirmation?.confirmedDeviceName || icloud.phoneConfirmation?.confirmedDeviceId || "Phone"} opened the current iCloud entry.`,
        action: "ready",
        acceptedAt: icloud.phoneConfirmation?.confirmedAt,
      }
      : {
        id: "phone-opened-current-entry",
        status: "needs-action",
        severity: "warning",
        evidence: "No phone has reported opening the current iCloud entry yet.",
        action: "open-on-phone",
      },
    qrCurrent
      ? {
        id: "pairing-qr-current",
        status: "passed",
        severity: "ok",
        evidence: icloud.pairingSession?.status === "confirmed" ? "The latest QR already bound a phone." : "The latest QR still matches the recommended iCloud entry.",
        action: "ready",
        expiresAt: icloud.pairingSession?.expiresAt,
      }
      : {
        id: "pairing-qr-current",
        status: "needs-action",
        severity: icloud.pairingSession?.status === "expired" ? "danger" : "warning",
        evidence: "The current QR is missing, expired, or was created for a different mobile entry.",
        action: "regenerate-qr",
      },
    manualItem("cellular-mobile-chat", latestRemoteRecord(records, "cellular-mobile-chat", baseUrl, now), "Use a real iPhone on cellular data, open the iCloud entry, and send one mobile chat message."),
    manualItem("network-switch", latestRemoteRecord(records, "network-switch", baseUrl, now), "Switch the phone between Wi-Fi and cellular while using the iCloud entry, then confirm chat reconnects."),
    oldEntryEvidencePassed
      ? {
        id: "old-entry-repair",
        status: "passed",
        severity: "ok",
        evidence: oldEntryRecord?.note || `${issueEvent?.eventType || "old-entry"} was reported by a phone for ${issueEvent?.entryBaseUrl || "a previous entry"}.`,
        action: "ready",
        acceptedAt: oldEntryRecord?.createdAt || issueEventAt,
        expiresAt: oldEntryRecord ? oldEntryRecord.createdAt + ICLOUD_ACCEPTANCE_MAX_AGE_MS : undefined,
      }
      : {
        id: "old-entry-repair",
        status: "manual-required",
        severity: "warning",
        evidence: "Open an old iCloud entry or old home-screen entry once, then verify the desktop suggests refreshing/rebinding safely.",
        action: "record-real-world-check",
      },
  ];

  const passed = items.filter((item) => item.status === "passed").length;
  const needsAction = items.filter((item) => item.status === "needs-action").length;
  const manualRequired = items.filter((item) => item.status === "manual-required").length;
  const firstOpenAction = items.find((item) => item.status !== "passed")?.action || "ready";
  const nextReviewAt = Math.min(
    ...items
      .map((item) => item.expiresAt || 0)
      .filter((value) => value > now),
  );
  return {
    ready: passed === items.length,
    generatedAt: now,
    passed,
    total: items.length,
    needsAction,
    manualRequired,
    recommendedAction: firstOpenAction,
    nextReviewAt: Number.isFinite(nextReviewAt) ? nextReviewAt : undefined,
    items,
  };
}
