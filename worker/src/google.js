// "Join with Google", once: the student signs in one time, the class server keeps a refresh token (encrypted) and from
// then on writes every published, moved or cancelled event straight into a "Notice Decoder" calendar in that student's
// Google account, reminders included. Nothing to tap per notice; Google's own reminders ring on the phone.
//
// Scope is calendar.app.created (+ openid email to know who joined): non-sensitive, no "unverified app" screen, and the
// server can only ever touch the calendar it created. Same UIDs as the .ics and the in-app writer (calendarEntries),
// so a moved notice updates the same event everywhere.
import { calendarEntries, TZ } from '../../app/engine/ics.js';

const SCOPE = 'openid email https://www.googleapis.com/auth/calendar.app.created';
const AUTH = 'https://accounts.google.com/o/oauth2/v2/auth';
const TOKEN = 'https://oauth2.googleapis.com/token';
const REVOKE = 'https://oauth2.googleapis.com/revoke';
const CAL_API = 'https://www.googleapis.com/calendar/v3';
const CAL_NAME = 'Notice Decoder';
const STATE_TTL_MS = 15 * 60 * 1000;
export const MAX_MEMBERS = 400;
const CHUNK = 8; // members synced per alarm run (a Worker invocation has a small subrequest budget)

const enc = new TextEncoder(), dec = new TextDecoder();
const b64u = (buf) => btoa(String.fromCharCode(...new Uint8Array(buf))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const unb64u = (s) => Uint8Array.from(atob(s.replace(/-/g, '+').replace(/_/g, '/').padEnd(Math.ceil(s.length / 4) * 4, '=')), (c) => c.charCodeAt(0));
export const googleConfigured = (env) => Boolean(env.GOOGLE_CLIENT_ID && env.GOOGLE_CLIENT_SECRET && env.TOKEN_KEY);
const fetchFn = (env) => env.GOOGLE_FETCH || fetch;

// ---------- secrets at rest: AES-GCM with TOKEN_KEY; HMAC for the OAuth state ----------
async function aesKey(env) { return crypto.subtle.importKey('raw', unb64u(env.TOKEN_KEY).slice(0, 32), 'AES-GCM', false, ['encrypt', 'decrypt']); }
async function hmacKey(env) { return crypto.subtle.importKey('raw', unb64u(env.TOKEN_KEY), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign', 'verify']); }
export async function seal(env, text) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, await aesKey(env), enc.encode(text));
  return `${b64u(iv)}.${b64u(ct)}`;
}
export async function open(env, sealed) {
  const [iv, ct] = sealed.split('.').map(unb64u);
  return dec.decode(await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, await aesKey(env), ct));
}
async function signState(env, obj) {
  const body = b64u(enc.encode(JSON.stringify(obj)));
  return `${body}.${b64u(await crypto.subtle.sign('HMAC', await hmacKey(env), enc.encode(body)))}`;
}
export async function readState(env, s) {
  const [body, sig] = String(s || '').split('.');
  if (!body || !sig) return null;
  const ok = await crypto.subtle.verify('HMAC', await hmacKey(env), unb64u(sig), enc.encode(body)).catch(() => false);
  if (!ok) return null;
  const obj = JSON.parse(dec.decode(unb64u(body)));
  return obj && Date.now() - obj.t < STATE_TTL_MS ? obj : null;
}

// ---------- the OAuth dance ----------
export async function startUrl(env, { classId, back, origin }) {
  const state = await signState(env, { c: classId, b: back === 'app' ? 'app' : 'page', t: Date.now(), n: b64u(crypto.getRandomValues(new Uint8Array(8))) });
  const q = new URLSearchParams({ client_id: env.GOOGLE_CLIENT_ID, redirect_uri: `${origin}/oauth/callback`, response_type: 'code', scope: SCOPE, access_type: 'offline', prompt: 'consent', state });
  return `${AUTH}?${q}`;
}

async function tokenCall(env, params) {
  const res = await fetchFn(env)(TOKEN, { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ client_id: env.GOOGLE_CLIENT_ID, client_secret: env.GOOGLE_CLIENT_SECRET, ...params }) });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) { const e = new Error(data.error_description || data.error || `Google token endpoint said ${res.status}`); e.code = data.error; e.status = res.status; throw e; }
  return data;
}

// code -> tokens -> a member record on the class. Returns { sub, email, member }.
export async function exchangeCode(env, { code, origin }) {
  const t = await tokenCall(env, { code, grant_type: 'authorization_code', redirect_uri: `${origin}/oauth/callback` });
  const claims = t.id_token ? JSON.parse(dec.decode(unb64u(t.id_token.split('.')[1]))) : {};
  if (!claims.sub) throw new Error('Google did not say who signed in.');
  if (!t.refresh_token) throw Object.assign(new Error('Google gave no long-term access. Remove Notice Decoder at myaccount.google.com/permissions and join again.'), { code: 'no_refresh' });
  return { sub: claims.sub, email: claims.email || '', refresh: await seal(env, t.refresh_token), access: { token: t.access_token, exp: Date.now() + (t.expires_in || 3600) * 1000 - 60000 } };
}

export function addMember(cls, { sub, email, refresh }) {
  cls.members = cls.members || {};
  const was = cls.members[sub];
  if (!was && Object.keys(cls.members).length >= MAX_MEMBERS) return null;
  cls.members[sub] = { email, refresh, calendarId: was?.calendarId || null, map: was?.map || {}, joinedAt: was?.joinedAt || new Date().toISOString(), synced: null, fails: 0, revoked: false };
  return cls.members[sub];
}

export async function removeMember(env, cls, sub) {
  const m = cls.members?.[sub];
  if (!m) return false;
  delete cls.members[sub];
  try { await fetchFn(env)(`${REVOKE}?token=${encodeURIComponent(await open(env, m.refresh))}`, { method: 'POST' }); } catch { /* the token may be dead already */ }
  return true;
}

// ---------- the calendar writer (server side twin of app/gcal.js) ----------
function toGoogleEvent(entry) {
  const body = {
    iCalUID: entry.uid, summary: entry.summary, description: entry.description,
    start: entry.allDay ? { date: entry.start } : { dateTime: entry.start, timeZone: TZ },
    end: entry.allDay ? { date: entry.end } : { dateTime: entry.end, timeZone: TZ },
    colorId: entry.colorId,
    reminders: entry.reminder ? { useDefault: false, overrides: [{ method: 'popup', minutes: entry.reminder.minutes }] } : { useDefault: true },
    extendedProperties: { private: { noticeDecoder: '1', type: entry.type } },
    status: entry.event.cancelled ? 'cancelled' : 'confirmed',
  };
  if (entry.location) body.location = entry.location;
  if (entry.recurrence) body.recurrence = [entry.recurrence];
  if (entry.url) body.source = { title: 'Link', url: entry.url };
  return body;
}

async function api(env, access, method, url, body) {
  const res = await fetchFn(env)(url, { method, headers: { Authorization: `Bearer ${access}`, 'content-type': 'application/json' }, body: body ? JSON.stringify(body) : undefined });
  if (res.status === 204) return null;
  const data = await res.json().catch(() => ({}));
  if (!res.ok) { const e = new Error(data?.error?.message || `Google Calendar said ${res.status}`); e.status = res.status; throw e; }
  return data;
}

async function accessToken(env, m) {
  if (m.access && m.access.exp > Date.now()) return m.access.token;
  const t = await tokenCall(env, { refresh_token: await open(env, m.refresh), grant_type: 'refresh_token' });
  m.access = { token: t.access_token, exp: Date.now() + (t.expires_in || 3600) * 1000 - 60000 };
  return t.access_token;
}

async function calendarFor(env, m, access) {
  if (m.calendarId) {
    try { await api(env, access, 'GET', `${CAL_API}/calendars/${encodeURIComponent(m.calendarId)}`); return m.calendarId; } catch (err) { if (err.status === 401 || err.status === 403) throw err; m.calendarId = null; m.map = {}; }
  }
  const made = await api(env, access, 'POST', `${CAL_API}/calendars`, { summary: CAL_NAME, description: 'Class events published with Notice Decoder.', timeZone: TZ });
  m.calendarId = made.id;
  // Make it visible straight away (a new calendar is hidden by default in Google Calendar on the phone).
  try { await api(env, access, 'PATCH', `${CAL_API}/users/me/calendarList/${encodeURIComponent(made.id)}`, { selected: true, defaultReminders: [] }); } catch { /* visibility only */ }
  return made.id;
}

// Write what changed since this member was last synced (everything on the first run). Returns {written, failed}.
export async function syncMember(env, cls, sub, { all = false } = {}) {
  const m = cls.members[sub];
  const out = { written: 0, failed: 0 };
  if (!m || m.revoked) return out;
  let access;
  try { access = await accessToken(env, m); } catch (err) {
    if (err.code === 'invalid_grant' || err.status === 400 || err.status === 401) { m.revoked = true; return out; } // the student removed the app
    m.fails = (m.fails || 0) + 1; return out;
  }
  let cal;
  try { cal = await calendarFor(env, m, access); } catch (err) { if (err.status === 401 || err.status === 403) m.revoked = true; else m.fails = (m.fails || 0) + 1; return out; }
  const events = Object.values(cls.events).filter((e) => all || !m.synced || (e.publishedAt || '') > m.synced);
  const base = `${CAL_API}/calendars/${encodeURIComponent(cal)}/events`;
  for (const entry of calendarEntries(events.map((e) => ({ ...e, id: e.uid })))) {
    const body = toGoogleEvent(entry);
    try {
      const known = m.map[entry.uid];
      if (known) {
        try { await api(env, access, 'PATCH', `${base}/${encodeURIComponent(known)}`, body); out.written++; continue; } catch (err) { if (err.status !== 404 && err.status !== 410) throw err; delete m.map[entry.uid]; }
      }
      if (entry.event.cancelled) continue; // never written, nothing to cancel
      const res = await api(env, access, 'POST', `${base}/import`, body);
      m.map[entry.uid] = res.id;
      out.written++;
    } catch (err) {
      if (err.status === 401 || err.status === 403) { m.revoked = true; break; }
      out.failed++;
    }
  }
  if (!out.failed) m.synced = cls.updatedAt;
  m.fails = out.failed ? (m.fails || 0) + 1 : 0;
  return out;
}

// After a change: queue every member; the alarm drains the queue a chunk at a time.
export function queueAll(cls) {
  const subs = Object.keys(cls.members || {}).filter((s) => !cls.members[s].revoked);
  cls.syncQueue = [...new Set([...(cls.syncQueue || []), ...subs])];
  return cls.syncQueue.length;
}

export async function drainQueue(env, cls) {
  const batch = (cls.syncQueue || []).slice(0, CHUNK);
  for (const sub of batch) await syncMember(env, cls, sub);
  cls.syncQueue = (cls.syncQueue || []).slice(batch.length);
  return { done: batch.length, left: cls.syncQueue.length };
}

export const memberSummary = (cls) => {
  const all = Object.values(cls.members || {});
  return { joined: all.filter((m) => !m.revoked).length, needReconnect: all.filter((m) => m.revoked).length };
};
