const base = new URL("./", self.location.href);
const cachePrefix = `mangumi-shell:${base.pathname}:`;
const VERSION = `${cachePrefix}v2-__MANGUMI_BUILD__`;
const offline = new URL("offline.html", base).href;
const icon = new URL("icon.svg", base).href;
const assets = new URL("assets/", base).pathname;
self.addEventListener("install", (event) =>
  event.waitUntil(
    caches.open(VERSION).then((cache) => cache.addAll([offline, icon])),
  ),
);
self.addEventListener("activate", (event) =>
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(
          keys
            .filter((key) => key.startsWith(cachePrefix) && key !== VERSION)
            .map((key) => caches.delete(key)),
        ),
      )
      .then(() => self.clients.claim()),
  ),
);
self.addEventListener("message", (event) => {
  if (event.data?.type === "SKIP_WAITING") self.skipWaiting();
});
self.addEventListener("fetch", (event) => {
  const url = new URL(event.request.url);
  if (event.request.method !== "GET" || url.origin !== self.location.origin)
    return;
  if (event.request.mode === "navigate") {
    event.respondWith(fetch(event.request).catch(() => caches.match(offline)));
    return;
  }
  if (url.href === icon || url.pathname.startsWith(assets))
    event.respondWith(
      caches.open(VERSION).then(async (cache) => {
        const cached = await cache.match(event.request);
        if (cached) return cached;
        const response = await fetch(event.request);
        if (response.ok) await cache.put(event.request, response.clone());
        return response;
      }),
    );
});
