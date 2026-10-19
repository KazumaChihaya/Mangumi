const base = new URL("./", self.location.href);
const cachePrefix = `mangumi-shell:${base.pathname}:`;
const VERSION = `${cachePrefix}v2-__MANGUMI_BUILD__`;
const offline = new URL("offline.html", base).href;
const icon = new URL("icon.svg", base).href;
const assets = new URL("assets/", base).pathname;
self.addEventListener("push", (event) => {
  let payload;
  try { payload = event.data?.json(); } catch { return; }
  if (!payload?.title) return;
  event.waitUntil(self.registration.showNotification(String(payload.title).slice(0, 100), {
    body: String(payload.body ?? "").slice(0, 500), icon, badge: icon,
    tag: payload.tag, data: { url: payload.url, deliveryId: payload.deliveryId },
  }));
});
self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  event.waitUntil((async () => {
    const data = event.notification.data ?? {};
    let target = new URL(data.url || "./", base);
    if (target.origin !== base.origin || !target.pathname.startsWith(base.pathname)) target = base;
    if (data.deliveryId) {
      try {
        const response = await fetch(new URL("api/auth/session", base), { credentials: "include", cache: "no-store" });
        const session = await response.json();
        if (session.csrf) await fetch(new URL(`api/notifications/${encodeURIComponent(data.deliveryId)}/click`, base), { method: "POST", credentials: "include", headers: { "Content-Type": "application/json", "X-Mangumi-Request": "1", "X-CSRF-Token": session.csrf }, body: "{}" });
      } catch {}
    }
    const clients = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
    const client = clients.find(client => new URL(client.url).origin === base.origin);
    if (client) { await client.navigate(target.href); await client.focus(); }
    else await self.clients.openWindow(target.href);
  })());
});
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
