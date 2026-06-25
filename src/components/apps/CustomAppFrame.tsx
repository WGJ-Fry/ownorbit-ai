import { useEffect, useRef } from "react";
import { CustomApp } from "../../types";
import {
  createCustomAppActionRequest,
  createCustomAppCapabilityRequest,
  createCustomAppRuntimeEvent,
  decideCustomAppActionRequest,
  decideCustomAppCapabilityRequest,
  getCustomAppState,
  saveCustomAppState,
  type CustomAppCapabilityId,
} from "../../services/lifeosApi";
import { useI18n } from "../../i18n/I18nProvider";
import type { TranslationKey } from "../../i18n/translations";
import { STUDIO_IFRAME_SANDBOX, buildStudioSandboxSrcDoc } from "./studio/sandbox";

type CustomAppFrameProps = {
  app: CustomApp;
};

const customAppCapabilityIds: CustomAppCapabilityId[] = ["storage", "openExternal", "navigation", "communication", "shortcuts", "network", "clipboard", "fileImport", "backgroundSync"];

export default function CustomAppFrame({ app }: CustomAppFrameProps) {
  const { t } = useI18n();
  const iframeRef = useRef<HTMLIFrameElement | null>(null);

  useEffect(() => {
    const recordRuntimeEvent = (
      eventType: Parameters<typeof createCustomAppRuntimeEvent>[1]["eventType"],
      severity: Parameters<typeof createCustomAppRuntimeEvent>[1]["severity"],
      label: string,
      message: string,
      detail?: unknown,
    ) => {
      createCustomAppRuntimeEvent(app.id, { eventType, severity, label, message, detail }).catch(() => null);
    };

    recordRuntimeEvent("opened", "info", "Tool opened", `${app.name} opened`, { appName: app.name });

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
      if (data.source === "jarvis-sandbox-frame-log") {
        const isError = data.type === "error";
        recordRuntimeEvent(
          isError ? "error" : "console",
          isError ? "error" : "info",
          isError ? "Runtime error" : "Console output",
          typeof data.message === "string" ? data.message : String(data.message || ""),
          { source: "iframe" },
        );
        return;
      }
      if (data.source !== "lifeos-custom-app" || !data.requestId) return;

      try {
        if (data.type === "get-state") {
          const response = await getCustomAppState(app.id);
          recordRuntimeEvent("state_read", "info", "State read", "Tool read persisted state", { requestId: data.requestId });
          respondToFrame(data.requestId, { ok: true, state: response.state.state });
          return;
        }
        if (data.type === "set-state") {
          const response = await saveCustomAppState(app.id, data.payload?.state ?? {});
          recordRuntimeEvent("state_saved", "info", "State saved", "Tool saved persisted state", { requestId: data.requestId });
          respondToFrame(data.requestId, { ok: true, state: response.state.state });
          return;
        }
        if (data.type === "request-capability") {
          const payload = data.payload || {};
          const requestedCapabilities = Array.isArray(payload.capabilities)
            ? payload.capabilities.filter((item: unknown): item is CustomAppCapabilityId => customAppCapabilityIds.includes(item as CustomAppCapabilityId))
            : [];
          if (requestedCapabilities.length === 0) {
            respondToFrame(data.requestId, { ok: false, error: t("customApp.capabilityMissing") });
            return;
          }
          const created = await createCustomAppCapabilityRequest(app.id, {
            requestedCapabilities,
            label: typeof payload.label === "string" ? payload.label : undefined,
            reason: typeof payload.reason === "string" ? payload.reason : undefined,
          });
          recordRuntimeEvent("capability_requested", created.request.risk === "high" ? "warning" : "info", created.request.label, `Requested capabilities: ${created.request.requestedCapabilities.join(", ")}`, {
            requestId: created.request.id,
            status: created.request.status,
            missingCapabilities: created.request.missingCapabilities,
          });
          if (created.request.status === "approved") {
            respondToFrame(data.requestId, { ok: true, result: { status: "approved", request: created.request } });
            return;
          }
          const confirmed = window.confirm(t("customApp.capabilityConfirm", {
            label: created.request.label,
            capabilities: created.request.missingCapabilities.join(", "),
            risk: t(`customApp.actionRisk.${created.request.risk}` as TranslationKey),
          }));
          const decision = confirmed ? "approved" : "denied";
          const decided = await decideCustomAppCapabilityRequest(app.id, created.request.id, decision, confirmed ? t("customApp.capabilityApproveNote") : t("customApp.capabilityDenyNote"));
          respondToFrame(data.requestId, { ok: confirmed, result: { status: decided.request.status, request: decided.request }, error: confirmed ? undefined : t("customApp.capabilityDenied") });
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
          recordRuntimeEvent("action_requested", created.request.risk === "high" ? "warning" : "info", created.request.label, `Requested ${created.request.targetScheme} action`, {
            requestId: created.request.id,
            status: created.request.status,
            scheme: created.request.targetScheme,
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
        recordRuntimeEvent("error", "error", "Host request failed", error?.message || "LifeOS app request failed", { requestType: data.type });
        respondToFrame(data.requestId, { ok: false, error: error?.message || "LifeOS app request failed" });
      }
    };

    window.addEventListener("message", handleMessage);
    return () => window.removeEventListener("message", handleMessage);
  }, [app.id, app.name, t]);

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
