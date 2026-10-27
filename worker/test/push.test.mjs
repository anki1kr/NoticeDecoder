// Run: node worker/test/push.test.mjs   Web Push without a network: a fake push service records what the Worker sends.
import assert from 'node:assert/strict';
import { route, ClassRoom } from '../src/index.js';
import { remindAt, nextReminder, dueReminders, vapidHeader } from '../src/push.js';
import { plan } from '../src/feed.js';

// a throwaway VAPID pair for the test
const pair = await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify']);
const b64 = (buf) => Buffer.from(buf).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const VAPID_PUBLIC = b64(await crypto.subtle.exportKey('raw', pair.publicKey));
const VAPID_PRIVATE_JWK = JSON.stringify(await crypto.subtle.exportKey('jwk', pair.privateKey));

const pushes = [];
const dead = new Set();
const pushService = async (url, init) => { pushes.push({ url, headers: init.headers }); return new Response(null, { status: dead.has(url) ? 410 : 201 }); };

const kvStore = new Map();
const kv = { get: async (k) => kvStore.get(k) ?? null, put: async (k, v) => { kvStore.set(k, v); }, delete: async (k) => { kvStore.delete(k); } };
const base = { CLASSES: kv, APP_URL: 'https://noticedecoder.pages.dev/app/', VAPID_PUBLIC, VAPID_PRIVATE_JWK, PUSH_FETCH: pushService };
const rooms = new Map();
function ctxFor() {
  const map = new Map();
  let chain = Promise.resolve();
  const ctx = { map, pending: [], alarmAt: null,
    storage: { get: async (k) => map.get(k), put: async (k, v) => { map.set(k, v); }, delete: async (k) => { map.delete(k); }, getAlarm: async () => ctx.alarmAt, setAlarm: async (t) => { ctx.alarmAt = t; }, deleteAlarm: async () => { ctx.alarmAt = null; } },
    waitUntil(p) { ctx.pending.push(p); }, blockConcurrencyWhile(fn) { const run = chain.then(fn); chain = run.catch(() => {}); return run; } };
  return ctx;
}
const env = { ...base, ROOMS: { idFromName: (n) => n, get: (id) => { if (!rooms.has(id)) { const ctx = ctxFor(); rooms.set(id, Object.assign(new ClassRoom(ctx, base), { ctx })); } return rooms.get(id); } } };
const call = (method, path, { body, token } = {}) => route(new Request(`https://feed.test${path}`, {
  method, headers: { ...(body ? { 'content-type': 'application/json' } : {}), ...(token ? { authorization: `Bearer ${token}` } : {}) }, body: body ? JSON.stringify(body) : undefined,
}), env);
const J = async (r) => ({ status: r.status, ...(await r.json()) });
const settle = async (id) => { const r = rooms.get(id); await Promise.all(r.ctx.pending.splice(0)); };
const future = (days, start) => ({ title: 'Internal Test 2', type: 'test', date: new Date(Date.now() + days * 86400000).toISOString().slice(0, 10), start });

let passed = 0;
const test = async (name, fn) => { await fn(); passed++; console.log('ok -', name); };

await test('/health publishes the VAPID public key the app subscribes with', async () => {
  const h = await J(await call('GET', '/health'));
  assert.equal(h.push, VAPID_PUBLIC);
});

const c = await J(await call('POST', '/api/class', { body: { name: 'BCA DS' } }));
const EP1 = 'https://fcm.googleapis.com/fcm/send/phone-1', EP2 = 'https://updates.push.services.mozilla.com/wpush/v2/phone-2';

await test('a student subscribes this phone with no class key; junk endpoints are refused', async () => {
  const r = await J(await call('POST', `/api/class/${c.id}/push`, { body: { subscription: { endpoint: EP1, keys: { p256dh: 'x', auth: 'y' } } } }));
  assert.deepEqual([r.status, r.subscribers], [200, 1]);
  assert.equal((await J(await call('POST', `/api/class/${c.id}/push`, { body: { endpoint: EP2 } }))).subscribers, 2);
  assert.equal((await call('POST', `/api/class/${c.id}/push`, { body: { endpoint: 'javascript:alert(1)' } })).status, 400);
  assert.equal((await call('POST', `/api/class/${c.id}/push`, { body: { endpoint: 'http://insecure.example/x' } })).status, 400);
  assert.equal((await call('POST', `/api/class/zzzz2345/push`, { body: { endpoint: EP1 } })).status, 404);
  assert.equal((await call('GET', `/api/class/${c.id}/push`)).status, 404);
});

await test('a publish wakes every subscribed phone with a signed, payload-less push; a 410 drops that phone', async () => {
  pushes.length = 0;
  dead.add(EP2);
  const r = await J(await call('POST', `/api/class/${c.id}/publish`, { body: { events: [future(10, '10:00')] }, token: c.secret }));
  assert.equal(r.added, 1);
  await settle(c.id);
  assert.deepEqual(pushes.map((p) => p.url).sort(), [EP1, EP2].sort());
  const h = pushes[0].headers;
  assert.match(h.Authorization, new RegExp(`^vapid t=[A-Za-z0-9_-]+\\.[A-Za-z0-9_-]+\\.[A-Za-z0-9_-]+, k=${VAPID_PUBLIC}$`));
  assert.equal(h.TTL, '86400');
  const [head, body, sig] = h.Authorization.slice(8).split(',')[0].split('.');
  const claims = JSON.parse(Buffer.from(body, 'base64url'));
  assert.equal(claims.aud, 'https://fcm.googleapis.com');
  assert.ok(claims.exp > Date.now() / 1000 && claims.exp < Date.now() / 1000 + 24 * 3600);
  const ok = await crypto.subtle.verify({ name: 'ECDSA', hash: 'SHA-256' }, pair.publicKey, Buffer.from(sig, 'base64url'), new TextEncoder().encode(`${head}.${body}`));
  assert.ok(ok, 'the JWT verifies with the public key');
  const again = await J(await call('POST', `/api/class/${c.id}/publish`, { body: { events: [future(10, '10:00')] }, token: c.secret }));
  pushes.length = 0;
  await settle(c.id);
  assert.equal(again.unchanged, 1);
  assert.equal(pushes.length, 0, 'nothing changed: nobody is woken');
  const r2 = await J(await call('POST', `/api/class/${c.id}/publish`, { body: { events: [future(10, '14:00')] }, token: c.secret }));
  await settle(c.id);
  assert.equal(r2.moved + r2.updated, 1);
  assert.deepEqual(pushes.map((p) => p.url), [EP1], 'the dead phone was dropped after its 410');
});

await test('reminder times: lead per type in IST; the alarm is armed for the next one; due ones show up in the JSON', async () => {
  const test10 = { type: 'test', date: '2026-11-13', start: '10:00' };
  assert.equal(new Date(remindAt(test10)).toISOString(), '2026-11-12T04:30:00.000Z', 'a test: 1 day before 10:00 IST');
  assert.equal(new Date(remindAt({ type: 'deadline', date: '2026-11-13', start: '12:00' })).toISOString(), '2026-11-13T03:30:00.000Z', 'a deadline: 3 hours before');
  assert.equal(new Date(remindAt({ type: 'lecture', date: '2026-11-13', start: '11:00' })).toISOString(), '2026-11-13T05:00:00.000Z', 'a lecture: 30 minutes before');
  assert.equal(new Date(remindAt({ type: 'deadline', date: '2026-11-13' })).toISOString(), '2026-11-12T12:30:00.000Z', 'all-day: 6 PM IST the day before');
  assert.equal(remindAt({ type: 'test', date: '2026-11-13', start: '10:00', cancelled: true }), null);
  const room = rooms.get(c.id);
  const cls = JSON.parse(room.ctx.map.get(`class:${c.id}`));
  assert.equal(room.ctx.alarmAt, nextReminder(cls), 'the alarm sits on the next reminder');
  assert.ok(room.ctx.alarmAt > Date.now());
  const now = remindAt(Object.values(cls.events)[0]) + 5 * 60000;
  assert.deepEqual(dueReminders(cls, now), Object.keys(cls.events), '5 minutes after the lead time the event is "due"');
  assert.deepEqual(dueReminders(cls, now + 3600000), [], 'an hour later it is not repeated');
});

await test('the alarm fires: due reminder -> push everyone, re-arm; nothing due -> no push', async () => {
  const room = rooms.get(c.id);
  const cls = JSON.parse(room.ctx.map.get(`class:${c.id}`));
  const ev = Object.values(cls.events)[0];
  const realNow = Date.now;
  pushes.length = 0;
  Date.now = () => remindAt(ev) + 60000; // one minute after the lead time
  try { await room.alarm(); } finally { Date.now = realNow; }
  assert.deepEqual(pushes.map((p) => p.url), [EP1]);
  assert.equal(pushes[0].headers.Urgency, 'high');
  assert.equal(room.ctx.alarmAt, null, 'no later reminder left, so no alarm');
  pushes.length = 0;
  await room.alarm();
  assert.equal(pushes.length, 0);
});

await test('unsubscribe; an old date is PAST in the plan and left out unless the CR says keep', async () => {
  assert.equal((await call('DELETE', `/api/class/${c.id}/push`, { body: { endpoint: EP1 } })).status, 200);
  pushes.length = 0;
  await call('POST', `/api/class/${c.id}/publish`, { body: { events: [future(12, '10:00')] }, token: c.secret });
  await settle(c.id);
  assert.equal(pushes.length, 0, 'nobody left to wake');
  const old = { title: 'Yaduja webinar', type: 'lecture', date: '2026-10-23', start: '15:00' };
  const dry = await J(await call('POST', `/api/class/${c.id}/publish?dry=1`, { body: { events: [old, { ...future(3, '09:00'), title: 'Quiz' }] }, token: c.secret }));
  assert.deepEqual(dry.plan.map((x) => x.action), ['past', 'add']);
  assert.deepEqual(dry.plan[0].alt, { action: 'add', intent: 'keep' });
  const pub = await J(await call('POST', `/api/class/${c.id}/publish`, { body: { events: [old] }, token: c.secret }));
  assert.deepEqual([pub.added, pub.past, pub.count], [0, 1, 1], 'left out by default');
  const kept = await J(await call('POST', `/api/class/${c.id}/publish`, { body: { events: [old], intents: { 0: 'keep' } }, token: c.secret }));
  assert.deepEqual([kept.added, kept.count], [1, 2], 'published when the CR insists');
  const p = plan({ events: {} }, [{ title: 'Practicals', type: 'test', date: '2026-10-20', start: '10:00', repeat: 10 }], {}, '2026-10-27');
  assert.equal(p[0].action, 'add', 'a run that is still going on is not past');
});

await test('no VAPID keys: subscribe says so, publishes still work', async () => {
  const plainRooms = new Map();
  const plainBase = { ...base, VAPID_PRIVATE_JWK: undefined, VAPID_PUBLIC: undefined };
  const plain = { ...plainBase, ROOMS: { idFromName: (n) => n, get: (id) => { if (!plainRooms.has(id)) { const ctx = ctxFor(); plainRooms.set(id, Object.assign(new ClassRoom(ctx, plainBase), { ctx })); } return plainRooms.get(id); } } };
  const k = await J(await route(new Request('https://feed.test/api/class', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ name: 'No push' }) }), plain));
  assert.equal((await route(new Request(`https://feed.test/api/class/${k.id}/push`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ endpoint: EP1 }) }), plain)).status, 503);
  assert.equal((await J(await route(new Request('https://feed.test/health'), plain))).push, null);
});

console.log(`\n${passed} passed`);
