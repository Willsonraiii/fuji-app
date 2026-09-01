/* F-UJI service worker — offline app shell
   Network-first for HTML/JS/CSS (fresh updates when online, cached when offline),
   cache-first for static assets (icons/manifest). */
const CACHE = 'fuji-v2';
const ASSETS = [
  './',
  './index.html',
  './css/app.css',
  './js/processing.js',
  './js/profiles.js',
  './js/state.js',
  './js/recipes.js',
  './js/ui.js',
  './js/main.js',
  './manifest.json',
  './icons/icon-192.png',
  './icons/icon-512.png'
];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(ASSETS)).then(()=>self.skipWaiting()));
});
self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(k=>k!==CACHE).map(k=>caches.delete(k)))).then(()=>self.clients.claim()));
});
self.addEventListener('fetch', e => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET') return;
  // Only handle same-origin GET (no uploads happen anywhere)
  if (url.origin !== location.origin) return;
  const freshFirst = e.request.mode === 'navigate' || /\.(js|css|html)$/.test(url.pathname);
  const fromNetwork = fetch(e.request)
    .then(res => {
      if (res.ok && res.type === 'basic') {
        const copy = res.clone();
        caches.open(CACHE).then(c => c.put(e.request, copy)).catch(()=>{});
      }
      return res;
    })
    .catch(() => caches.match(e.request).then(h => h || caches.match('./index.html')));
  const fromCache = caches.match(e.request);
  e.respondWith(freshFirst ? fromNetwork : fromCache.then(h => h || fromNetwork));
});