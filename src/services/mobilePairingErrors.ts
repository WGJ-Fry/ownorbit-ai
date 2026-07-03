import type { TranslationKey } from "../i18n/translations";

export type MobilePairingErrorCopy = {
  titleKey: TranslationKey;
  bodyKey: TranslationKey;
};

function errorMessage(error: unknown) {
  const message = error instanceof Error ? error.message : String(error || "");
  return message.toLowerCase();
}

export function getMobilePairingErrorCopy(error: unknown): MobilePairingErrorCopy {
  const message = errorMessage(error);
  const status = typeof (error as { status?: unknown })?.status === "number" ? (error as { status: number }).status : null;
  const code = String((error as { code?: unknown })?.code || "").toLowerCase();

  if (status === 400 || code.includes("binding") || message.includes("invalid or expired") || message.includes("invalid token") || message.includes("expired")) {
    return {
      titleKey: "mobilePair.errorExpiredTitle",
      bodyKey: "mobilePair.errorExpiredBody",
    };
  }

  if (status === 0 || message.includes("failed to fetch") || message.includes("network") || message.includes("timed out") || message.includes("offline")) {
    return {
      titleKey: "mobilePair.errorNetworkTitle",
      bodyKey: "mobilePair.errorNetworkBody",
    };
  }

  return {
    titleKey: "mobilePair.errorGenericTitle",
    bodyKey: "mobilePair.errorGenericBody",
  };
}
