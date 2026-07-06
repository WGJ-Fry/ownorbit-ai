import type { TranslationKey } from "../../i18n/translations";
import type { IcloudAutoRefreshResult } from "../../services/lifeosApi";

type Translate = (key: TranslationKey, values?: Record<string, string | number | boolean | null | undefined>) => string;

export function formatIcloudAutoRefreshStatus(refresh: IcloudAutoRefreshResult | undefined | null, t: Translate) {
  if (!refresh) return "";
  if (refresh.refreshed) return t("icloud.autoRefresh.updated");
  if (refresh.reason === "fresh") return t("icloud.autoRefresh.fresh");
  if (refresh.reason === "error") return t("icloud.autoRefresh.failed", { reason: refresh.error || refresh.reason });
  return t("icloud.autoRefresh.skipped", { reason: refresh.reason || "unknown" });
}

export function appendIcloudAutoRefreshStatus(message: string, refresh: IcloudAutoRefreshResult | undefined | null, t: Translate) {
  const refreshMessage = formatIcloudAutoRefreshStatus(refresh, t);
  return refreshMessage ? `${message} ${refreshMessage}` : message;
}
