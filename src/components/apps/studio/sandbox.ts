export const STUDIO_IFRAME_SANDBOX = "allow-scripts";

const STUDIO_VENDOR_SCRIPTS = {
  tailwind: "https://cdn.tailwindcss.com/3.4.17",
  alpinePersist: "https://cdn.jsdelivr.net/npm/@alpinejs/persist@3.14.9/dist/cdn.min.js",
  alpine: "https://cdn.jsdelivr.net/npm/alpinejs@3.14.9/dist/cdn.min.js",
  chart: "https://cdn.jsdelivr.net/npm/chart.js@4.4.7/dist/chart.umd.min.js",
} as const;

export type StudioSandboxOptions = {
  allowedNetworkOrigins?: string[];
};

function normalizeNetworkOrigins(origins: string[] = []) {
  return Array.from(new Set(origins.flatMap((origin) => {
    try {
      const parsed = new URL(origin);
      return ["https:", "wss:", "http:", "ws:"].includes(parsed.protocol) ? [parsed.origin] : [];
    } catch {
      return [];
    }
  })));
}

function studioContentSecurityPolicy(allowedNetworkOrigins: string[]) {
  const applicationNetworkSources = allowedNetworkOrigins.length ? allowedNetworkOrigins.join(" ") : "'none'";
  const applicationMediaOrigins = allowedNetworkOrigins.filter((origin) => origin.startsWith("https://") || origin.startsWith("http://"));
  const applicationMediaSources = `${applicationMediaOrigins.join(" ")} data: blob:`.trim();
  return [
    "default-src 'none'",
    `script-src 'unsafe-inline' ${Object.values(STUDIO_VENDOR_SCRIPTS).join(" ")}`,
    "style-src 'unsafe-inline'",
    `connect-src ${applicationNetworkSources}`,
    `img-src ${applicationMediaSources}`,
    `media-src ${applicationMediaSources}`,
    "font-src data:",
    "form-action 'none'",
    "frame-src 'none'",
    "child-src 'none'",
    "worker-src 'none'",
    "object-src 'none'",
    "base-uri 'none'",
    "navigate-to 'none'",
  ].join("; ");
}

export function buildStudioSandboxSrcDoc(code: string, options: StudioSandboxOptions = {}) {
  const allowedNetworkOrigins = normalizeNetworkOrigins(options.allowedNetworkOrigins);
  const contentSecurityPolicy = studioContentSecurityPolicy(allowedNetworkOrigins);
  return `
    <!DOCTYPE html>
    <html>
      <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <meta name="referrer" content="no-referrer">
        <meta http-equiv="Content-Security-Policy" content="${contentSecurityPolicy}">
        <script src="${STUDIO_VENDOR_SCRIPTS.tailwind}"></script>
        <script defer src="${STUDIO_VENDOR_SCRIPTS.alpinePersist}"></script>
        <script defer src="${STUDIO_VENDOR_SCRIPTS.alpine}"></script>
        <script src="${STUDIO_VENDOR_SCRIPTS.chart}"></script>
        <script>
          (function() {
            const lifeosAllowedNetworkOrigins = new Set(${JSON.stringify(allowedNetworkOrigins)});
            const originalLog = console.log;
            const originalError = console.error;
            console.log = function(...args) {
              originalLog.apply(console, args);
              window.parent.postMessage({
                source: 'jarvis-sandbox-frame-log',
                type: 'log',
                message: args.map(a => typeof a === 'object' ? JSON.stringify(a) : String(a)).join(' ')
              }, '*');
            };
            console.error = function(...args) {
              originalError.apply(console, args);
              window.parent.postMessage({
                source: 'jarvis-sandbox-frame-log',
                type: 'error',
                message: args.map(a => typeof a === 'object' ? JSON.stringify(a) : String(a)).join(' ')
              }, '*');
            };
            window.onerror = function(message, source, lineno) {
              window.parent.postMessage({
                source: 'jarvis-sandbox-frame-log',
                type: 'error',
                message: String(message) + ' (Line: ' + lineno + ')'
              }, '*');
            };
            window.onunhandledrejection = function(event) {
              window.parent.postMessage({
                source: 'jarvis-sandbox-frame-log',
                type: 'error',
                message: String(event && event.reason && event.reason.message ? event.reason.message : event.reason || 'Unhandled promise rejection')
              }, '*');
            };

            function networkCapabilityError(apiName, target) {
              const suffix = target ? ' (' + String(target) + ')' : '';
              return new Error('OwnOrbit network capability and an approved origin are required for ' + apiName + suffix);
            }
            function approvedNetworkUrl(value, apiName) {
              let parsed;
              try { parsed = new URL(String(value)); } catch (_) { throw networkCapabilityError(apiName, value); }
              if (!lifeosAllowedNetworkOrigins.has(parsed.origin)) throw networkCapabilityError(apiName, parsed.origin);
              return parsed.toString();
            }
            const originalFetch = window.fetch.bind(window);
            window.fetch = function(input, init) {
              try {
                const target = typeof input === 'string' || input instanceof URL ? input : input && input.url;
                approvedNetworkUrl(target, 'fetch');
                return originalFetch(input, init);
              } catch (error) {
                return Promise.reject(error);
              }
            };
            const originalXhrOpen = window.XMLHttpRequest.prototype.open;
            window.XMLHttpRequest.prototype.open = function(method, url) {
              approvedNetworkUrl(url, 'XMLHttpRequest');
              return originalXhrOpen.apply(this, arguments);
            };
            for (const apiName of ['WebSocket', 'EventSource']) {
              const OriginalApi = window[apiName];
              if (!OriginalApi) continue;
              const GuardedApi = function(url) {
                approvedNetworkUrl(url, apiName);
                return Reflect.construct(OriginalApi, Array.from(arguments), new.target || OriginalApi);
              };
              GuardedApi.prototype = OriginalApi.prototype;
              Object.defineProperty(window, apiName, { configurable: false, value: GuardedApi });
            }
            const originalSendBeacon = navigator.sendBeacon && navigator.sendBeacon.bind(navigator);
            if (originalSendBeacon) {
              Object.defineProperty(navigator, 'sendBeacon', {
                configurable: false,
                value: function(url, data) {
                  approvedNetworkUrl(url, 'sendBeacon');
                  return originalSendBeacon(url, data);
                }
              });
            }
            document.addEventListener('submit', function(event) {
              event.preventDefault();
              console.error('Use an approved API call or OwnOrbit action request instead of form submission');
            }, true);
            document.addEventListener('click', function(event) {
              const target = event.target && event.target.closest ? event.target.closest('a[href]') : null;
              const href = target && target.getAttribute ? String(target.getAttribute('href') || '').trim() : '';
              if (!href || href.startsWith('#')) return;
              event.preventDefault();
              console.error('Use window.lifeosApp.requestAction(...) before opening an external address');
            }, true);

            const pendingLifeosRequests = new Map();
            let lifeosRequestCounter = 0;
            function sendLifeosRequest(type, payload) {
              const requestId = 'lifeos-app-' + Date.now() + '-' + (++lifeosRequestCounter);
              window.parent.postMessage({
                source: 'lifeos-custom-app',
                type,
                requestId,
                payload
              }, '*');
              return new Promise(function(resolve, reject) {
                pendingLifeosRequests.set(requestId, { resolve, reject });
                window.setTimeout(function() {
                  if (!pendingLifeosRequests.has(requestId)) return;
                  pendingLifeosRequests.delete(requestId);
                  reject(new Error('OwnOrbit app state request timed out'));
                }, 8000);
              });
            }
            window.lifeosApp = {
              getState: function() {
                return sendLifeosRequest('get-state');
              },
              setState: function(state) {
                return sendLifeosRequest('set-state', { state });
              },
              requestCapability: function(request) {
                return sendLifeosRequest('request-capability', request || {});
              },
              requestAction: function(action) {
                return sendLifeosRequest('request-action', action || {});
              }
            };
            window.addEventListener('message', function(event) {
              const data = event.data || {};
              if (data.source !== 'lifeos-custom-app-host' || !data.requestId) return;
              const pending = pendingLifeosRequests.get(data.requestId);
              if (!pending) return;
              pendingLifeosRequests.delete(data.requestId);
              if (data.ok === false) {
                pending.reject(new Error(data.error || 'OwnOrbit app state request failed'));
              } else {
                pending.resolve(data.result === undefined ? data.state : data.result);
              }
            });
          })();
        </script>
        <style>
          ::-webkit-scrollbar { display: none; }
          body { margin: 0; padding: 0; background: #0a0a0a; color: white; overflow-x: hidden; font-family: ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif; }
        </style>
      </head>
      <body>
        ${code}
      </body>
    </html>
  `;
}
