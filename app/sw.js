// Offline shell for Notice Decoder. Everything the page needs is listed here and cached on install, so a notice
// can be decoded with no network at all (the engine runs in the page; nothing is fetched per notice).
// Bump VERSION when any of these files change: the old cache is dropped on activate.
const VERSION = 'nd-v3';
const SHELL = [
  './',
  './index.html',
  './app.js',
  './gcal.js',
  './config.js',
  './samples.js',
  './styles.css',
  './manifest.webmanifest',
  './icon-192.png',
  './icon-512.png',
  './icon-maskable-512.png',
  './engine/dates.js',
  './engine/parse.js',
  './engine/clash.js',
  './engine/ics.js',
  './engine/holidays.js',
];

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(VERSION).then((cache) => cache.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== VERSION).map((k) => caches.delete(k)))).then(() => self.clients.claim()),
  );
});

// Same-origin GET: cache first, then network (and keep the fresh copy). A navigation with no cache falls back to the shell.
self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET' || new URL(req.url).origin !== location.origin) return;
  const url = new URL(req.url);
  url.search = ''; // the share target (?text=...) and cache-busters all map to the one shell
  const key = new Request(url.toString(), { method: 'GET' });
  event.respondWith(
    caches.match(key).then((hit) => {
      const fetching = fetch(req).then((res) => {
        if (res.ok) caches.open(VERSION).then((cache) => cache.put(key, res.clone()));
        return res;
      }).catch(() => hit || (req.mode === 'navigate' ? caches.match('./index.html') : undefined));
      return hit || fetching;
    }),
  );
});
