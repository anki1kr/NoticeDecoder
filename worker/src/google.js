// "Join with Google", once: the student signs in one time, the class server keeps a refresh token (encrypted) and from
// then on writes every published, moved or cancelled event straight into a "Notice Decoder" calendar in that student's
// Google account, reminders included. Nothing to tap per notice; Google's own reminders ring on the phone.
//
// Scope is calendar.app.created (+ openid email to know who joined): non-sensitive, no "unverified app" screen, and the
// server can only ever touch the calendar it created. Same UIDs as the .ics and the in-app writer (calendarEntries),
// so a moved notice updates the same event everywhere.
import { calendarEntries, TZ } from '../../app/engine/ics.js';

const CAL_SCOPE = 'https://www.googleapis.com/auth/calendar.app.created';
const SCOPE = `openid email ${CAL_SCOPE}`;
const AUTH = 'https://accounts.google.com/o/oauth2/v2/auth';
const TOKEN = 'https://oauth2.googleapis.com/token';
const REVOKE = 'https://oauth2.googleapis.com/revoke';
const CAL_API = 'https://www.googleapis.com/calendar/v3';
const CAL_NAME = 'Notice Decoder';
const STATE_TTL_MS = 15 * 60 * 1000;
export const MAX_MEMBERS = 400;

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
  if (!String(t.scope || '').split(/\s+/).includes(CAL_SCOPE)) {
    // Granular consent: the calendar box was left unticked. Give back what we got and ask again.
    try { await fetchFn(env)(`${REVOKE}?token=${encodeURIComponent(t.refresh_token || t.access_token)}`, { method: 'POST' }); } catch { /* best effort */ }
    throw Object.assign(new Error('The calendar permission was not ticked.'), { code: 'no_scope' });
  }
  if (!t.refresh_token) throw Object.assign(new Error('Google gave no long-term access. Remove Notice Decoder at myaccount.google.com/permissions and join again.'), { code: 'no_refresh' });
  return { sub: claims.sub, email: claims.email || '', refresh: await seal(env, t.refresh_token), access: { token: t.access_token, exp: Date.now() + (t.expires_in || 3600) * 1000 - 60000 } };
}

export function addMember(cls, { sub, email, refresh, access }) {
  cls.members = cls.members || {};
  const was = cls.members[sub];
  if (!was && Object.keys(cls.members).length >= MAX_MEMBERS) return null;
  cls.members[sub] = { email, refresh, calendarId: was?.calendarId || null, map: was?.map || {}, ver: was?.ver || {}, joinedAt: was?.joinedAt || new Date().toISOString(), synced: null, fails: 0, revoked: false, access: access || null };
  return cls.members[sub];
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

// Every Google call spends one unit of a per-invocation budget: the Workers free plan allows 50 subrequests per
// request (an alarm run counts as one), so a run stops before the limit and the alarm carries on where it stopped.
export const BUDGET = 40;
const OUT_OF_BUDGET = Object.freeze({ outOfBudget: true });
const spend = (b) => { if (!b || b.left <= 0) throw OUT_OF_BUDGET; b.left -= 1; };

async function api(env, access, method, url, body, b) {
  spend(b);
  const res = await fetchFn(env)(url, { method, headers: { Authorization: `Bearer ${access}`, 'content-type': 'application/json' }, body: body ? JSON.stringify(body) : undefined });
  if (res.status === 204) return null;
  const data = await res.json().catch(() => ({}));
  if (!res.ok) { const e = new Error(data?.error?.message || `Google Calendar said ${res.status}`); e.status = res.status; throw e; }
  return data;
}

async function accessToken(env, m, b) {
  if (m.access && m.access.exp > Date.now()) return m.access.token;
  spend(b);
  const t = await tokenCall(env, { refresh_token: await open(env, m.refresh), grant_type: 'refresh_token' });
  m.access = { token: t.access_token, exp: Date.now() + (t.expires_in || 3600) * 1000 - 60000 };
  return t.access_token;
}

// One calendar per class in the student's account ("BCA DS · Notice Decoder"), so two classes stay apart and one can
// be hidden or left on its own.
const calendarName = (cls) => `${String(cls.name || 'Class').slice(0, 60)} · ${CAL_NAME}`;
async function calendarFor(env, cls, m, access, b) {
  if (m.calendarId) return m.calendarId;
  const made = await api(env, access, 'POST', `${CAL_API}/calendars`, { summary: calendarName(cls), description: 'Class events published with Notice Decoder. Leave the class on its page to remove this calendar.', timeZone: TZ }, b);
  m.calendarId = made.id;
  m.map = {};
  m.ver = {};
  // A new calendar is hidden by default in the Google Calendar phone app: mark it shown.
  try { await api(env, access, 'PATCH', `${CAL_API}/users/me/calendarList/${encodeURIComponent(made.id)}`, { selected: true }, b); } catch (err) { if (err === OUT_OF_BUDGET) throw err; }
  return made.id;
}

// A short fingerprint of what Google holds for an event: an event is written again only when this changes (a move, an
// edit, a cancel, or a new clash mark in its title).
function fingerprint(body) {
  let h = 0x811c9dc5;
  const str = JSON.stringify(body);
  for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 0x01000193); }
  return (h >>> 0).toString(36);
}

// Brings one member's calendar in line with the class. Idempotent and resumable: what was written is remembered per
// UID, so a run cut short by the budget simply continues next time. Returns { written, failed, incomplete }.
export async function syncMember(env, cls, sub, { budget = { left: BUDGET } } = {}) {
  const m = cls.members?.[sub];
  const out = { written: 0, failed: 0, incomplete: false };
  if (!m || m.revoked) return out;
  m.map = m.map || {};
  m.ver = m.ver || {};
  try {
    const access = await accessToken(env, m, budget);
    const cal = await calendarFor(env, cls, m, access, budget);
    const base = `${CAL_API}/calendars/${encodeURIComponent(cal)}/events`;
    // Entries for ALL events (clash marks depend on the neighbours), written only where the fingerprint moved.
    for (const entry of calendarEntries(Object.values(cls.events).map((e) => ({ ...e, id: e.uid })))) {
      const body = toGoogleEvent(entry);
      const fp = fingerprint(body);
      if (m.ver[entry.uid] === fp) continue;
      if (!m.map[entry.uid] && entry.event.cancelled) { m.ver[entry.uid] = fp; continue; } // never written, nothing to cancel
      try {
        if (m.map[entry.uid]) {
          try { await api(env, access, 'PATCH', `${base}/${encodeURIComponent(m.map[entry.uid])}`, body, budget); } catch (err) {
            if (err.status !== 404 && err.status !== 410) throw err;
            delete m.map[entry.uid]; // deleted by hand in Google: write it again
            if (entry.event.cancelled) { m.ver[entry.uid] = fp; continue; }
            m.map[entry.uid] = (await api(env, access, 'POST', `${base}/import`, body, budget)).id;
          }
        } else {
          m.map[entry.uid] = (await api(env, access, 'POST', `${base}/import`, body, budget)).id;
        }
        m.ver[entry.uid] = fp;
        out.written++;
      } catch (err) {
        if (err === OUT_OF_BUDGET) throw err;
        if (err.status === 401 || err.status === 403) throw err;
        out.failed++;
      }
    }
  } catch (err) {
    if (err === OUT_OF_BUDGET) { out.incomplete = true; return out; }
    if (err.code === 'invalid_grant' || err.status === 400 || err.status === 401 || err.status === 403) { m.revoked = true; return out; } // the student removed the app at Google
    m.fails = (m.fails || 0) + 1;
    out.failed++;
    return out;
  }
  m.fails = out.failed ? (m.fails || 0) + 1 : 0;
  if (!out.failed) m.synced = new Date().toISOString();
  return out;
}

// After a change: queue every member; the alarm drains the queue within the budget.
export function queueAll(cls) {
  const subs = Object.keys(cls.members || {}).filter((s) => !cls.members[s].revoked);
  cls.syncQueue = [...new Set([...(cls.syncQueue || []), ...subs])];
  return cls.syncQueue.length;
}
export function queueOne(cls, sub) {
  cls.syncQueue = [...new Set([...(cls.syncQueue || []), sub])];
}

export async function drainQueue(env, cls, budget = { left: BUDGET }) {
  let done = 0;
  while ((cls.syncQueue || []).length && budget.left > 1) {
    const r = await syncMember(env, cls, cls.syncQueue[0], { budget });
    if (r.incomplete) break; // stays at the front: the next alarm run continues it
    cls.syncQueue.shift();
    done++;
  }
  return { done, left: (cls.syncQueue || []).length };
}

// Leave (or a deleted class): remove the class calendar from the student's account, then revoke our access.
export async function farewell(env, m, budget = { left: BUDGET }) {
  if (!m || !m.refresh) return;
  let refresh;
  try { refresh = await open(env, m.refresh); } catch { return; }
  if (m.calendarId && !m.revoked) {
    try {
      const access = await accessToken(env, m, budget);
      await api(env, access, 'DELETE', `${CAL_API}/calendars/${encodeURIComponent(m.calendarId)}`, null, budget);
    } catch { /* already gone, access revoked, or out of budget: the token is revoked below anyway */ }
  }
  if (budget.left > 0) { budget.left -= 1; try { await fetchFn(env)(`${REVOKE}?token=${encodeURIComponent(refresh)}`, { method: 'POST' }); } catch { /* dead already */ } }
}

export async function removeMember(env, cls, sub) {
  const m = cls.members?.[sub];
  if (!m) return false;
  delete cls.members[sub];
  cls.syncQueue = (cls.syncQueue || []).filter((x) => x !== sub);
  await farewell(env, m);
  return true;
}

export const memberSummary = (cls) => {
  const all = Object.values(cls.members || {});
  return { joined: all.filter((m) => !m.revoked).length, needReconnect: all.filter((m) => m.revoked).length };
};
