// FarmasLog service worker: keeps the app itself on the phone so field agents can open it with no signal.
// It never stores API answers (those hold personal data) and never touches requests to other origins.
const CACHE = 'farmaslog-shell-v1';
const SHELL = ['./', 'index.html', 'styles.css', 'app.js', 'areas.json', 'config.js', 'brand/logo-header.png', 'brand/logo-full.png'];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => Promise.all(SHELL.map((u) => c.add(u).catch(() => {})))).then(() => self.skipWaiting()));
});
self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim()));
});
// Same-origin GETs: try the network first (so a new version shows up straight away), fall back to the saved copy when offline.
self.addEventListener('fetch', (e) => {
  const req = e.request; const url = new URL(req.url);
  if (req.method !== 'GET' || url.origin !== self.location.origin) return;
  e.respondWith(fetch(req).then((res) => {
    if (res.ok) { const copy = res.clone(); caches.open(CACHE).then((c) => c.put(req, copy)); }
    return res;
  }).catch(() => caches.match(req).then((hit) => hit || (req.mode === 'navigate' ? caches.match('index.html') : Response.error()))));
});
