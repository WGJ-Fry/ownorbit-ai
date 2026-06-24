import { useEffect, useRef } from "react";
import { CustomApp } from "../../types";
import { getCustomAppState, saveCustomAppState } from "../../services/lifeosApi";
import { STUDIO_IFRAME_SANDBOX, buildStudioSandboxSrcDoc } from "./studio/sandbox";

type CustomAppFrameProps = {
  app: CustomApp;
};

export default function CustomAppFrame({ app }: CustomAppFrameProps) {
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
        respondToFrame(data.requestId, { ok: false, error: "Unsupported LifeOS app request" });
      } catch (error: any) {
        respondToFrame(data.requestId, { ok: false, error: error?.message || "LifeOS app request failed" });
      }
    };

    window.addEventListener("message", handleMessage);
    return () => window.removeEventListener("message", handleMessage);
  }, [app.id]);

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
