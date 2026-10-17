// Offline shell for Notice Decoder. Everything the page needs is listed here and cached on install, so a notice
// can be decoded with no network at all (the engine runs in the page; nothing is fetched per notice).
// Bump VERSION when any of these files change: the old cache is dropped on activate.
// Also: (1) the share target for FILES (WhatsApp -> Share -> a PDF or photo) arrives as a POST; it is parked in a
// cache and the page is sent to ./?shared=file to pick it up; (2) the OCR / PDF libraries and the OCR language models
// come from two CDNs on first use and are cached, so the second photo works offline too.
const VERSION = 'nd-v14';
const SHELL = [
  './',
  './index.html',
  './app.js',
  './gcal.js',
  './ocr.js',
  './pdftext.js',
  './config.js',
  './samples.js',
  './styles.css',
  './manifest.webmanifest',
  './icon-192.png',
  './icon-512.png',
  './icon-maskable-512.png',
  './engine/ocrfix.js',
  './engine/dates.js',
  './engine/parse.js',
  './engine/clash.js',
  './engine/ics.js',
  './engine/holidays.js',
];
const SHARE_CACHE = 'nd-share';
const LIB_CACHE = 'nd-libs-v1';
const LIB_HOSTS = ['cdn.jsdelivr.net', 'tessdata.projectnaptha.com'];

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(VERSION).then((cache) => cache.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== VERSION && k !== SHARE_CACHE && k !== LIB_CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim()),
  );
});

const scopeUrl = new URL(self.registration.scope);

self.addEventListener('fetch', (event) => {
  const req = event.request;
  const url = new URL(req.url);

  // Share target with a file: park it, then open the page which fetches it back from the cache.
  if (req.method === 'POST' && url.origin === location.origin && url.pathname === scopeUrl.pathname) {
    event.respondWith((async () => {
      try {
        const form = await req.formData();
        const file = form.get('file') || form.get('files');
        const text = [form.get('title'), form.get('text'), form.get('url')].filter(Boolean).join('\n');
        const cache = await caches.open(SHARE_CACHE);
        if (file && typeof file !== 'string') {
          await cache.put('./shared-file', new Response(file, { headers: { 'content-type': file.type || 'application/octet-stream', 'x-nd-name': encodeURIComponent(file.name || 'shared') } }));
          return Response.redirect('./?shared=file', 303);
        }
        if (text) return Response.redirect(`./?text=${encodeURIComponent(text)}`, 303);
      } catch (err) { /* fall through to the plain page */ }
      return Response.redirect('./', 303);
    })());
    return;
  }

  if (req.method !== 'GET') return;

  // OCR / PDF libraries and language models: cache first, so they download once.
  if (LIB_HOSTS.includes(url.hostname)) {
    event.respondWith(caches.open(LIB_CACHE).then(async (cache) => {
      const hit = await cache.match(req);
      if (hit) return hit;
      const res = await fetch(req);
      if (res.ok || res.type === 'opaque') cache.put(req, res.clone());
      return res;
    }));
    return;
  }

  if (url.origin !== location.origin) return;
  // Same-origin GET: cache first, then network (and keep the fresh copy). A navigation with no cache falls back to the shell.
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
