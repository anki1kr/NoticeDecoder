// Class feed: a class representative publishes reviewed events once; the whole class subscribes to one calendar
// link that updates itself. One Cloudflare Worker + one KV namespace, free tier. The event -> calendar mapping
// (UIDs, times, reminders) is the app's own engine/ics.js, so the feed, the .ics download and the Google writer agree.
//
//   POST /api/class                      {name}                 -> {id, secret}        (secret shown once, kept by the CR)
//   POST /api/class/:id/publish          Bearer secret, {events} -> {count, clashes}   (merge by UID; revised = update)
//   DELETE /api/class/:id/events/:uid    Bearer secret          -> marks it cancelled (subscribers see it removed)
//   GET  /c/:id.ics                      webcal feed (text/calendar)
//   GET  /c/:id.json                     events as JSON (the Android app and the PWA poll this)
//   GET  /c/:id                          subscribe page
import { toICS, calendarEntries } from '../../app/engine/ics.js';
import { findClashes } from '../../app/engine/clash.js';

const MAX_EVENTS = 300;
const MAX_BODY = 64 * 1024;
const ID_ALPHABET = 'abcdefghjkmnpqrstuvwxyz23456789'; // no 0/o/1/l/i
const EVENT_FIELDS = ['title', 'type', 'typeLabel', 'date', 'start', 'end', 'venue', 'link', 'durationMin', 'repeat', 'point', 'window', 'reportAt', 'cancelled'];

const json = (data, status = 200, extra = {}) => new Response(JSON.stringify(data), { status, headers: { 'content-type': 'application/json; charset=utf-8', ...cors(), ...extra } });
const text = (body, status, type, extra = {}) => new Response(body, { status, headers: { 'content-type': type, ...cors(), ...extra } });
const cors = () => ({ 'access-control-allow-origin': '*', 'access-control-allow-methods': 'GET,POST,DELETE,OPTIONS', 'access-control-allow-headers': 'authorization,content-type' });

function randomId(n, alphabet = ID_ALPHABET) {
  const bytes = crypto.getRandomValues(new Uint8Array(n));
  return [...bytes].map((b) => alphabet[b % alphabet.length]).join('');
}

async function sha256(s) {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

// Only the fields the calendar needs, with the same shape the PWA's workingCopy() produces.
function cleanEvent(x) {
  if (!x || typeof x !== 'object') return null;
  const e = {};
  for (const k of EVENT_FIELDS) if (x[k] !== undefined && x[k] !== null && x[k] !== '') e[k] = x[k];
  if (typeof e.title !== 'string' || !e.title.trim() || !/^\d{4}-\d{2}-\d{2}$/.test(e.date || '')) return null;
  e.title = e.title.trim().slice(0, 120);
  if (!['test', 'deadline', 'lecture', 'other'].includes(e.type)) e.type = 'other';
  for (const k of ['start', 'end', 'reportAt']) if (e[k] && !/^\d{2}:\d{2}$/.test(e[k])) delete e[k];
  if (e.venue) e.venue = String(e.venue).slice(0, 120);
  if (e.link && !/^https?:\/\/\S+$/.test(e.link)) delete e.link;
  e.durationMin = Number(e.durationMin) || undefined;
  e.repeat = Number(e.repeat) || undefined;
  return e;
}

const classKey = (id) => `class:${id}`;

async function loadClass(env, id) {
  if (!/^[a-z0-9]{6,12}$/.test(id)) return null;
  const raw = await env.CLASSES.get(classKey(id));
  return raw ? JSON.parse(raw) : null;
}

async function authed(request, cls) {
  const m = /^Bearer\s+(\S+)$/.exec(request.headers.get('authorization') || '');
  return Boolean(m && cls && (await sha256(m[1])) === cls.secretHash);
}

async function readJson(request) {
  const len = Number(request.headers.get('content-length') || 0);
  if (len > MAX_BODY) throw new Error('Body too large');
  const body = await request.text();
  if (body.length > MAX_BODY) throw new Error('Body too large');
  return body ? JSON.parse(body) : {};
}

function subscribePage(cls, id, origin, appUrl) {
  const feed = `${origin}/c/${id}.ics`;
  const webcal = feed.replace(/^https?:/, 'webcal:');
  const google = `https://calendar.google.com/calendar/r?cid=${encodeURIComponent(webcal)}`;
  const events = Object.values(cls.events).filter((e) => !e.cancelled).sort((a, b) => `${a.date}${a.start || ''}`.localeCompare(`${b.date}${b.start || ''}`));
  const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const rows = events.slice(0, 50).map((e) => `<li><b>${esc(e.date)}</b> ${esc(e.start ? (e.type === 'deadline' ? `by ${e.start}` : e.end ? `${e.start}-${e.end}` : e.start) : 'all day')} · ${esc(e.title)}${e.venue ? ` · ${esc(e.venue)}` : ''}</li>`).join('');
  const share = appUrl ? `${appUrl}#c=${id}` : null;
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(cls.name)} · class calendar</title>
<style>body{font:16px/1.5 system-ui,sans-serif;max-width:640px;margin:0 auto;padding:20px;color:#1d1b26;background:#efeef2}
.card{background:#fdfdfc;border:1px solid #d9d7e1;border-radius:8px;padding:16px;margin:16px 0}
a.btn{display:inline-block;margin:6px 8px 6px 0;padding:10px 14px;border-radius:6px;border:1px solid #8f8aa6;color:#1d1b26;text-decoration:none;font-weight:600;background:#fff}
a.btn.p{background:#3d2c8d;border-color:#3d2c8d;color:#fff}code{word-break:break-all}ul{padding-left:18px}small{color:#55526a}</style></head><body>
<h1>${esc(cls.name)}</h1><p>One calendar for the whole class. Subscribe once; when the class representative publishes a new or revised notice, your calendar updates by itself.</p>
<div class="card"><a class="btn p" href="${google}">Add to Google Calendar</a><a class="btn" href="${webcal}">Apple / Outlook (webcal)</a>${share ? `<a class="btn" href="${esc(share)}">Open in Notice Decoder</a>` : ''}
<p><small>Feed address: <code>${esc(feed)}</code>. Google refreshes subscribed calendars every 12 to 24 hours; the Notice Decoder app shows changes at once.</small></p></div>
<div class="card"><h2>${events.length} upcoming event${events.length === 1 ? '' : 's'}</h2><ul>${rows || '<li>Nothing published yet.</li>'}</ul></div>
<p><small>Published with Notice Decoder. Check the original notice for changes.</small></p></body></html>`;
}

export async function handle(request, env) {
  const url = new URL(request.url);
  const path = url.pathname.replace(/\/+$/, '') || '/';
  if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors() });

  try {
    // Create a class
    if (request.method === 'POST' && path === '/api/class') {
      const body = await readJson(request);
      const name = String(body.name || '').trim().slice(0, 80);
      if (!name) return json({ error: 'Give the class a name.' }, 400);
      const id = randomId(8), secret = randomId(32, 'abcdefghijklmnopqrstuvwxyz0123456789');
      const cls = { name, secretHash: await sha256(secret), events: {}, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() };
      await env.CLASSES.put(classKey(id), JSON.stringify(cls));
      return json({ id, secret, name, feed: `${url.origin}/c/${id}.ics`, page: `${url.origin}/c/${id}` }, 201);
    }

    // Publish (merge by UID) and get the term-wide clash report back
    let m = /^\/api\/class\/([a-z0-9]+)\/publish$/.exec(path);
    if (request.method === 'POST' && m) {
      const cls = await loadClass(env, m[1]);
      if (!cls) return json({ error: 'No such class.' }, 404);
      if (!(await authed(request, cls))) return json({ error: 'Wrong or missing class secret.' }, 401);
      const body = await readJson(request);
      const incoming = (Array.isArray(body.events) ? body.events : []).map(cleanEvent).filter(Boolean);
      if (!incoming.length) return json({ error: 'No events with a title and a date.' }, 400);
      if (body.replace) cls.events = {};
      let added = 0, updated = 0;
      for (const entry of calendarEntries(incoming)) {
        if (cls.events[entry.uid]) updated++; else added++;
        cls.events[entry.uid] = { ...entry.event, uid: entry.uid, publishedAt: new Date().toISOString() };
      }
      const keep = Object.values(cls.events).sort((a, b) => (b.publishedAt || '').localeCompare(a.publishedAt || '')).slice(0, MAX_EVENTS);
      cls.events = Object.fromEntries(keep.map((e) => [e.uid, e]));
      cls.updatedAt = new Date().toISOString();
      await env.CLASSES.put(classKey(m[1]), JSON.stringify(cls));
      const live = Object.values(cls.events).filter((e) => !e.cancelled).map((e) => ({ ...e, id: e.uid }));
      const byId = new Map(live.map((e) => [e.id, e]));
      const clashes = findClashes(live).filter((c) => c.kind !== 'none').map((c) => ({ a: byId.get(c.a).title, b: byId.get(c.b).title, date: byId.get(c.a).date, msg: c.msg, action: c.action }));
      return json({ id: m[1], added, updated, count: live.length, clashes, feed: `${url.origin}/c/${m[1]}.ics`, page: `${url.origin}/c/${m[1]}` });
    }

    // CR console: everything published, with the term-wide clash report (Bearer only; students use /c/:id.json)
    m = /^\/api\/class\/([a-z0-9]+)\/events$/.exec(path);
    if (request.method === 'GET' && m) {
      const cls = await loadClass(env, m[1]);
      if (!cls) return json({ error: 'No such class.' }, 404);
      if (!(await authed(request, cls))) return json({ error: 'Wrong or missing class secret.' }, 401);
      const all = Object.values(cls.events).map((e) => ({ ...e, id: e.uid })).sort((a, b) => `${a.date}${a.start || ''}`.localeCompare(`${b.date}${b.start || ''}`));
      const live = all.filter((e) => !e.cancelled);
      const byId = new Map(live.map((e) => [e.id, e]));
      const clashes = findClashes(live).filter((c) => c.kind !== 'none').map((c) => ({ a: byId.get(c.a).title, b: byId.get(c.b).title, date: byId.get(c.a).date, msg: c.msg, action: c.action }));
      return json({ id: m[1], name: cls.name, updatedAt: cls.updatedAt, events: all, clashes, feed: `${url.origin}/c/${m[1]}.ics`, page: `${url.origin}/c/${m[1]}` });
    }

    // Cancel one event
    m = /^\/api\/class\/([a-z0-9]+)\/events\/([^/]+)$/.exec(path);
    if (request.method === 'DELETE' && m) {
      const cls = await loadClass(env, m[1]);
      if (!cls) return json({ error: 'No such class.' }, 404);
      if (!(await authed(request, cls))) return json({ error: 'Wrong or missing class secret.' }, 401);
      const uid = decodeURIComponent(m[2]);
      if (!cls.events[uid]) return json({ error: 'No such event.' }, 404);
      cls.events[uid] = { ...cls.events[uid], cancelled: true, publishedAt: new Date().toISOString() };
      cls.updatedAt = new Date().toISOString();
      await env.CLASSES.put(classKey(m[1]), JSON.stringify(cls));
      return json({ ok: true, uid });
    }

    // Feeds
    m = /^\/c\/([a-z0-9]+)(\.ics|\.json)?$/.exec(path);
    if (request.method === 'GET' && m) {
      const cls = await loadClass(env, m[1]);
      if (!cls) return text('No such class.', 404, 'text/plain; charset=utf-8');
      const events = Object.values(cls.events).map((e) => ({ ...e, id: e.uid }));
      // Pollers (the Android app every 15 min, calendar apps) get a 304 until something was published.
      const etag = `"${await sha256(`${m[1]}:${cls.updatedAt}:${m[2] || 'page'}`)}"`;
      if (request.headers.get('if-none-match') === etag) return new Response(null, { status: 304, headers: { etag, ...cors() } });
      const cache = { 'cache-control': 'public, max-age=300', etag };
      if (m[2] === '.ics') {
        // Apple and Outlook honour the refresh hints; Google ignores them (12 to 24 h on its own schedule).
        const ics = toICS(events, { calName: cls.name, now: new Date(cls.updatedAt) })
          .replace('X-WR-TIMEZONE:', `X-WR-CALDESC:Class notices published with Notice Decoder\r\nREFRESH-INTERVAL;VALUE=DURATION:PT1H\r\nX-PUBLISHED-TTL:PT1H\r\nX-WR-TIMEZONE:`);
        return text(ics, 200, 'text/calendar; charset=utf-8', { ...cache, 'content-disposition': `inline; filename="${m[1]}.ics"` });
      }
      if (m[2] === '.json') return json({ id: m[1], name: cls.name, updatedAt: cls.updatedAt, events }, 200, cache);
      return text(subscribePage(cls, m[1], url.origin, env.APP_URL), 200, 'text/html; charset=utf-8', cache);
    }

    if (path === '/' || path === '/health') return json({ ok: true, service: 'notice-decoder-feed' });
    return json({ error: 'Not found' }, 404);
  } catch (err) {
    const msg = String(err && err.message || err);
    return json({ error: /JSON|too large/i.test(msg) ? msg : 'Something went wrong.' }, /too large/i.test(msg) ? 413 : /JSON/i.test(msg) ? 400 : 500);
  }
}

export default { fetch: (request, env) => handle(request, env) };
