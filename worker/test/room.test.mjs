// Run: node worker/test/room.test.mjs   The Durable Object layer: every class request goes to that class's own object,
// which reads its own writes and runs one request at a time. Fakes stand in for Cloudflare's DO runtime.
import assert from 'node:assert/strict';
import { route, handle, ClassRoom } from '../src/index.js';

const tick = () => new Promise((r) => setTimeout(r, Math.random() * 4));
function fakeCtx() {
  const map = new Map();
  let chain = Promise.resolve();
  return {
    map,
    storage: { get: async (k) => { await tick(); return map.get(k); }, put: async (k, v) => { await tick(); map.set(k, v); }, delete: async (k) => { map.delete(k); } },
    blockConcurrencyWhile(fn) { const run = chain.then(fn); chain = run.catch(() => {}); return run; },
  };
}
// A KV that answers slowly, like the real one: what the old code ran on.
const kvStore = new Map();
const kv = { get: async (k) => { await tick(); return kvStore.get(k) ?? null; }, put: async (k, v) => { await tick(); kvStore.set(k, v); }, delete: async (k) => { kvStore.delete(k); } };
const base = { CLASSES: kv, APP_URL: 'https://noticedecoder.pages.dev/app/', TODAY: '2026-10-26' };
const rooms = new Map();
const env = { ...base, ROOMS: { idFromName: (n) => n, get: (id) => { if (!rooms.has(id)) { const ctx = fakeCtx(); rooms.set(id, Object.assign(new ClassRoom(ctx, base), { ctx })); } return rooms.get(id); } } };
const call = (method, path, { body, token, via = route, e = env, headers = {} } = {}) => via(new Request(`https://feed.test${path}`, {
  method, headers: { ...(body ? { 'content-type': 'application/json' } : {}), ...(token ? { authorization: `Bearer ${token}` } : {}), ...headers }, body: body ? JSON.stringify(body) : undefined,
}), e);
const J = async (r) => ({ status: r.status, ...(await r.json()) });
const ev = (n) => ({ title: `Quiz ${n}`, type: 'test', date: '2026-11-20', start: `${String(8 + (n % 10)).padStart(2, '0')}:00` });

let passed = 0;
const test = async (name, fn) => { await fn(); passed++; console.log('ok -', name); };

let c;
await test('create goes to the new class\'s own object; nothing class-related lands in KV', async () => {
  c = await J(await call('POST', '/api/class', { body: { name: 'CSE 3rd Year A' } }));
  assert.equal(c.status, 201);
  assert.ok(rooms.has(c.id), 'the object is named after the class id');
  assert.ok(rooms.get(c.id).ctx.map.has(`class:${c.id}`));
  assert.ok(![...kvStore.keys()].some((k) => k.startsWith('class:')));
});

await test('publish, then read, edit, cancel straight away: every step sees the one before (the live KV did not)', async () => {
  const pub = await J(await call('POST', `/api/class/${c.id}/publish`, { body: { events: [ev(1), ev(2)] }, token: c.secret }));
  assert.equal(pub.count, 2);
  const read = await J(await call('GET', `/api/class/${c.id}/events`, { token: c.secret }));
  assert.equal(read.events.length, 2);
  assert.equal((await call('PATCH', `/api/class/${c.id}/events/${encodeURIComponent('quiz-1@notice-decoder')}`, { body: { start: '15:00' }, token: c.secret })).status, 200);
  assert.equal((await call('DELETE', `/api/class/${c.id}/events/${encodeURIComponent('quiz-2@notice-decoder')}`, { token: c.secret })).status, 200);
  const j = await J(await call('GET', `/c/${c.id}.json`));
  assert.deepEqual(j.events.map((e) => [e.title, e.start, Boolean(e.cancelled)]).sort(), [['Quiz 1', '15:00', false], ['Quiz 2', '10:00', true]]);
  assert.equal((await call('GET', `/c/${c.id}.ics`)).status, 200);
  assert.equal((await call('GET', `/c/${c.id}`)).status, 200);
});

await test('20 publishes at the same moment: all 20 kept (the plain KV path loses some)', async () => {
  const k = await J(await call('POST', '/api/class', { body: { name: 'Race' } }));
  await Promise.all(Array.from({ length: 20 }, (_, n) => call('POST', `/api/class/${k.id}/publish`, { body: { events: [ev(100 + n)] }, token: k.secret })));
  const j = await J(await call('GET', `/c/${k.id}.json`));
  assert.equal(j.events.length, 20);
  // the same race on the old path (KV, no object): updates are lost
  const old = await J(await call('POST', '/api/class', { body: { name: 'Old race' }, via: handle, e: base }));
  await Promise.all(Array.from({ length: 20 }, (_, n) => call('POST', `/api/class/${old.id}/publish`, { body: { events: [ev(200 + n)] }, token: old.secret, via: handle, e: base })));
  const lost = await J(await call('GET', `/c/${old.id}.json`, { via: handle, e: base }));
  assert.ok(lost.events.length < 20, `the KV path kept ${lost.events.length} of 20`);
  console.log(`   (plain KV path kept ${lost.events.length} of 20 under the same race)`);
});

await test('a class created before the move (in KV only) is brought over on first use, then lives in its object', async () => {
  const legacy = await J(await call('POST', '/api/class', { body: { name: 'Pilot class' }, via: handle, e: base }));
  await call('POST', `/api/class/${legacy.id}/publish`, { body: { events: [ev(7)] }, token: legacy.secret, via: handle, e: base });
  const j = await J(await call('GET', `/c/${legacy.id}.json`));
  assert.equal(j.events.length, 1, 'found through the object');
  assert.ok(rooms.get(legacy.id).ctx.map.has(`class:${legacy.id}`), 'copied into the object');
  await call('POST', `/api/class/${legacy.id}/publish`, { body: { events: [ev(8)] }, token: legacy.secret });
  assert.equal((await J(await call('GET', `/c/${legacy.id}.json`))).events.length, 2);
  assert.equal(JSON.parse(kvStore.get(`class:${legacy.id}`)).events && Object.keys(JSON.parse(kvStore.get(`class:${legacy.id}`)).events).length, 1, 'the KV copy is left as it was');
});

await test('a deleted class stays deleted (the old KV copy cannot bring it back)', async () => {
  const legacy = await J(await call('POST', '/api/class', { body: { name: 'To delete' }, via: handle, e: base }));
  await call('GET', `/c/${legacy.id}.json`); // brought over
  assert.equal((await call('DELETE', `/api/class/${legacy.id}`, { token: legacy.secret })).status, 200);
  assert.equal((await call('GET', `/c/${legacy.id}.json`)).status, 404);
  assert.equal(kvStore.has(`class:${legacy.id}`), false);
});

await test('the AI check, /health and preflights never create class objects; junk ids get a plain 404', async () => {
  const before = rooms.size;
  assert.equal((await call('GET', '/health')).status, 200);
  assert.equal((await call('OPTIONS', `/api/class/${c.id}/publish`)).status, 204);
  assert.equal((await call('POST', '/api/ai/refine', { body: { text: 'x' } })).status, 503, 'no key here');
  assert.equal((await call('GET', '/c/ab.json')).status, 404);
  assert.equal((await call('GET', '/c/../../etc')).status, 404);
  assert.equal(rooms.size, before);
  const fake = await call('POST', `/api/class/${c.id}/publish`, { body: { events: [ev(3)] }, token: c.secret, headers: { 'x-nd-new-id': 'hijack01' } });
  assert.equal(fake.status, 200, 'a client-sent x-nd-new-id is harmless outside create');
  assert.ok(!rooms.has('hijack01'));
});

console.log(`\n${passed} passed`);
