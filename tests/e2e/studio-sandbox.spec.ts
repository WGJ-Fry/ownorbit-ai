import { expect, test, type Page } from "@playwright/test";
import { buildStudioSandboxSrcDoc } from "../../src/components/apps/studio/sandbox";

const vendorScripts = [
  ["https://cdn.tailwindcss.com/3.4.17", "tailwind"],
  ["https://cdn.jsdelivr.net/npm/@alpinejs/persist@3.14.9/dist/cdn.min.js", "alpine-persist"],
  ["https://cdn.jsdelivr.net/npm/alpinejs@3.14.9/dist/cdn.min.js", "alpine"],
  ["https://cdn.jsdelivr.net/npm/chart.js@4.4.7/dist/chart.umd.min.js", "chart"],
] as const;

async function installSandboxRoutes(page: Page, probeRequests: string[]) {
  for (const [url, marker] of vendorScripts) {
    await page.route(url, (route) => route.fulfill({
      contentType: "text/javascript",
      body: `window.__ownOrbitVendorMarkers = (window.__ownOrbitVendorMarkers || []).concat(${JSON.stringify(marker)});`,
    }));
  }
  await page.route("https://sandbox-probe.invalid/data", (route) => {
    probeRequests.push(route.request().url());
    return route.fulfill({ contentType: "application/json", body: JSON.stringify({ ok: true }) });
  });
}

async function runSandboxProbe(page: Page, allowedNetworkOrigins: string[], probeId: string) {
  const srcDoc = buildStudioSandboxSrcDoc(`
    <script>
      window.addEventListener('load', async function() {
        const result = {
          probeId: ${JSON.stringify(probeId)},
          vendors: window.__ownOrbitVendorMarkers || [],
          fetchOk: false,
          fetchError: ''
        };
        try {
          const response = await fetch('https://sandbox-probe.invalid/data');
          result.fetchOk = response.ok;
        } catch (error) {
          result.fetchError = String(error && error.message ? error.message : error);
        }
        window.parent.postMessage({ source: 'ownorbit-sandbox-e2e', result }, '*');
      });
    </script>
  `, { allowedNetworkOrigins });

  return page.evaluate(({ sandboxSrcDoc, expectedProbeId }) => new Promise<any>((resolve, reject) => {
    const timeout = window.setTimeout(() => reject(new Error("Sandbox probe timed out")), 8_000);
    const listener = (event: MessageEvent) => {
      if (event.data?.source !== "ownorbit-sandbox-e2e" || event.data?.result?.probeId !== expectedProbeId) return;
      window.clearTimeout(timeout);
      window.removeEventListener("message", listener);
      resolve(event.data.result);
    };
    window.addEventListener("message", listener);
    const iframe = document.createElement("iframe");
    iframe.setAttribute("sandbox", "allow-scripts");
    iframe.srcdoc = sandboxSrcDoc;
    document.body.appendChild(iframe);
  }), { sandboxSrcDoc: srcDoc, expectedProbeId: probeId });
}

test("Studio sandbox blocks direct network until the capability is granted", async ({ page }) => {
  const probeRequests: string[] = [];
  await page.goto("about:blank");
  await installSandboxRoutes(page, probeRequests);

  const blocked = await runSandboxProbe(page, [], "blocked");
  expect([...blocked.vendors].sort()).toEqual(["tailwind", "alpine-persist", "alpine", "chart"].sort());
  expect(blocked.fetchOk).toBe(false);
  expect(blocked.fetchError).toContain("network capability and an approved origin are required");
  expect(probeRequests).toEqual([]);

  const wrongOrigin = await runSandboxProbe(page, ["https://different-origin.invalid"], "wrong-origin");
  expect(wrongOrigin.fetchOk).toBe(false);
  expect(wrongOrigin.fetchError).toContain("sandbox-probe.invalid");
  expect(probeRequests).toEqual([]);

  const allowed = await runSandboxProbe(page, ["https://sandbox-probe.invalid"], "allowed");
  expect([...allowed.vendors].sort()).toEqual(["tailwind", "alpine-persist", "alpine", "chart"].sort());
  expect(allowed.fetchOk).toBe(true);
  expect(probeRequests).toEqual(["https://sandbox-probe.invalid/data"]);
});
