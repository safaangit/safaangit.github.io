// Network-first for the app shell so updates show up on the next open; the cache is only an offline fallback.
// Caches are shared by every app on safaangit.github.io (Explore, Hoops), so only biryani-* ones are cleaned up here.
const CACHE = 'biryani-v29';
// Food library files (/foods/, tools/branded_foods.js): cache-first and kept across app updates.
// Rename when the library is rebuilt.
const FOODS = 'biryani-foods-2026-10';
const SHELL = ['./', 'index.html', 'app.css', 'manifest.webmanifest', 'icons/icon-192.png', 'icons/icon-512.png', 'icons/sc-voice.png', 'icons/sc-add.png', 'icons/sc-scan.png', 'icons/sc-task.png',
  'js/app.js', 'js/db.js', 'js/nutrition.js', 'js/food.js', 'js/scan.js', 'js/sync.js', 'js/goals.js', 'js/charts.js', 'js/voice.js', 'js/training.js', 'js/trainview.js', 'js/lifts.js', 'js/tasks.js', 'js/taskparse.js', 'js/gbridge.js', 'generic.json'];
const LIBS = /cdn\.jsdelivr\.net\/npm\/(@zxing|tesseract)/;

self.addEventListener('install', e => e.waitUntil(caches.open(CACHE).then(c => c.addAll(SHELL)).then(() => self.skipWaiting())));
self.addEventListener('activate', e => e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k.startsWith('biryani-') && k !== CACHE && k !== FOODS).map(k => caches.delete(k)))).then(() => self.clients.claim())));
self.addEventListener('fetch', e => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET') return;
  if (LIBS.test(url.href)) { // big versioned libraries: cache-first
    e.respondWith(caches.open(CACHE).then(async c => (await c.match(e.request)) || fetch(e.request).then(r => { if (r.ok) c.put(e.request, r.clone()); return r; })));
  } else if (url.origin === location.origin && url.pathname.startsWith('/foods/')) {
    e.respondWith(caches.open(FOODS).then(async c => (await c.match(e.request)) || fetch(e.request).then(r => { if (r.ok) c.put(e.request, r.clone()); return r; })));
  } else if (url.origin === location.origin) {
    e.respondWith(fetch(e.request).then(r => { if (r.ok) caches.open(CACHE).then(c => c.put(e.request, r.clone())); return r; })
      .catch(() => caches.match(e.request, { ignoreSearch: e.request.mode === 'navigate' })));
  }
});
