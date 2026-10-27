// Class feed: a class representative publishes reviewed events once; the whole class subscribes to one calendar
// link that updates itself. One Cloudflare Worker + one KV namespace, free tier. The event -> calendar mapping
// (UIDs, times, reminders) is the app's own engine/ics.js, so the feed, the .ics download and the Google writer agree.
//
//   POST   /api/class                        {name}                   -> {id, secret}   (secret shown once, kept by the CR)
//   POST   /api/class/:id/publish[?dry=1]    Bearer, {events, intents} -> the plan (dry) or {plan, added, moved, ...}
//   GET    /api/class/:id/events             Bearer                   -> CR console: events, clashes, changes, pilot stats
//   PATCH  /api/class/:id                    Bearer, {name}           -> rename
//   POST   /api/class/:id/rotate             Bearer                   -> a new secret (the old one stops working)
//   DELETE /api/class/:id                    Bearer                   -> delete the class and its feed
//   PATCH  /api/class/:id/events/:uid        Bearer, {date,start,...} -> edit one published event (same UID)
//   DELETE /api/class/:id/events/:uid        Bearer                   -> cancel it (STATUS:CANCELLED, subscribers drop it)
//   POST   /api/class/:id/events/:uid/restore Bearer                  -> undo a cancel
//   GET    /c/:id.ics | /c/:id.json | /c/:id                          -> webcal feed, JSON, subscribe page
//   POST   /api/ai/refine                    {text, events}           -> AI check of the names and types (see ai.js)
import { toICS } from '../../app/engine/ics.js';
import { MAX_EVENTS, cleanEvent, upgrade, plan, apply, edit, setCancelled, liveEvents, clashReport, stats, publicChanges, istToday } from './feed.js';
import { subscribePage } from './page.js';
import { refine } from './ai.js';
import { addSubscription, removeSubscription, pushAll, pushConfigured, nextReminder, dueReminders } from './push.js';
import { googleConfigured, startUrl, readState, exchangeCode, addMember, removeMember, syncMember, queueAll, queueOne, drainQueue, farewell, memberSummary, BUDGET } from './google.js';

const MAX_BODY = 128 * 1024;
const MAX_INCOMING = 100;
const ID_ALPHABET = 'abcdefghjkmnpqrstuvwxyz23456789'; // no 0/o/1/l/i

const cors = () => ({ 'access-control-allow-origin': '*', 'access-control-allow-methods': 'GET,POST,PATCH,DELETE,OPTIONS', 'access-control-allow-headers': 'authorization,content-type', 'access-control-max-age': '86400' });
const json = (data, status = 200, extra = {}) => new Response(JSON.stringify(data), { status, headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', ...cors(), ...extra } });
const text = (body, status, type, extra = {}) => new Response(body, { status, headers: { 'content-type': type, ...cors(), ...extra } });

function randomId(n, alphabet = ID_ALPHABET) {
  // Rejection sampling: `b % 31` alone makes the first letters of the alphabet more likely.
  const out = [];
  const limit = 256 - (256 % alphabet.length);
  while (out.length < n) for (const b of crypto.getRandomValues(new Uint8Array(n * 2))) if (b < limit && out.length < n) out.push(alphabet[b % alphabet.length]);
  return out.join('');
}

async function sha256(s) {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

const classKey = (id) => `class:${id}`;
const validId = (id) => /^[a-z0-9]{6,12}$/.test(id);

async function loadClass(env, id) {
  if (!validId(id)) return null;
  const raw = await env.CLASSES.get(classKey(id));
  if (!raw) return null;
  try { return upgrade(JSON.parse(raw)); } catch { return null; }
}
const saveClass = (env, id, cls) => env.CLASSES.put(classKey(id), JSON.stringify(cls));

// Constant-time compare of the two hashes: the secret is 32 random characters, but there is no reason to leak timing.
async function authed(request, cls) {
  const m = /^Bearer\s+(\S{8,200})$/.exec(request.headers.get('authorization') || '');
  if (!m || !cls) return false;
  const a = await sha256(m[1]), b = cls.secretHash || '';
  let diff = a.length ^ b.length;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ (b.charCodeAt(i) || 0);
  return diff === 0;
}

async function readJson(request) {
  const len = Number(request.headers.get('content-length') || 0);
  if (len > MAX_BODY) throw new Error('Body too large');
  const body = await request.text();
  if (body.length > MAX_BODY) throw new Error('Body too large');
  const data = body ? JSON.parse(body) : {};
  if (!data || typeof data !== 'object' || Array.isArray(data)) throw new SyntaxError('JSON body must be an object');
  return data;
}

async function limited(binding, key) {
  if (!binding?.limit) return false;
  try { return !(await binding.limit({ key })).success; } catch { return false; }
}

const urls = (origin, id) => ({ feed: `${origin}/c/${id}.ics`, page: `${origin}/c/${id}` });

// `newId`: the id the router picked for a class being created (its Durable Object is named after it).
export async function handle(request, env, { newId } = {}) {
  const url = new URL(request.url);
  const path = url.pathname.replace(/\/+$/, '') || '/';
  const ip = request.headers.get('cf-connecting-ip') || 'local';
  const today = /^\d{4}-\d{2}-\d{2}$/.test(env.TODAY || '') ? env.TODAY : istToday(); // TODAY: tests only
  if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors() });

  try {
    if (request.method === 'POST' && path === '/api/ai/refine') return await refine(request, env, { json, ip, today });

    // "Join with Google": off to Google's consent screen, the class id signed into `state`.
    if (request.method === 'GET' && path === '/oauth/start') {
      if (!googleConfigured(env)) return text('Google sign-in is not set up on this server.', 503, 'text/plain; charset=utf-8');
      const classId = url.searchParams.get('class') || '';
      if (!validId(classId)) return text('Which class? Open the class link and press Join there.', 400, 'text/plain; charset=utf-8');
      return Response.redirect(await startUrl(env, { classId, back: url.searchParams.get('back'), origin: url.origin }), 302);
    }
    // Back from Google (routed to the class's own object by `route`).
    if (request.method === 'GET' && path === '/oauth/callback') {
      const st = await readState(env, url.searchParams.get('state'));
      const page = (id) => `${url.origin}/c/${id}`;
      if (!st) return text('This sign-in link is not valid any more. Open the class link and press Join again.', 400, 'text/plain; charset=utf-8');
      const back = (q) => Response.redirect(st.b === 'app' && env.APP_URL ? `${env.APP_URL}?${q}#c=${st.c}` : `${page(st.c)}?${q}`, 302);
      if (url.searchParams.get('error')) return back('joined=no');
      const cls = await loadClass(env, st.c);
      if (!cls) return text('No such class.', 404, 'text/plain; charset=utf-8');
      let who;
      try { who = await exchangeCode(env, { code: url.searchParams.get('code') || '', origin: url.origin }); } catch (err) { console.error('oauth exchange', err.message); return back(err.code === 'no_refresh' ? 'joined=norefresh' : err.code === 'no_scope' ? 'joined=noscope' : 'joined=no'); }
      if (!addMember(cls, who)) return back('joined=full');
      await saveClass(env, st.c, cls);
      // The events are there before the page comes back (a big class finishes from the alarm a moment later).
      const r = await syncMember(env, cls, who.sub, { budget: { left: BUDGET - 2 } });
      if (r.incomplete) queueOne(cls, who.sub);
      await saveClass(env, st.c, cls);
      if (env.AFTER_CHANGE) env.AFTER_CHANGE(cls, { silent: true });
      const cookie = `nd_member_${st.c}=${encodeURIComponent(who.sub)}; Path=/; Max-Age=31536000; Secure; HttpOnly; SameSite=Lax`;
      const res = back(`joined=${encodeURIComponent(who.email || 'yes')}&written=${r.written}`);
      return new Response(null, { status: 302, headers: { location: res.headers.get('location'), 'set-cookie': cookie } });
    }

    // Create a class
    if (request.method === 'POST' && path === '/api/class') {
      if (await limited(env.CREATE_LIMIT, ip)) return json({ error: 'Too many classes created from this network. Wait a minute.' }, 429, { 'retry-after': '60' });
      const body = await readJson(request);
      const name = (typeof body.name === 'string' ? body.name : '').replace(/\s+/g, ' ').trim().slice(0, 80);
      if (!name) return json({ error: 'Give the class a name.' }, 400);
      let id = newId && validId(newId) ? newId : null;
      while (!id || await env.CLASSES.get(classKey(id))) id = randomId(8);
      const secret = randomId(32, 'abcdefghijklmnopqrstuvwxyz0123456789');
      const now = new Date().toISOString();
      const cls = upgrade({ name, secretHash: await sha256(secret), events: {}, createdAt: now, updatedAt: now });
      await saveClass(env, id, cls);
      return json({ id, secret, name, ...urls(url.origin, id) }, 201);
    }

    let m = /^\/api\/class\/([^/]+)(?:\/(publish|events|rotate|push|leave))?(?:\/([^/]+))?(?:\/(restore))?$/.exec(path);
    if (m) {
      const [, id, part, uidRaw, restore] = m;
      const cls = await loadClass(env, id);
      if (!cls) return json({ error: 'No such class. Check the link, or create a new class.' }, 404);
      if (part === 'leave' && !uidRaw && request.method === 'POST') {
        const sub = decodeURIComponent((request.headers.get('cookie') || '').match(new RegExp(`nd_member_${id}=([^;]+)`))?.[1] || '');
        if (!sub || !cls.members?.[sub]) return json({ error: 'This phone is not joined to the class.' }, 404);
        await removeMember(env, cls, sub);
        await saveClass(env, id, cls);
        const gone = `nd_member_${id}=; Path=/; Max-Age=0; Secure; HttpOnly; SameSite=Lax`;
        if (/application\/json/.test(request.headers.get('accept') || '')) return json({ ok: true }, 200, { 'set-cookie': gone });
        return new Response(null, { status: 303, headers: { location: `${url.origin}/c/${id}?left=1`, 'set-cookie': gone } }); // the page's Leave form
      }
      if (part === 'push' && !uidRaw) {
        if (request.method !== 'POST' && request.method !== 'DELETE') return json({ error: 'Not found' }, 404);
        if (!pushConfigured(env)) return json({ error: 'Notifications are not set up on this server.' }, 503);
        const body = await readJson(request);
        const endpoint = body.subscription?.endpoint || body.endpoint;
        if (request.method === 'DELETE') { removeSubscription(cls, endpoint); await saveClass(env, id, cls); return json({ ok: true }); }
        if (!addSubscription(cls, { endpoint })) return json({ error: 'That does not look like a push subscription, or the class is full.' }, 400);
        await saveClass(env, id, cls);
        if (env.AFTER_CHANGE) env.AFTER_CHANGE(cls, { silent: true }); // arm the reminder alarm for this phone too
        return json({ ok: true, subscribers: Object.keys(cls.subs).length, nextReminder: nextReminder(cls) });
      }
      if (!(await authed(request, cls))) return json({ error: 'Wrong or missing class key. Only the class representative can change this class.' }, 401);
      const done = async (data, status = 200, { changed = true } = {}) => { await saveClass(env, id, cls); if (changed && env.AFTER_CHANGE) env.AFTER_CHANGE(cls); return json(data, status); };

      // Publish: plan first; ?dry=1 returns only the plan, so the CR sees what will change before the class does.
      if (part === 'publish' && !uidRaw && request.method === 'POST') {
        const body = await readJson(request);
        const raw = Array.isArray(body.events) ? body.events.slice(0, MAX_INCOMING) : [];
        const incoming = raw.map(cleanEvent).filter(Boolean);
        if (!incoming.length) return json({ error: 'No events with a title and a real date to publish.' }, 400);
        const intents = body.intents && typeof body.intents === 'object' ? body.intents : {};
        if (body.replace === true) cls.events = {};
        const items = plan(cls, incoming, intents, today);
        const skipped = raw.length - incoming.length;
        if (url.searchParams.get('dry') === '1') return json({ id, plan: items, skipped });
        const counts = apply(cls, incoming, items);
        cls.stats.publishes++;
        const clashes = clashReport(cls, today);
        // Every clash pair is counted once, the first time a publish shows it: "clashes the class heard about before the date".
        cls.stats.clashSeen = [...new Set([...cls.stats.clashSeen, ...clashes.map((c) => `${c.a}|${c.b}|${c.date}`)])].slice(-500);
        return done({ id, plan: items, skipped, ...counts, count: liveEvents(cls).length, clashes, ...urls(url.origin, id) }, 200, { changed: items.some((x) => !['same', 'past'].includes(x.action)) });
      }

      // CR console: everything published, the clash report, what changed, the pilot numbers (Bearer only).
      if (part === 'events' && !uidRaw && request.method === 'GET') {
        const all = Object.values(cls.events).map((e) => ({ ...e, id: e.uid })).sort((a, b) => `${a.date}${a.start || ''}`.localeCompare(`${b.date}${b.start || ''}`));
        return json({ id, name: cls.name, updatedAt: cls.updatedAt, events: all, clashes: clashReport(cls, today), changes: publicChanges(cls, 40), stats: stats(cls), members: memberSummary(cls), subscribers: Object.keys(cls.subs || {}).length, today, ...urls(url.origin, id) });
      }

      if (!part && uidRaw) return json({ error: 'Not found' }, 404);
      if (!part && request.method === 'PATCH') {
        const body = await readJson(request);
        const name = (typeof body.name === 'string' ? body.name : '').replace(/\s+/g, ' ').trim().slice(0, 80);
        if (!name) return json({ error: 'Give the class a name.' }, 400);
        cls.name = name;
        cls.updatedAt = new Date().toISOString();
        return done({ ok: true, id, name });
      }
      if (part === 'rotate' && !uidRaw && !restore && request.method === 'POST') {
        const secret = randomId(32, 'abcdefghijklmnopqrstuvwxyz0123456789');
        cls.secretHash = await sha256(secret);
        return done({ ok: true, id, secret, name: cls.name, ...urls(url.origin, id) });
      }
      if (!part && request.method === 'DELETE') {
        // Joined students: their class calendar is removed and our access revoked (as many as one run allows).
        const budget = { left: BUDGET };
        for (const m of Object.values(cls.members || {})) { if (budget.left < 3) break; await farewell(env, m, budget); }
        await env.CLASSES.delete(classKey(id));
        return json({ ok: true, id, deleted: true });
      }

      if (part === 'events' && uidRaw) {
        let uid;
        try { uid = decodeURIComponent(uidRaw); } catch { return json({ error: 'Bad event id.' }, 400); }
        if (!cls.events[uid]) return json({ error: 'No such event in this class.' }, 404);
        if (restore && request.method === 'POST') { setCancelled(cls, uid, false); return done({ ok: true, uid, event: cls.events[uid] }); }
        if (!restore && request.method === 'DELETE') { setCancelled(cls, uid, true); return done({ ok: true, uid }); }
        if (!restore && request.method === 'PATCH') {
          const body = await readJson(request);
          const patch = {};
          for (const k of ['title', 'type', 'date', 'start', 'end', 'venue', 'link', 'durationMin']) if (k in body) patch[k] = body[k] === '' ? null : body[k];
          const event = edit(cls, uid, patch);
          if (!event) return json({ error: 'That edit leaves the event without a title or a real date.' }, 400);
          return done({ ok: true, uid, event });
        }
      }
      return json({ error: 'Not found' }, 404);
    }

    // Feeds
    m = /^\/c\/([a-z0-9]+)(\.ics|\.json)?$/.exec(path);
    if ((request.method === 'GET' || request.method === 'HEAD') && m) {
      const [, id, kind] = m;
      const cls = await loadClass(env, id);
      if (!cls) return kind ? text('No such class.', 404, 'text/plain; charset=utf-8') : text('<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>No such class</title><p style="font:16px system-ui;padding:24px">No class with this link. Ask your class representative for the current link.</p>', 404, 'text/html; charset=utf-8');
      const events = Object.values(cls.events).map((e) => ({ ...e, id: e.uid }));
      // Pollers (the Android app every 15 min, calendar apps) get a 304 until something was published. The page also
      // changes at midnight (what is "upcoming"), so its tag carries the date.
      const etag = `"${(await sha256(`${id}:${cls.updatedAt}:${kind || `page:${today}`}`)).slice(0, 32)}"`;
      if (request.headers.get('if-none-match') === etag) return new Response(null, { status: 304, headers: { etag, ...cors() } });
      const cache = { 'cache-control': 'public, max-age=300', etag };
      if (kind === '.ics') {
        // Apple and Outlook honour the refresh hints; Google ignores them (12 to 24 h on its own schedule).
        const ics = toICS(events, { calName: cls.name, now: new Date(cls.updatedAt) })
          .replace('X-WR-TIMEZONE:', 'X-WR-CALDESC:Class notices published with Notice Decoder\r\nREFRESH-INTERVAL;VALUE=DURATION:PT1H\r\nX-PUBLISHED-TTL:PT1H\r\nX-WR-TIMEZONE:');
        return text(ics, 200, 'text/calendar; charset=utf-8', { ...cache, 'content-disposition': `inline; filename="${id}.ics"` });
      }
      if (kind === '.json') return json({ id, name: cls.name, updatedAt: cls.updatedAt, events, changes: publicChanges(cls), clashes: clashReport(cls, today), today, now: new Date().toISOString(), remind: dueReminders(cls) }, 200, cache);
      // The page a student reopens after the CR changed something: at most a minute old (the feeds keep 5 minutes; the
      // app revalidates them every time, and calendars poll on their own schedule).
      const sub = decodeURIComponent((request.headers.get('cookie') || '').match(new RegExp(`nd_member_${id}=([^;]+)`))?.[1] || '');
      const me = sub && cls.members?.[sub] ? { email: cls.members[sub].email, revoked: cls.members[sub].revoked } : null;
      return text(subscribePage({ cls, id, origin: url.origin, appUrl: env.APP_URL, today, clashes: clashReport(cls, today), changes: publicChanges(cls), google: googleConfigured(env), me, joined: url.searchParams.get('joined'), written: url.searchParams.get('written') }), 200, 'text/html; charset=utf-8', { ...cache, 'cache-control': 'private, max-age=60', vary: 'cookie', 'x-frame-options': 'DENY', 'referrer-policy': 'no-referrer' });
    }

    if (path === '/' || path === '/health') return json({ ok: true, service: 'notice-decoder-feed', ai: Boolean(env.ANTHROPIC_API_KEY), push: pushConfigured(env) ? env.VAPID_PUBLIC : null, google: googleConfigured(env), maxEvents: MAX_EVENTS });
    return json({ error: 'Not found' }, 404);
  } catch (err) {
    const msg = String(err && err.message || err);
    if (/too large/i.test(msg)) return json({ error: 'That is too much at once. Publish fewer events.' }, 413);
    if (err instanceof SyntaxError || /JSON/i.test(msg)) return json({ error: 'Bad JSON.' }, 400);
    console.error('feed error', err);
    return json({ error: 'Something went wrong on the class server. Try again.' }, 500);
  }
}

// ---------- one Durable Object per class: strongly consistent, one request at a time ----------
//
// KV alone was measured losing writes (26 Oct 2026, live): a read right after a publish came back with the class as it
// was BEFORE the publish (KV caches reads per data centre for about a minute), so a cancel or a second publish within
// that minute could write the old copy back and wipe what was just published. Every class request now goes to that
// class's own object, whose storage reads its own writes, and requests run one after another. KV keeps only the AI
// day counter, and is read once per class to bring over classes created before this change.
const TOMBSTONE = '__deleted__';

export class ClassRoom {
  constructor(ctx, env) {
    this.ctx = ctx;
    this.env = env;
  }

  store() {
    const s = this.ctx.storage, legacy = this.env.CLASSES;
    return {
      get: async (k) => {
        const v = await s.get(k);
        if (v === TOMBSTONE) return null;
        if (v !== undefined) return v;
        const old = k.startsWith('class:') && legacy ? await legacy.get(k) : null; // a class from before the move
        if (old) await s.put(k, old);
        return old;
      },
      put: (k, v) => s.put(k, v),
      // A tombstone, so a deleted class is not brought back from the old KV copy.
      delete: async (k) => { await s.put(k, TOMBSTONE); if (legacy) await legacy.delete(k); },
    };
  }

  roomEnv() {
    return {
      ...this.env,
      CLASSES: this.store(),
      // After a publish / edit / cancel: wake every subscribed phone now, and set the alarm for the next reminder.
      AFTER_CHANGE: (cls, { silent = false } = {}) => {
        this.ctx.waitUntil((async () => {
          if (!silent) {
            await pushAll(this.env, cls);
            if (googleConfigured(this.env)) queueAll(cls); // their Google Calendars are written by the alarm, a few members at a time
            await this.store().put(`class:${this.id}`, JSON.stringify(cls)); // dead subscriptions dropped, queue saved
          }
          await this.arm(cls);
        })());
      },
    };
  }

  async arm(cls) {
    const next = (cls.syncQueue || []).length ? Date.now() + 250 : nextReminder(cls);
    const cur = await this.ctx.storage.getAlarm();
    if (next && (!cur || Math.abs(cur - next) > 1000)) await this.ctx.storage.setAlarm(next);
    if (!next && cur) await this.ctx.storage.deleteAlarm();
  }

  async fetch(request) {
    const env = this.roomEnv();
    const newId = request.headers.get('x-nd-new-id') || undefined;
    if (!this.id) {
      this.id = (await this.ctx.storage.get('__id')) || new URL(request.url).pathname.match(/^\/(?:api\/class|c)\/([a-z0-9]{6,12})/)?.[1] || newId;
      if (this.id) await this.ctx.storage.put('__id', this.id);
    }
    return this.ctx.blockConcurrencyWhile(() => handle(request, env, { newId }));
  }

  // A reminder is due: push every subscribed phone (the service worker reads /c/:id.json `remind`), then re-arm.
  async alarm() {
    await this.ctx.blockConcurrencyWhile(async () => {
      const raw = this.id && await this.ctx.storage.get(`class:${this.id}`);
      if (!raw || raw === TOMBSTONE) { await this.ctx.storage.deleteAlarm(); return; }
      const cls = upgrade(JSON.parse(raw));
      let dirty = false;
      if ((cls.syncQueue || []).length && googleConfigured(this.env)) { await drainQueue(this.env, cls); dirty = true; }
      if (dueReminders(cls).length) { await pushAll(this.env, cls, { urgency: 'high' }); dirty = true; }
      if (dirty) await this.ctx.storage.put(`class:${this.id}`, JSON.stringify(cls));
      await this.arm(cls);
    });
  }
}

const CLASS_PATH = /^\/(?:api\/class|c)\/([a-z0-9]{6,12})(?:[./]|$)/;
const room = (env, id) => env.ROOMS.get(env.ROOMS.idFromName(id));

export async function route(request, env) {
  if (!env.ROOMS) return handle(request, env); // unit tests and old configs: the plain KV path
  const url = new URL(request.url);
  const path = url.pathname.replace(/\/+$/, '') || '/';
  if (request.method === 'POST' && path === '/api/class') {
    const id = randomId(8);
    const headers = new Headers(request.headers);
    headers.set('x-nd-new-id', id);
    return room(env, id).fetch(new Request(request, { headers }));
  }
  const m = request.method !== 'OPTIONS' && CLASS_PATH.exec(path);
  if (m) return room(env, m[1]).fetch(request);
  if (path === '/oauth/callback') {
    const st = await readState(env, url.searchParams.get('state'));
    if (st && validId(st.c)) return room(env, st.c).fetch(request);
  }
  return handle(request, env); // the AI check, /health, CORS preflights, 404s
}

export default { fetch: (request, env) => route(request, env) };
