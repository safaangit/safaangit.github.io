// Offline shell: app files are cache-first (refreshed in the background); API calls always go to the network.
const CACHE = 'fuel-v1';
const SHELL = ['./', 'index.html', 'app.css', 'manifest.webmanifest', 'icons/icon.svg', 'icons/icon-192.png',
  'js/app.js', 'js/db.js', 'js/nutrition.js', 'js/food.js', 'js/scan.js', 'js/sync.js', 'js/goals.js', 'js/charts.js'];
const LIBS = /cdn\.jsdelivr\.net\/npm\/(@zxing|tesseract)/;

self.addEventListener('install', e => e.waitUntil(caches.open(CACHE).then(c => c.addAll(SHELL)).then(() => self.skipWaiting())));
self.addEventListener('activate', e => e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k !== CACHE).map(k => caches.delete(k)))).then(() => self.clients.claim())));
self.addEventListener('fetch', e => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET') return;
  if (url.origin === location.origin || LIBS.test(url.href)) {
    e.respondWith(caches.open(CACHE).then(async c => {
      const hit = await c.match(e.request);
      const net = fetch(e.request).then(r => { if (r.ok) c.put(e.request, r.clone()); return r; }).catch(() => hit);
      return hit || net;
    }));
  }
});
