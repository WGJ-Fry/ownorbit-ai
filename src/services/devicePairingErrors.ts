import type { TranslationKey } from "../i18n/translations";

type Translate = (key: TranslationKey, params?: Record<string, string | number | boolean | null | undefined>) => string;

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error || "");
}

function normalizedErrorMessage(error: unknown) {
  return errorMessage(error).toLowerCase();
}

export function formatDevicePairingCreateError(error: unknown, t: Translate) {
  const status = typeof (error as { status?: unknown })?.status === "number" ? (error as { status: number }).status : 0;
  const code = String((error as { code?: unknown })?.code || "").toLowerCase();
  const message = errorMessage(error).trim();
  const normalized = normalizedErrorMessage(error);

  if (code === "binding_session_create_failed") return t("devicePair.createFailedRestart");
  if (status === 401 || status === 403) return t("devicePair.createFailedLogin");
  if (status === 429) return t("devicePair.createFailedRateLimit");
  if (status >= 500 || /^request failed:\s*5\d\d/i.test(message)) return t("devicePair.createFailedRestart");
  if (normalized.includes("timed out") || normalized.includes("failed to fetch") || normalized.includes("network")) {
    return t("devicePair.createFailedLocalCore");
  }
  if (normalized.includes("baseurl is too long")) return t("devicePair.createFailedBaseUrlTooLong");
  if (normalized.includes("baseurl is invalid")) return t("devicePair.createFailedBaseUrlInvalid");
  if (normalized.includes("must not contain username") || normalized.includes("token, query, or fragment")) {
    return t("devicePair.createFailedBaseUrlUnsafe");
  }
  if (normalized.includes("only http/https")) return t("devicePair.createFailedBaseUrlProtocol");
  if (normalized.includes("reachable from the phone")) return t("devicePair.createFailedBaseUrlUnreachable");
  return message || t("devicePair.createFailed");
}
