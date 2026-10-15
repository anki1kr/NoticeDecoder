// Google Calendar, one tap: writes the reviewed events straight into the signed-in user's primary calendar.
// Same UIDs and times as the .ics file (calendarEntries in engine/ics.js), so adding twice updates instead of
// duplicating, and a revised notice moves the event. The token lives in memory (and sessionStorage for the hour it
// is valid, so the auto-add path can run without a click); nothing else is stored anywhere.
import { calendarEntries, TZ } from './engine/ics.js';
import { GOOGLE_CLIENT_ID } from './config.js';

const SCOPE = 'https://www.googleapis.com/auth/calendar.events';
const API = 'https://www.googleapis.com/calendar/v3/calendars/primary/events';
const TOKEN_KEY = 'nd-gcal-token';

// `window.__ndGcalDeps = { token, fetch }` lets the browser check (tools/ui-check.mjs) and other hosts bypass Google sign-in.
export const configured = () => Boolean(GOOGLE_CLIENT_ID || window.__ndGcalDeps?.token);

let tokenClient = null;
let token = readToken();

function readToken() {
  try {
    const t = JSON.parse(sessionStorage.getItem(TOKEN_KEY) || 'null');
    return t && t.exp > Date.now() + 60000 ? t : null;
  } catch { return null; }
}
function keepToken(t) {
  token = t;
  try { sessionStorage.setItem(TOKEN_KEY, JSON.stringify(t)); } catch { /* private mode */ }
}
export const signedIn = () => Boolean(window.__ndGcalDeps?.token) || Boolean(token && token.exp > Date.now() + 60000);

function loadGis() {
  if (window.google?.accounts?.oauth2) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = 'https://accounts.google.com/gsi/client';
    s.async = true;
    s.onload = resolve;
    s.onerror = () => reject(new Error('Google sign-in script did not load (offline?).'));
    document.head.append(s);
  });
}

// Returns an access token, asking Google only when there is none. `silent` never opens a popup.
export async function getToken({ silent = false } = {}) {
  if (signedIn()) return token.access_token;
  if (silent) return null;
  if (!configured()) throw new Error('Google sign-in is not set up on this copy of the app (GOOGLE_CLIENT_ID in app/config.js).');
  await loadGis();
  return new Promise((resolve, reject) => {
    tokenClient = tokenClient || window.google.accounts.oauth2.initTokenClient({ client_id: GOOGLE_CLIENT_ID, scope: SCOPE, callback: () => {} });
    tokenClient.callback = (res) => {
      if (res.error) { reject(new Error(res.error_description || res.error)); return; }
      keepToken({ access_token: res.access_token, exp: Date.now() + (Number(res.expires_in) || 3600) * 1000 });
      resolve(res.access_token);
    };
    tokenClient.error_callback = (err) => reject(new Error(err?.message || 'Sign-in was closed.'));
    tokenClient.requestAccessToken({ prompt: '' });
  });
}

export function signOut() {
  const t = token;
  token = null;
  try { sessionStorage.removeItem(TOKEN_KEY); } catch { /* ignore */ }
  if (t && window.google?.accounts?.oauth2) window.google.accounts.oauth2.revoke(t.access_token, () => {});
}

// One calendar event body from one entry. Deadlines are the 30 minutes before; all-day events use dates.
export function toGoogleEvent(entry, { reminders = true } = {}) {
  const body = {
    iCalUID: entry.uid,
    summary: entry.summary,
    description: entry.description,
    start: entry.allDay ? { date: entry.start } : { dateTime: entry.start, timeZone: TZ },
    end: entry.allDay ? { date: entry.end } : { dateTime: entry.end, timeZone: TZ },
    reminders: reminders && entry.reminder ? { useDefault: false, overrides: [{ method: 'popup', minutes: entry.reminder.minutes }] } : { useDefault: true },
    extendedProperties: { private: { noticeDecoder: '1', type: entry.type } },
  };
  if (entry.location) body.location = entry.location;
  if (entry.recurrence) body.recurrence = [entry.recurrence];
  if (entry.url) body.source = { title: 'Link', url: entry.url };
  if (entry.event.cancelled) body.status = 'cancelled';
  return body;
}

async function call(method, path, accessToken, body, fetchFn) {
  const res = await fetchFn(`${API}${path}`, {
    method,
    headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (res.status === 204) return null;
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = new Error(data?.error?.message || `Google Calendar said ${res.status}`);
    err.status = res.status;
    throw err;
  }
  return data;
}

// Adds every dated event. An event whose UID already exists in the calendar is updated, not duplicated.
// Returns { added: [{id, uid, summary}], updated: [...], failed: [{uid, error}] }.
// `deps` lets tests and other hosts swap the token and fetch.
export async function addAll(events, { reminders = true, silent = false } = {}, deps = {}) {
  const fetchFn = deps.fetch || ((...a) => fetch(...a));
  const accessToken = deps.token || await getToken({ silent });
  if (!accessToken) return null; // silent and not signed in
  const out = { added: [], updated: [], failed: [] };
  for (const entry of calendarEntries(events)) {
    const body = toGoogleEvent(entry, { reminders });
    try {
      const found = await call('GET', `?iCalUID=${encodeURIComponent(entry.uid)}&showDeleted=false&maxResults=1`, accessToken, null, fetchFn);
      const existing = found?.items?.[0];
      if (existing) {
        const res = await call('PATCH', `/${encodeURIComponent(existing.id)}`, accessToken, body, fetchFn);
        out.updated.push({ id: res.id, uid: entry.uid, summary: entry.summary, link: res.htmlLink });
      } else {
        const res = await call('POST', '/import', accessToken, body, fetchFn);
        out.added.push({ id: res.id, uid: entry.uid, summary: entry.summary, link: res.htmlLink });
      }
    } catch (err) {
      if (err.status === 401) { signOut(); throw new Error('Google sign-in expired. Tap again to sign in.'); }
      out.failed.push({ uid: entry.uid, summary: entry.summary, error: err.message });
    }
  }
  return out;
}

// Undo: deletes the events that `addAll` created (updated ones are left as they are).
export async function removeAll(added, deps = {}) {
  const fetchFn = deps.fetch || ((...a) => fetch(...a));
  const accessToken = deps.token || await getToken({ silent: true });
  if (!accessToken) throw new Error('Not signed in.');
  let n = 0;
  for (const { id } of added) {
    try { await call('DELETE', `/${encodeURIComponent(id)}`, accessToken, null, fetchFn); n++; } catch { /* already gone */ }
  }
  return n;
}
