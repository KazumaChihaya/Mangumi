const VERSION = 'mangumi-shell-v1';
self.addEventListener('install', event => event.waitUntil(caches.open(VERSION).then(cache => cache.addAll(['/offline.html', '/icon.svg']))));
self.addEventListener('activate', event => event.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(key => key !== VERSION).map(key => caches.delete(key))))));
self.addEventListener('message', event => { if (event.data?.type === 'SKIP_WAITING') self.skipWaiting(); });
self.addEventListener('fetch', event => {
  const url = new URL(event.request.url);
  if (event.request.method !== 'GET' || url.origin !== self.location.origin) return;
  if (event.request.mode === 'navigate') { event.respondWith(fetch(event.request).catch(() => caches.match('/offline.html'))); return; }
  if (url.pathname === '/icon.svg' || url.pathname.startsWith('/assets/')) event.respondWith(caches.open(VERSION).then(async cache => { const cached = await cache.match(event.request); if (cached) return cached; const response = await fetch(event.request); if (response.ok) await cache.put(event.request, response.clone()); return response; }));
});
