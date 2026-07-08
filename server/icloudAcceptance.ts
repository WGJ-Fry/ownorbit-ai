import type { RemoteAcceptanceRecord } from "./remoteAcceptance";

const ICLOUD_ACCEPTANCE_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;

export type IcloudAcceptanceItemId =
  | "icloud-entry-synced"
  | "phone-opened-current-entry"
  | "pairing-qr-current"
  | "realtime-entry-ready"
  | "cellular-mobile-chat"
  | "restart-restore"
  | "network-switch"
  | "network-interruption"
  | "old-entry-repair";

export type IcloudAcceptanceItem = {
  id: IcloudAcceptanceItemId;
  status: "passed" | "needs-action" | "manual-required";
  severity: "ok" | "warning" | "danger";
  evidence: string;
  action: "export-icloud-entry" | "open-on-phone" | "regenerate-qr" | "choose-live-network-entry" | "record-real-world-check" | "ready";
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
  nextItemId?: IcloudAcceptanceItemId;
  nextManualItemId?: IcloudAcceptanceItemId;
  nextReviewAt?: number;
  items: IcloudAcceptanceItem[];
};

type IcloudLike = {
  recommendedBaseUrl?: string;
  recommendedMode?: string;
  recommendedStability?: string;
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

function baseUrlProtocol(baseUrl: string) {
  try {
    return new URL(baseUrl).protocol;
  } catch {
    return "";
  }
}

function isTemporaryCloudflare(baseUrl: string) {
  try {
    return new URL(baseUrl).hostname.endsWith(".trycloudflare.com");
  } catch {
    return false;
  }
}

function buildRealtimeEntryItem(icloud: IcloudLike, baseUrl: string): IcloudAcceptanceItem {
  const mode = String(icloud.recommendedMode || "").toLowerCase();
  const stability = String(icloud.recommendedStability || "").toLowerCase();
  const protocol = baseUrlProtocol(baseUrl);
  const isHttps = protocol === "https:";
  const localOrLan = mode === "local" || mode === "lan" || /^https?:\/\/(localhost|127\.0\.0\.1|\[::1\]|::1)([:/]|$)/i.test(baseUrl);
  const stableRemote = Boolean(baseUrl && isHttps && !localOrLan && stability !== "temporary" && !isTemporaryCloudflare(baseUrl));

  if (stableRemote) {
    return {
      id: "realtime-entry-ready",
      status: "passed",
      severity: "ok",
      evidence: `Realtime chat can target a stable HTTPS/VPN entry: ${baseUrl}.`,
      action: "ready",
    };
  }

  if (!baseUrl) {
    return {
      id: "realtime-entry-ready",
      status: "needs-action",
      severity: "warning",
      evidence: "No phone-reachable address is available yet. iCloud can sync an entry file only after LifeOS has a usable LAN, VPN, or HTTPS address.",
      action: "choose-live-network-entry",
    };
  }

  if (localOrLan || protocol !== "https:") {
    return {
      id: "realtime-entry-ready",
      status: "needs-action",
      severity: localOrLan ? "warning" : "danger",
      evidence: `The iCloud entry points to ${baseUrl}, which is not a stable HTTPS/VPN entry for off-LAN realtime chat.`,
      action: "choose-live-network-entry",
    };
  }

  return {
    id: "realtime-entry-ready",
    status: "needs-action",
    severity: "warning",
    evidence: `The current HTTPS entry is temporary or not yet proven stable: ${baseUrl}. Use Tailscale HTTPS Serve, Cloudflare Named Tunnel, or another trusted HTTPS entry for long-term off-LAN chat.`,
    action: "choose-live-network-entry",
  };
}

function manualItem(
  id: Extract<IcloudAcceptanceItemId, "cellular-mobile-chat" | "restart-restore" | "network-switch" | "network-interruption" | "old-entry-repair">,
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
    buildRealtimeEntryItem(icloud, baseUrl),
    manualItem("cellular-mobile-chat", latestRemoteRecord(records, "cellular-mobile-chat", baseUrl, now), "Use a real iPhone on cellular data, open the iCloud entry, and send one mobile chat message."),
    manualItem("restart-restore", latestRemoteRecord(records, "restart-restore", baseUrl, now), "Quit and reopen the Mac desktop app, then confirm the same iCloud-synced mobile entry still opens and the saved HTTPS/VPN address still serves the phone."),
    manualItem("network-switch", latestRemoteRecord(records, "network-switch", baseUrl, now), "Switch the phone between Wi-Fi and cellular while using the iCloud entry, then confirm chat reconnects."),
    manualItem("network-interruption", latestRemoteRecord(records, "network-interruption", baseUrl, now), "Interrupt and restore the VPN or HTTPS tunnel once, then confirm the phone gets a clear recovery path and the iCloud entry does not silently point at a dead address."),
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
  const nextItem = items.find((item) => item.status !== "passed");
  const nextManualItem = items.find((item) => item.status === "manual-required");
  const firstOpenAction = nextItem?.action || "ready";
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
    nextItemId: nextItem?.id,
    nextManualItemId: nextManualItem?.id,
    nextReviewAt: Number.isFinite(nextReviewAt) ? nextReviewAt : undefined,
    items,
  };
}
