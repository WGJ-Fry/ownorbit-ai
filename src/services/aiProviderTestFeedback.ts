import type { TranslationKey } from "../i18n/translations";
import type { AiProviderTestResult } from "./lifeosApi";

export type AiProviderTestFeedback = {
  key: TranslationKey;
  params?: Record<string, string | number>;
};

export function getAiProviderTestFeedback(result: AiProviderTestResult): AiProviderTestFeedback {
  if (result.selectedModelAvailable === false || result.reason === "selected_model_unavailable") {
    return {
      key: "aiTestFeedback.modelUnavailable",
      params: {
        model: result.selectedModel || result.provider.selectedModel || result.provider.defaultModel || "-",
      },
    };
  }

  switch (result.reason) {
    case "provider_disabled":
      return { key: "aiTestFeedback.providerDisabled" };
    case "missing_local_endpoint":
      return { key: "aiTestFeedback.localEndpointMissing" };
    case "missing_provider_key":
      return { key: "aiTestFeedback.keyMissing" };
    case "models_endpoint_timeout":
    case "credential_probe_timeout":
      return { key: "aiTestFeedback.timeout" };
    case "models_endpoint_unreachable":
      return { key: "aiTestFeedback.networkUnreachable" };
    case "models_endpoint_http_error":
    case "credential_probe_failed":
    case "credential_probe_empty":
      return { key: "aiTestFeedback.credentialRejected" };
    default:
      return { key: "aiTestFeedback.generic" };
  }
}
