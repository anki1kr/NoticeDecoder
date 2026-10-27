// Web Push to the class: "the CR published / moved something" the moment it happens, and reminders before each event,
// from our own server, so nobody has to wait for Google to refresh a subscribed calendar (12 to 24 hours) or set up
// notifications on it by hand.
//
// The pushes carry NO payload. A payload would have to be encrypted per subscriber (RFC 8291); instead the push only
// wakes the app's service worker, which fetches /c/:id.json and works out what to say (what changed since it last
// looked, or which reminder is due). That keeps this file to the VAPID signature the push services require.
import { REMINDER } from '../../app/engine/ics.js';

export const MAX_SUBS = 400;
const TTL = 24 * 3600;
const IST_OFFSET_MIN = 330;
const DUE_WINDOW_MS = 40 * 60 * 1000; // a reminder counts as "just due" for 40 minutes (alarms can run a little late)

const b64url = (buf) => btoa(String.fromCharCode(...new Uint8Array(buf))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const enc = (s) => new TextEncoder().encode(s);

let keyCache = null;
async function signingKey(env) {
  if (!keyCache || keyCache.raw !== env.VAPID_PRIVATE_JWK) {
    const jwk = JSON.parse(env.VAPID_PRIVATE_JWK);
    keyCache = { raw: env.VAPID_PRIVATE_JWK, key: await crypto.subtle.importKey('jwk', jwk, { name: 'ECDSA', namedCurve: 'P-256' }, false, ['sign']) };
  }
  return keyCache.key;
}

// RFC 8292: a JWT for the push service's origin, signed with the VAPID private key (ES256 = raw r||s, which WebCrypto gives).
export async function vapidHeader(env, endpoint) {
  const aud = new URL(endpoint).origin;
  const head = b64url(enc(JSON.stringify({ typ: 'JWT', alg: 'ES256' })));
  const body = b64url(enc(JSON.stringify({ aud, exp: Math.floor(Date.now() / 1000) + 12 * 3600, sub: env.VAPID_SUBJECT || 'mailto:ankit25679@gmail.com' })));
  const sig = await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, await signingKey(env), enc(`${head}.${body}`));
  return `vapid t=${head}.${body}.${b64url(sig)}, k=${env.VAPID_PUBLIC}`;
}

export const pushConfigured = (env) => Boolean(env.VAPID_PRIVATE_JWK && env.VAPID_PUBLIC);

// One payload-less push. Returns 'ok', 'gone' (the subscription is dead: drop it) or 'failed'.
export async function sendPush(env, endpoint, { urgency = 'normal', fetchFn } = {}) {
  try {
    const res = await (fetchFn || env.PUSH_FETCH || fetch)(endpoint, { method: 'POST', headers: { TTL: String(TTL), Urgency: urgency, Authorization: await vapidHeader(env, endpoint) } });
    if (res.status === 404 || res.status === 410) return 'gone';
    return res.status >= 200 && res.status < 300 ? 'ok' : 'failed';
  } catch { return 'failed'; }
}

const validEndpoint = (u) => typeof u === 'string' && u.length <= 1000 && /^https:\/\/[^\s/]+\/\S+$/.test(u);

export function addSubscription(cls, sub) {
  const endpoint = sub && sub.endpoint;
  if (!validEndpoint(endpoint)) return null;
  cls.subs = cls.subs || {};
  if (!cls.subs[endpoint] && Object.keys(cls.subs).length >= MAX_SUBS) return null;
  cls.subs[endpoint] = { addedAt: cls.subs[endpoint]?.addedAt || new Date().toISOString(), fails: 0 };
  return endpoint;
}

export function removeSubscription(cls, endpoint) {
  if (!cls.subs || !cls.subs[endpoint]) return false;
  delete cls.subs[endpoint];
  return true;
}

// Push every subscriber; forget the dead ones. Returns {sent, gone, failed}.
export async function pushAll(env, cls, opts = {}) {
  const out = { sent: 0, gone: 0, failed: 0 };
  if (!pushConfigured(env) || !cls.subs) return out;
  const results = await Promise.all(Object.keys(cls.subs).map(async (ep) => [ep, await sendPush(env, ep, opts)]));
  for (const [ep, r] of results) {
    if (r === 'ok') { out.sent++; cls.subs[ep].fails = 0; }
    else if (r === 'gone' || (cls.subs[ep].fails = (cls.subs[ep].fails || 0) + 1) >= 5) { out.gone++; delete cls.subs[ep]; }
    else out.failed++;
  }
  return out;
}

// When a reminder for this event is due, as a UTC ms timestamp: the app's reminder lead per type before a timed event;
// an all-day event (a deadline with no time) the evening before at 6 PM IST.
export function remindAt(e) {
  if (!e.date || e.cancelled) return null;
  const [y, m, d] = e.date.split('-').map(Number);
  const midnightUtc = Date.UTC(y, m - 1, d) - IST_OFFSET_MIN * 60000;
  if (e.start) {
    const [h, min] = e.start.split(':').map(Number);
    return midnightUtc + (h * 60 + min) * 60000 - (REMINDER[e.type] || REMINDER.other).minutes * 60000;
  }
  return midnightUtc - 6 * 3600000; // 18:00 IST the day before
}

export const nextReminder = (cls, now = Date.now()) => Object.values(cls.events).map(remindAt).filter((t) => t && t > now).sort((a, b) => a - b)[0] || null;

// Events whose reminder fell in the last DUE_WINDOW_MS: what the service worker should remind about right now.
export const dueReminders = (cls, now = Date.now()) => Object.values(cls.events)
  .filter((e) => { const t = remindAt(e); return t && t <= now && now - t <= DUE_WINDOW_MS; })
  .map((e) => e.uid);
