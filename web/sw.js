// Network first, cache as fallback: the remote needs its PC anyway, but an installed app should still open and show
// "PC unavailable" (then reconnect) when the PC is briefly unreachable, instead of a browser error page.
const cacheName = 'remote-smart-trackpad-v1';
const shell = ['/', '/app.js', '/style.css', '/manifest.webmanifest', '/icon-192.png', '/icon-512.png'];

self.addEventListener('install', (event) => {
    event.waitUntil(
        caches
            .open(cacheName)
            .then((cache) => cache.addAll(shell))
            .then(() => self.skipWaiting())
    );
});
self.addEventListener('activate', (event) => {
    event.waitUntil(
        caches
            .keys()
            .then((names) => Promise.all(names.filter((name) => name !== cacheName).map((name) => caches.delete(name))))
            .then(() => self.clients.claim())
    );
});
self.addEventListener('fetch', (event) => {
    const url = new URL(event.request.url);
    if (event.request.method !== 'GET' || url.origin !== location.origin || url.pathname.startsWith('/api/')) return;
    event.respondWith(
        fetch(event.request)
            .then((response) => {
                if (response.ok) {
                    const copy = response.clone();
                    caches.open(cacheName).then((cache) => cache.put(event.request, copy));
                }
                return response;
            })
            .catch(() =>
                caches.match(event.request, { ignoreSearch: true }).then((cached) => cached || Response.error())
            )
    );
});
