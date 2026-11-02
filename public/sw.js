// PickPost service worker: caches static assets, never caches pages or API responses (they are per-user),
// and shows an offline page when the network is unavailable.
const VERSION = 'v2';
const STATIC = 'static-' + VERSION;
const ASSETS = ['/style.css', '/app.js', '/live.js', '/votes.js', '/chat.js', '/icons/icon.svg', '/icons/icon-192.png', '/icons/icon-512.png'];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(STATIC).then((c) => c.addAll(ASSETS)).then(() => fetch('/offline').then((r) => caches.open(STATIC).then((c) => c.put('/offline', r)))).then(() => self.skipWaiting()));
});
self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== STATIC).map((k) => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', (e) => {
  const req = e.request, url = new URL(req.url);
  if (req.method !== 'GET' || url.origin !== location.origin || url.pathname.startsWith('/api/') || url.pathname.startsWith('/socket.io/')) return;
  if (ASSETS.includes(url.pathname)) {
    e.respondWith(caches.match(req).then((hit) => { const net = fetch(req).then((r) => { const copy = r.clone(); caches.open(STATIC).then((c) => c.put(req, copy)); return r; }).catch(() => hit); return hit || net; }));
    return;
  }
  if (req.mode === 'navigate') e.respondWith(fetch(req).catch(() => caches.match('/offline')));
});
