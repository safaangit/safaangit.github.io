// Network-first for the app shell so updates show up on the next open; the cache is only an offline fallback.
// Caches are shared by every app on safaangit.github.io, so this worker only ever deletes its own (explore-*).
const CACHE = 'explore-v1';
const SHELL = ['./', 'index.html', 'app.css', 'manifest.webmanifest', 'icons/icon-192.png', 'icons/icon-512.png',
  'js/explore.js', 'js/db.js', 'js/nutrition.js', 'js/sync.js', 'ideas.json', 'eatout.json'];
const LIBS = /cdnjs\.cloudflare\.com\/ajax\/libs\/leaflet\//;

self.addEventListener('install', e => e.waitUntil(caches.open(CACHE).then(c => c.addAll(SHELL)).then(() => self.skipWaiting())));
self.addEventListener('activate', e => e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k.startsWith('explore-') && k !== CACHE).map(k => caches.delete(k)))).then(() => self.clients.claim())));
self.addEventListener('fetch', e => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET') return;
  if (LIBS.test(url.href)) { // big versioned library: cache-first
    e.respondWith(caches.open(CACHE).then(async c => (await c.match(e.request)) || fetch(e.request).then(r => { if (r.ok) c.put(e.request, r.clone()); return r; })));
  } else if (url.origin === location.origin) {
    e.respondWith(fetch(e.request).then(r => { if (r.ok) caches.open(CACHE).then(c => c.put(e.request, r.clone())); return r; })
      .catch(() => caches.match(e.request, { ignoreSearch: e.request.mode === 'navigate' })));
  }
});
