const CACHE_NAME = "lifeos-ai-shell-v5";
const BASE_PATH = self.location.pathname.replace(/\/sw\.js$/, "").replace(/\/+$/, "");
const withBasePath = (path) => `${BASE_PATH}${path.startsWith("/") ? path : `/${path}`}`;
const withoutBasePath = (pathname) => BASE_PATH && pathname.startsWith(`${BASE_PATH}/`) ? pathname.slice(BASE_PATH.length) || "/" : pathname;
const OFFLINE_FALLBACK = withBasePath("/offline.html");
const SHELL_ASSETS = [
  withBasePath("/"),
  withBasePath("/mobile/chat"),
  withBasePath("/mobile/device"),
  withBasePath("/mobile/pair"),
  withBasePath("/mobile/actions"),
  withBasePath("/mobile/tools"),
  OFFLINE_FALLBACK,
  withBasePath("/manifest.webmanifest"),
  withBasePath("/icon.svg"),
  withBasePath("/icons/icon-192.png"),
  withBasePath("/icons/icon-512.png"),
  withBasePath("/screenshots/real-mobile-chat.jpg"),
  withBasePath("/screenshots/real-mobile-device.jpg"),
];

function extractBuildAssets(html) {
  const absoluteAssets = (html.match(/\/assets\/[^"'<>\\\s)]+/g) || []).map((asset) => asset.trim());
  const relativeAssets = (html.match(/(?:^|["'(])\.\/assets\/[^"'<>\\\s)]+/g) || []).map((asset) => asset.replace(/^["'(]/, "").replace(/^\.\//, "/").trim());
  return Array.from(new Set([...absoluteAssets, ...relativeAssets].map((asset) => withBasePath(asset))));
}

async function cacheBuildAssets(cache) {
  try {
    const response = await fetch(withBasePath("/"), { cache: "no-store" });
    if (!response.ok) return;
    const html = await response.text();
    const buildAssets = extractBuildAssets(html);
    if (buildAssets.length) await cache.addAll(buildAssets);
  } catch (error) {
    console.warn("OwnOrbit service worker could not pre-cache build assets", error);
  }
}

async function notifyClients(message) {
  const windows = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
  for (const client of windows) {
    client.postMessage(message);
  }
}

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(CACHE_NAME)
      .then(async (cache) => {
        await cache.addAll(SHELL_ASSETS);
        await cacheBuildAssets(cache);
      })
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener("fetch", (event) => {
  const request = event.request;
  const url = new URL(request.url);

  if (url.origin !== self.location.origin || request.method !== "GET") return;
  const appPath = withoutBasePath(url.pathname);
  if (appPath.startsWith("/api/")) return;

  if (request.mode === "navigate") {
    event.respondWith(
      fetch(request)
        .then((response) => {
          if (response.ok) return response;
          return caches.match(request).then((cached) => cached || caches.match(withBasePath("/mobile/chat")) || caches.match(OFFLINE_FALLBACK) || response);
        })
        .catch(() => caches.match(request).then((cached) => cached || caches.match(withBasePath("/mobile/chat")) || caches.match(OFFLINE_FALLBACK))),
    );
    return;
  }

  event.respondWith(
    caches.match(request).then((cached) => {
      if (cached) return cached;
      return fetch(request).then((response) => {
        if (!response.ok) return response;
        const copy = response.clone();
        caches.open(CACHE_NAME).then((cache) => cache.put(request, copy));
        return response;
      });
    }),
  );
});

self.addEventListener("message", (event) => {
  if (event.data?.type === "LIFEOS_SKIP_WAITING") {
    event.waitUntil?.(self.skipWaiting());
    return;
  }

  if (event.data?.type === "LIFEOS_QUEUE_UPDATED") {
    event.waitUntil?.(notifyClients({ type: "LIFEOS_SYNC_OFFLINE_QUEUE", reason: "queue-updated" }));
  }
});

self.addEventListener("sync", (event) => {
  if (event.tag === "lifeos-offline-queue") {
    event.waitUntil(notifyClients({ type: "LIFEOS_SYNC_OFFLINE_QUEUE", reason: "background-sync" }));
  }
});
