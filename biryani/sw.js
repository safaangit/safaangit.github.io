// Network-first for the app shell so updates show up on the next open; the cache is only an offline fallback.
const CACHE = 'biryani-v8';
const SHELL = ['./', 'index.html', 'app.css', 'manifest.webmanifest', 'icons/icon-192.png', 'icons/icon-512.png',
  'js/app.js', 'js/db.js', 'js/nutrition.js', 'js/food.js', 'js/scan.js', 'js/sync.js', 'js/goals.js', 'js/charts.js', 'js/voice.js', 'js/training.js', 'js/trainview.js', 'ideas.json', 'eatout.json'];
const LIBS = /cdn\.jsdelivr\.net\/npm\/(@zxing|tesseract)|cdnjs\.cloudflare\.com\/ajax\/libs\/leaflet\//;

self.addEventListener('install', e => e.waitUntil(caches.open(CACHE).then(c => c.addAll(SHELL)).then(() => self.skipWaiting())));
self.addEventListener('activate', e => e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k !== CACHE).map(k => caches.delete(k)))).then(() => self.clients.claim())));
self.addEventListener('fetch', e => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET') return;
  if (LIBS.test(url.href)) { // big versioned libraries: cache-first
    e.respondWith(caches.open(CACHE).then(async c => (await c.match(e.request)) || fetch(e.request).then(r => { if (r.ok) c.put(e.request, r.clone()); return r; })));
  } else if (url.origin === location.origin) {
    e.respondWith(fetch(e.request).then(r => { if (r.ok) caches.open(CACHE).then(c => c.put(e.request, r.clone())); return r; })
      .catch(() => caches.match(e.request)));
  }
});
