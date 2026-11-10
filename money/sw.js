// Network-first for the app shell so updates show up on the next open; the cache is only an offline fallback.
// Caches are shared by every app on safaangit.github.io, so this worker only ever deletes its own (money-*).
// Account data never goes through here: it comes from the GitHub API and lives in IndexedDB.
const CACHE = 'money-v1';
const SHELL = ['./', 'index.html', 'app.css', 'manifest.webmanifest', 'icons/icon-192.png', 'icons/icon-512.png',
  'js/money.js', 'js/calc.js', 'js/gh.js', 'js/db.js', 'js/sync.js', 'js/sample.js'];

self.addEventListener('install', e => e.waitUntil(caches.open(CACHE).then(c => c.addAll(SHELL)).then(() => self.skipWaiting())));
self.addEventListener('activate', e => e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k.startsWith('money-') && k !== CACHE).map(k => caches.delete(k)))).then(() => self.clients.claim())));
self.addEventListener('fetch', e => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET' || url.origin !== location.origin) return;
  e.respondWith(fetch(e.request).then(r => { if (r.ok) caches.open(CACHE).then(c => c.put(e.request, r.clone())); return r; })
    .catch(() => caches.match(e.request, { ignoreSearch: e.request.mode === 'navigate' })));
});
