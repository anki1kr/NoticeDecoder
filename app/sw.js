// Offline shell for Notice Decoder. Everything the page needs is listed here and cached on install, so a notice
// can be decoded with no network at all (the engine runs in the page; nothing is fetched per notice).
// Bump VERSION when any of these files change: the old cache is dropped on activate.
// Also: (1) the share target for FILES (WhatsApp -> Share -> a PDF or photo) arrives as a POST; it is parked in a
// cache and the page is sent to ./?shared=file to pick it up; (2) the OCR / PDF libraries and the OCR language models
// come from two CDNs on first use and are cached, so the second photo works offline too.
const VERSION = 'nd-v25';
const SHELL = [
  './',
  './index.html',
  './app.js',
  './gcal.js',
  './schedule.js',
  './ocr.js',
  './pdftext.js',
  './docx.js',
  './ai.js',
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
const PUSH_CACHE = 'nd-push';
const LIB_CACHE = 'nd-libs-v1';
const LIB_HOSTS = ['cdn.jsdelivr.net', 'tessdata.projectnaptha.com'];

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(VERSION).then((cache) => cache.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== VERSION && k !== SHARE_CACHE && k !== LIB_CACHE && k !== PUSH_CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim()),
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

// ---------- notifications ----------
// A push from the class server carries no text (that would need per-phone encryption). It only wakes this worker,
// which fetches the class and decides: something changed since we last looked -> say what; a reminder is due -> say
// which event; else a quiet "updated" so the browser never shows its own "site updated in background" notice.
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const day = (iso) => { const [y, m, d] = iso.split('-').map(Number); return `${d} ${MONTHS[m - 1]}`; };
const clock = (hm) => { if (!hm) return ''; const [h, m] = hm.split(':').map(Number); return `${h % 12 || 12}:${String(m).padStart(2, '0')} ${h < 12 ? 'AM' : 'PM'}`; };
const when = (e) => `${day(e.date)}${e.start ? `, ${clock(e.start)}` : ''}`;

// Exposed as a function so the browser check can run it without a real push service.
self.__ndOnPush = async () => {
  {
    const cache = await caches.open(PUSH_CACHE);
    const cfgRes = await cache.match('./push-class');
    if (!cfgRes) return;
    const cfg = await cfgRes.json();
    const open = `./#c=${cfg.id}`;
    const show = (title, body, tag) => self.registration.showNotification(title, { body, tag, icon: './icon-192.png', badge: './icon-192.png', data: { open }, renotify: true });
    let data;
    try { data = await (await fetch(`${cfg.feed}/c/${cfg.id}.json`, { cache: 'no-store' })).json(); } catch { return show(cfg.name, 'A notice was published. Open to see it.', 'nd-fallback'); }
    const seen = cfg.seen || '1970-01-01';
    const fresh = (data.changes || []).filter((c) => c.at > seen);
    const words = { added: 'New', moved: 'Moved', updated: 'Changed', cancelled: 'Cancelled', restored: 'Back on' };
    if (fresh.length) {
      const lines = fresh.slice(0, 3).map((c) => `${words[c.kind] || c.kind}: ${c.title}, ${c.kind === 'moved' && c.from ? `${day(c.from.date)} → ` : ''}${when(c)}`);
      if (fresh.length > 3) lines.push(`and ${fresh.length - 3} more`);
      await show(`${cfg.name}: ${fresh.length === 1 ? lines[0].split(':')[0].toLowerCase() === 'new' ? 'new notice' : 'notice changed' : `${fresh.length} changes`}`, lines.join('\n'), 'nd-change');
      await cache.put('./push-class', new Response(JSON.stringify({ ...cfg, seen: data.now || new Date().toISOString() }), { headers: { 'content-type': 'application/json' } }));
      return;
    }
    const due = (data.remind || []).map((uid) => (data.events || []).find((e) => e.uid === uid)).filter(Boolean);
    if (due.length) {
      const e = due[0];
      const lead = e.type === 'test' ? 'Tomorrow' : e.type === 'deadline' ? (e.start ? 'In 3 hours' : 'Tomorrow') : 'In 30 minutes';
      return show(`${lead}: ${e.title}`, `${when(e)}${e.venue ? ` · ${e.venue}` : ''}${due.length > 1 ? `\n+${due.length - 1} more coming up` : ''}`, `nd-remind-${e.uid}`);
    }
    return show(cfg.name, 'Class calendar updated.', 'nd-fallback');
  }
};
self.addEventListener('push', (event) => event.waitUntil(self.__ndOnPush()));

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const target = new URL(event.notification.data?.open || './', self.registration.scope).href;
  event.waitUntil((async () => {
    const all = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    const same = all.find((c) => c.url.startsWith(self.registration.scope));
    if (same) { await same.focus(); return same.navigate(target); }
    return self.clients.openWindow(target);
  })());
});
