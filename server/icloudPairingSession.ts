import type { BindingSession } from "./devices";

type Input = {
  session?: BindingSession | null;
  recommendedBaseUrl?: string;
  now?: number;
};

function normalizeBaseUrl(value?: string) {
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

export function buildIcloudPairingSessionStatus(input: Input) {
  const now = input.now || Date.now();
  const session = input.session || null;
  const expectedBaseUrl = normalizeBaseUrl(input.recommendedBaseUrl);
  if (!session) {
    return {
      status: "missing" as const,
      severity: "warning" as const,
      action: "create-qr" as const,
      bindingId: "",
      baseUrl: "",
      expectedBaseUrl,
      createdAt: 0,
      expiresAt: 0,
      confirmedAt: 0,
      confirmedDeviceId: "",
      expired: false,
      secondsRemaining: 0,
      reason: "No active pairing QR has been generated yet.",
    };
  }

  const baseUrl = normalizeBaseUrl(session.baseUrl);
  const confirmedAt = Number(session.confirmedAt || 0);
  const secondsRemaining = Math.max(0, Math.floor((Number(session.expiresAt || 0) - now) / 1000));
  const expired = !confirmedAt && secondsRemaining <= 0;
  const baseUrlChanged = !confirmedAt && Boolean(expectedBaseUrl && baseUrl && expectedBaseUrl !== baseUrl);
  const expiringSoon = !confirmedAt && !expired && secondsRemaining <= 60;

  if (confirmedAt) {
    return {
      status: "confirmed" as const,
      severity: "ok" as const,
      action: "none" as const,
      bindingId: session.id,
      baseUrl,
      expectedBaseUrl,
      createdAt: session.createdAt,
      expiresAt: session.expiresAt,
      confirmedAt,
      confirmedDeviceId: session.confirmedDeviceId || "",
      expired: false,
      secondsRemaining: 0,
      reason: "The latest pairing QR has already bound a device.",
    };
  }

  if (expired) {
    return {
      status: "expired" as const,
      severity: "danger" as const,
      action: "regenerate-qr" as const,
      bindingId: session.id,
      baseUrl,
      expectedBaseUrl,
      createdAt: session.createdAt,
      expiresAt: session.expiresAt,
      confirmedAt: 0,
      confirmedDeviceId: "",
      expired: true,
      secondsRemaining: 0,
      reason: "The latest pairing QR has expired before a phone finished binding.",
    };
  }

  if (baseUrlChanged) {
    return {
      status: "address-changed" as const,
      severity: "warning" as const,
      action: "regenerate-qr" as const,
      bindingId: session.id,
      baseUrl,
      expectedBaseUrl,
      createdAt: session.createdAt,
      expiresAt: session.expiresAt,
      confirmedAt: 0,
      confirmedDeviceId: "",
      expired: false,
      secondsRemaining,
      reason: "The pairing QR was generated for a different phone entry than the current recommended iCloud entry.",
    };
  }

  if (expiringSoon) {
    return {
      status: "expiring-soon" as const,
      severity: "warning" as const,
      action: "regenerate-qr" as const,
      bindingId: session.id,
      baseUrl,
      expectedBaseUrl,
      createdAt: session.createdAt,
      expiresAt: session.expiresAt,
      confirmedAt: 0,
      confirmedDeviceId: "",
      expired: false,
      secondsRemaining,
      reason: "The latest pairing QR is about to expire.",
    };
  }

  return {
    status: "ready" as const,
    severity: "ok" as const,
    action: "use-current-qr" as const,
    bindingId: session.id,
    baseUrl,
    expectedBaseUrl,
    createdAt: session.createdAt,
    expiresAt: session.expiresAt,
    confirmedAt: 0,
    confirmedDeviceId: "",
    expired: false,
    secondsRemaining,
    reason: "The latest pairing QR is still usable.",
  };
}
