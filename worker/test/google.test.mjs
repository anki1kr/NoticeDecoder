// Run: node worker/test/google.test.mjs   "Join with Google" against a fake Google: the consent redirect, the code
// exchange, the first write of every event, writes after a publish (via the alarm queue), cancel, leave, revoked access.
import assert from 'node:assert/strict';
import { route, ClassRoom } from '../src/index.js';
import { seal, open } from '../src/google.js';

// ---- a fake Google: token endpoint + Calendar API, in memory
const calendars = {};   // calId -> { events: { googleId -> body } }
const google = { tokenCalls: [], apiCalls: [], refreshOk: true, nextId: 1 };
const idToken = (sub, email) => `h.${Buffer.from(JSON.stringify({ sub, email })).toString('base64url')}.s`;
async function fakeGoogle(url, init = {}) {
  const u = new URL(url);
  const j = (d, s = 200) => new Response(JSON.stringify(d), { status: s, headers: { 'content-type': 'application/json' } });
  if (u.hostname === 'oauth2.googleapis.com' && u.pathname === '/token') {
    const p = Object.fromEntries(new URLSearchParams(init.body));
    google.tokenCalls.push(p);
    if (p.grant_type === 'authorization_code') return p.code === 'good' ? j({ access_token: 'at1', expires_in: 3600, refresh_token: 'rt1', id_token: idToken('sub-1', 'student@gmail.com') }) : p.code === 'norefresh' ? j({ access_token: 'at1', expires_in: 3600, id_token: idToken('sub-2', 'x@y') }) : j({ error: 'invalid_grant' }, 400);
    if (p.grant_type === 'refresh_token') return google.refreshOk ? j({ access_token: 'at2', expires_in: 3600 }) : j({ error: 'invalid_grant', error_description: 'Token has been revoked.' }, 400);
  }
  if (u.hostname === 'oauth2.googleapis.com' && u.pathname === '/revoke') { google.apiCalls.push(['REVOKE', u.search]); return new Response(null, { status: 200 }); }
  google.apiCalls.push([init.method, u.pathname]);
  if (!/^Bearer at/.test(init.headers?.Authorization || '')) return j({ error: { message: 'no token' } }, 401);
  const m = u.pathname.match(/^\/calendar\/v3\/(calendars|users\/me\/calendarList)(?:\/([^/]+))?(?:\/(events)(?:\/([^/]+))?)?$/);
  if (!m) return j({ error: { message: 'unknown' } }, 404);
  const [, kind, calId, ev, evId] = m.map((x) => (x ? decodeURIComponent(x) : x));
  if (kind === 'users/me/calendarList') return j({ id: calId, selected: true });
  if (!calId && init.method === 'POST') { const id = `cal-${google.nextId++}@group.calendar.google.com`; calendars[id] = { events: {} }; return j({ id }); }
  const cal = calendars[calId];
  if (!cal) return j({ error: { message: 'Not Found' } }, 404);
  if (!ev) return j({ id: calId });
  const body = init.body ? JSON.parse(init.body) : null;
  if (evId === 'import' && init.method === 'POST') { const id = `g${google.nextId++}`; cal.events[id] = body; return j({ id, ...body }); }
  if (evId && init.method === 'PATCH') { if (!cal.events[evId]) return j({ error: { message: 'Not Found' } }, 404); cal.events[evId] = { ...cal.events[evId], ...body }; return j({ id: evId, ...cal.events[evId] }); }
  return j({ error: { message: 'unexpected' } }, 400);
}

const pair = await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify']);
const b64 = (buf) => Buffer.from(buf).toString('base64url');
const base = {
  CLASSES: { get: async () => null, put: async () => {}, delete: async () => {} }, APP_URL: 'https://noticedecoder.pages.dev/app/',
  GOOGLE_CLIENT_ID: 'cid.apps.googleusercontent.com', GOOGLE_CLIENT_SECRET: 'csecret', TOKEN_KEY: b64(crypto.getRandomValues(new Uint8Array(32))), GOOGLE_FETCH: fakeGoogle,
  VAPID_PUBLIC: b64(await crypto.subtle.exportKey('raw', pair.publicKey)), VAPID_PRIVATE_JWK: JSON.stringify(await crypto.subtle.exportKey('jwk', pair.privateKey)), PUSH_FETCH: async () => new Response(null, { status: 201 }),
};
const rooms = new Map();
function ctxFor() {
  const map = new Map(); let chain = Promise.resolve();
  const ctx = { map, pending: [], alarmAt: null,
    storage: { get: async (k) => map.get(k), put: async (k, v) => { map.set(k, v); }, delete: async (k) => { map.delete(k); }, getAlarm: async () => ctx.alarmAt, setAlarm: async (t) => { ctx.alarmAt = t; }, deleteAlarm: async () => { ctx.alarmAt = null; } },
    waitUntil(p) { ctx.pending.push(p); }, blockConcurrencyWhile(fn) { const run = chain.then(fn); chain = run.catch(() => {}); return run; } };
  return ctx;
}
const env = { ...base, ROOMS: { idFromName: (n) => n, get: (id) => { if (!rooms.has(id)) { const ctx = ctxFor(); rooms.set(id, Object.assign(new ClassRoom(ctx, base), { ctx })); } return rooms.get(id); } } };
const FEED = 'https://feed.test';
const call = (method, path, { body, token, headers = {} } = {}) => route(new Request(`${FEED}${path}`, { method, headers: { ...(body ? { 'content-type': 'application/json' } : {}), ...(token ? { authorization: `Bearer ${token}` } : {}), ...headers }, body: body ? JSON.stringify(body) : undefined, redirect: 'manual' }), env);
const J = async (r) => ({ status: r.status, ...(await r.json()) });
const settle = async (id) => { const r = rooms.get(id); await Promise.all(r.ctx.pending.splice(0)); };
const runAlarms = async (id) => { const r = rooms.get(id); for (let i = 0; i < 10 && r.ctx.alarmAt && r.ctx.alarmAt <= Date.now() + 1000; i++) await r.alarm(); };
const stored = (id) => JSON.parse(rooms.get(id).ctx.map.get(`class:${id}`));
const future = (n, title, start = '10:00') => ({ title, type: 'test', date: new Date(Date.now() + n * 86400000).toISOString().slice(0, 10), start, venue: 'Room 204' });

let passed = 0;
const test = async (name, fn) => { await fn(); passed++; console.log('ok -', name); };

await test('seal/open round-trips; /health says google:true', async () => {
  assert.equal(await open(base, await seal(base, 'rt-secret')), 'rt-secret');
  assert.equal((await J(await call('GET', '/health'))).google, true);
});

const c = await J(await call('POST', '/api/class', { body: { name: 'BCA DS' } }));
await call('POST', `/api/class/${c.id}/publish`, { body: { events: [future(5, 'Internal Test 2'), future(7, 'Lab record submission')] }, token: c.secret });
await settle(c.id);

let state;
await test('/oauth/start sends the student to Google with offline access and the class in a signed state', async () => {
  const r = await call('GET', `/oauth/start?class=${c.id}&back=page`);
  assert.equal(r.status, 302);
  const u = new URL(r.headers.get('location'));
  assert.equal(u.origin + u.pathname, 'https://accounts.google.com/o/oauth2/v2/auth');
  assert.equal(u.searchParams.get('client_id'), 'cid.apps.googleusercontent.com');
  assert.equal(u.searchParams.get('redirect_uri'), `${FEED}/oauth/callback`);
  assert.equal(u.searchParams.get('access_type'), 'offline');
  assert.match(u.searchParams.get('scope'), /calendar\.app\.created/);
  state = u.searchParams.get('state');
  assert.equal((await call('GET', '/oauth/start?class=../x')).status, 400);
});

await test('callback: code -> refresh token sealed on the class, calendar made and selected, both events written, cookie set', async () => {
  const r = await call('GET', `/oauth/callback?code=good&state=${encodeURIComponent(state)}`);
  assert.equal(r.status, 302);
  assert.match(r.headers.get('location'), new RegExp(`${FEED}/c/${c.id}\\?joined=student%40gmail.com&written=2$`));
  assert.match(r.headers.get('set-cookie'), new RegExp(`^nd_member_${c.id}=sub-1; .*HttpOnly`));
  const cls = stored(c.id);
  const m = cls.members['sub-1'];
  assert.equal(m.email, 'student@gmail.com');
  assert.notEqual(m.refresh, 'rt1', 'the refresh token is not stored in clear');
  assert.equal(await open(base, m.refresh), 'rt1');
  assert.ok(m.calendarId in calendars);
  assert.ok(google.apiCalls.some(([meth, p]) => meth === 'PATCH' && /calendarList/.test(p)), 'the new calendar is marked selected');
  const written = Object.values(calendars[m.calendarId].events);
  assert.equal(written.length, 2);
  const t = written.find((e) => /Internal Test 2/.test(e.summary));
  assert.deepEqual(t.reminders, { useDefault: false, overrides: [{ method: 'popup', minutes: 1440 }] }, 'a test reminds the day before');
  assert.equal(t.start.timeZone, 'Asia/Kolkata');
  assert.equal(Object.keys(m.map).length, 2, 'google event ids remembered per UID');
  assert.equal(google.tokenCalls.filter((x) => x.grant_type === 'authorization_code')[0].client_secret, 'csecret');
});

await test('a used or forged state is refused; a code without refresh token says so', async () => {
  const forged = state.slice(0, -1) + (state.endsWith('A') ? 'B' : 'A'); // one signature character changed
  assert.equal((await call('GET', `/oauth/callback?code=good&state=${encodeURIComponent(forged)}`)).status, 400);
  const r = await call('GET', `/oauth/start?class=${c.id}`);
  const st2 = new URL(r.headers.get('location')).searchParams.get('state');
  const nr = await call('GET', `/oauth/callback?code=norefresh&state=${encodeURIComponent(st2)}`);
  assert.match(nr.headers.get('location'), /joined=norefresh/);
  const den = await call('GET', `/oauth/callback?error=access_denied&state=${encodeURIComponent(st2)}`);
  assert.match(den.headers.get('location'), /joined=no$/);
});

await test('a later publish writes only what changed into the joined calendar, through the alarm queue', async () => {
  google.apiCalls.length = 0;
  await call('POST', `/api/class/${c.id}/publish`, { body: { events: [{ ...future(5, 'Internal Test 2'), start: '14:00', end: '15:30' }, future(9, 'Guest lecture: AI')] }, token: c.secret });
  await settle(c.id);
  assert.deepEqual(stored(c.id).syncQueue, ['sub-1']);
  await runAlarms(c.id);
  const cls = stored(c.id);
  assert.deepEqual(cls.syncQueue, []);
  const cal = calendars[cls.members['sub-1'].calendarId];
  const t = Object.values(cal.events).find((e) => /Internal Test 2/.test(e.summary));
  assert.match(t.start.dateTime, /T14:00:00$/, 'the moved test moved in Google too');
  assert.equal(Object.values(cal.events).length, 3, 'the new lecture was imported, the unchanged deadline untouched');
  assert.equal(google.apiCalls.filter(([m]) => m === 'PATCH' || m === 'POST').length, 2, 'one call per changed event, no lookups');
  assert.ok(google.tokenCalls.some((x) => x.grant_type === 'refresh_token'), 'the refresh token was used');
});

await test('cancel in the console -> cancelled in Google; the page shows the joined state from the cookie', async () => {
  await call('DELETE', `/api/class/${c.id}/events/${encodeURIComponent('lab-record-submission@notice-decoder')}`, { token: c.secret });
  await settle(c.id); await runAlarms(c.id);
  const cal = calendars[stored(c.id).members['sub-1'].calendarId];
  assert.equal(Object.values(cal.events).find((e) => /Lab record/.test(e.summary)).status, 'cancelled');
  const html = await (await call('GET', `/c/${c.id}`, { headers: { cookie: `nd_member_${c.id}=sub-1` } })).text();
  assert.match(html, /Joined as student@gmail.com/);
  assert.match(html, /Leave this class/);
  const anon = await (await call('GET', `/c/${c.id}`)).text();
  assert.match(anon, /Join with Google/);
  assert.ok(!/Joined as/.test(anon));
  const console_ = await J(await call('GET', `/api/class/${c.id}/events`, { token: c.secret }));
  assert.deepEqual(console_.members, { joined: 1, needReconnect: 0 });
});

await test('revoked at Google: the member is marked, nothing crashes, the page asks to join again', async () => {
  google.refreshOk = false;
  const cls0 = stored(c.id); cls0.members['sub-1'].access = null; rooms.get(c.id).ctx.map.set(`class:${c.id}`, JSON.stringify(cls0));
  await call('POST', `/api/class/${c.id}/publish`, { body: { events: [future(11, 'Viva')] }, token: c.secret });
  await settle(c.id); await runAlarms(c.id);
  assert.equal(stored(c.id).members['sub-1'].revoked, true);
  const html = await (await call('GET', `/c/${c.id}`, { headers: { cookie: `nd_member_${c.id}=sub-1` } })).text();
  assert.match(html, /Join again to continue/);
  google.refreshOk = true;
});

await test('leave: the member is removed and the token revoked; a stranger cannot leave for them', async () => {
  assert.equal((await call('POST', `/api/class/${c.id}/leave`)).status, 404);
  const r = await call('POST', `/api/class/${c.id}/leave`, { headers: { cookie: `nd_member_${c.id}=sub-1` } });
  assert.equal(r.status, 303);
  assert.match(r.headers.get('set-cookie'), /Max-Age=0/);
  assert.ok(!('sub-1' in stored(c.id).members));
  assert.ok(google.apiCalls.some(([m]) => m === 'REVOKE'));
});

await test('without the Google secrets: no join box, /oauth/start says so', async () => {
  const plainBase = { ...base, GOOGLE_CLIENT_SECRET: undefined };
  const rs = new Map();
  const plain = { ...plainBase, ROOMS: { idFromName: (n) => n, get: (id) => { if (!rs.has(id)) { const ctx = ctxFor(); rs.set(id, Object.assign(new ClassRoom(ctx, plainBase), { ctx })); } return rs.get(id); } } };
  const k = await J(await route(new Request(`${FEED}/api/class`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ name: 'No google' }) }), plain));
  const html = await (await route(new Request(`${FEED}/c/${k.id}`), plain)).text();
  assert.ok(!/Join with Google/.test(html) && /Add to Google Calendar/.test(html), 'falls back to the subscription link');
  assert.equal((await route(new Request(`${FEED}/oauth/start?class=${k.id}`), plain)).status, 503);
});

console.log(`\n${passed} passed`);
