import { useEffect, useRef } from "react";
import { CustomApp } from "../../types";
import { createCustomAppActionRequest, decideCustomAppActionRequest, getCustomAppState, saveCustomAppState } from "../../services/lifeosApi";
import { useI18n } from "../../i18n/I18nProvider";
import type { TranslationKey } from "../../i18n/translations";
import { STUDIO_IFRAME_SANDBOX, buildStudioSandboxSrcDoc } from "./studio/sandbox";

type CustomAppFrameProps = {
  app: CustomApp;
};

export default function CustomAppFrame({ app }: CustomAppFrameProps) {
  const { t } = useI18n();
  const iframeRef = useRef<HTMLIFrameElement | null>(null);

  useEffect(() => {
    const respondToFrame = (requestId: string, response: Record<string, unknown>) => {
      iframeRef.current?.contentWindow?.postMessage({
        source: "lifeos-custom-app-host",
        requestId,
        ...response,
      }, "*");
    };

    const handleMessage = async (event: MessageEvent) => {
      if (event.source !== iframeRef.current?.contentWindow) return;
      const data = event.data || {};
      if (data.source !== "lifeos-custom-app" || !data.requestId) return;

      try {
        if (data.type === "get-state") {
          const response = await getCustomAppState(app.id);
          respondToFrame(data.requestId, { ok: true, state: response.state.state });
          return;
        }
        if (data.type === "set-state") {
          const response = await saveCustomAppState(app.id, data.payload?.state ?? {});
          respondToFrame(data.requestId, { ok: true, state: response.state.state });
          return;
        }
        if (data.type === "request-action") {
          const payload = data.payload || {};
          const targetUrl = typeof payload.targetUrl === "string" ? payload.targetUrl.trim() : "";
          if (!targetUrl) {
            respondToFrame(data.requestId, { ok: false, error: t("customApp.actionMissingTarget") });
            return;
          }
          const created = await createCustomAppActionRequest(app.id, {
            actionType: "open_url",
            label: typeof payload.label === "string" ? payload.label : undefined,
            targetUrl,
            reason: typeof payload.reason === "string" ? payload.reason : undefined,
          });
          if (created.request.status === "blocked") {
            respondToFrame(data.requestId, { ok: false, error: t("customApp.actionBlocked", { scheme: created.request.targetScheme }), result: { status: "blocked", request: created.request } });
            return;
          }
          const confirmed = window.confirm(t("customApp.actionConfirm", {
            label: created.request.label,
            scheme: created.request.targetScheme,
            risk: t(`customApp.actionRisk.${created.request.risk}` as TranslationKey),
          }));
          const decision = confirmed ? "approved" : "cancelled";
          const decided = await decideCustomAppActionRequest(app.id, created.request.id, decision);
          if (!confirmed) {
            respondToFrame(data.requestId, { ok: true, result: { status: "cancelled", request: decided.request } });
            return;
          }
          window.location.href = targetUrl;
          respondToFrame(data.requestId, { ok: true, result: { status: "approved", request: decided.request } });
          return;
        }
        respondToFrame(data.requestId, { ok: false, error: "Unsupported LifeOS app request" });
      } catch (error: any) {
        respondToFrame(data.requestId, { ok: false, error: error?.message || "LifeOS app request failed" });
      }
    };

    window.addEventListener("message", handleMessage);
    return () => window.removeEventListener("message", handleMessage);
  }, [app.id, t]);

  return (
    <div className="w-full min-h-[360px] bg-[#0a0a0a] pointer-events-auto relative">
      <iframe
        ref={iframeRef}
        srcDoc={buildStudioSandboxSrcDoc(app.code || "")}
        title={app.name}
        className="absolute inset-0 w-full h-full border-none"
        sandbox={STUDIO_IFRAME_SANDBOX}
      />
    </div>
  );
}
