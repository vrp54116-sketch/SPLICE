/* SPLICE offline shell. Network-first: never cache API or video bytes. */
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (e) => e.waitUntil(self.clients.claim()));
self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);
  if (url.pathname.startsWith('/api/')) return; // never intercept live data
  event.respondWith(fetch(event.request).catch(() => caches.match(event.request)));
});
