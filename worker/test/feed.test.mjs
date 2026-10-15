// Run: node worker/test/feed.test.mjs   (no wrangler needed: the handler takes a fake KV)
import assert from 'node:assert/strict';
import { handle } from '../src/index.js';

const store = new Map();
const env = { CLASSES: { get: async (k) => store.get(k) ?? null, put: async (k, v) => { store.set(k, v); } }, APP_URL: 'https://anki1kr.me/NoticeDecoder/app/' };
const BASE = 'https://feed.test';
const req = (method, path, { body, token } = {}) => handle(new Request(BASE + path, {
  method,
  headers: { ...(body ? { 'content-type': 'application/json' } : {}), ...(token ? { authorization: `Bearer ${token}` } : {}) },
  body: body ? JSON.stringify(body) : undefined,
}), env);

let passed = 0;
const test = async (name, fn) => { await fn(); passed++; console.log('ok -', name); };

const test2 = { title: 'Internal Test 2', type: 'test', typeLabel: 'Test', date: '2026-11-13', start: '10:00', end: '11:30', venue: 'Room 204' };
const lecture = { title: 'Guest lecture: AI in Healthcare', type: 'lecture', typeLabel: 'Lecture', date: '2026-11-13', start: '11:00', end: '12:30', venue: 'Seminar Hall' };
const deadline = { title: 'Lab record submission', type: 'deadline', typeLabel: 'Deadline', date: '2026-11-13', start: '12:00', venue: 'Department office' };
let cls;

await test('create a class: id + secret once', async () => {
  const res = await req('POST', '/api/class', { body: { name: 'III CSE A' } });
  assert.equal(res.status, 201);
  cls = await res.json();
  assert.match(cls.id, /^[a-z0-9]{8}$/);
  assert.equal(cls.secret.length, 32);
  assert.equal(cls.feed, `${BASE}/c/${cls.id}.ics`);
  assert.ok(!JSON.parse(store.get(`class:${cls.id}`)).secret, 'the secret itself is never stored');
});

await test('publish needs the secret', async () => {
  assert.equal((await req('POST', `/api/class/${cls.id}/publish`, { body: { events: [test2] } })).status, 401);
  assert.equal((await req('POST', `/api/class/${cls.id}/publish`, { body: { events: [test2] }, token: 'nope' })).status, 401);
  assert.equal((await req('POST', '/api/class/zzzzzzzz/publish', { body: { events: [test2] }, token: cls.secret })).status, 404);
});

await test('publish the PDF sample: 3 events, the 2 clashes come back in the report', async () => {
  const res = await req('POST', `/api/class/${cls.id}/publish`, { body: { events: [test2, lecture, deadline] }, token: cls.secret });
  assert.equal(res.status, 200);
  const r = await res.json();
  assert.deepEqual([r.added, r.updated, r.count], [3, 0, 3]);
  assert.equal(r.clashes.length, 2);
  assert.ok(r.clashes.some((c) => /11:00 to 11:30 AM/.test(c.msg)));
  assert.ok(r.clashes.some((c) => /12:00 PM deadline falls during/.test(c.msg) && /before 10:00 AM/.test(c.action)));
});

await test('the .ics feed is a valid calendar with the same UIDs as the app', async () => {
  const res = await req('GET', `/c/${cls.id}.ics`);
  assert.equal(res.status, 200);
  assert.match(res.headers.get('content-type'), /text\/calendar/);
  assert.match(res.headers.get('cache-control'), /max-age=300/);
  const ics = await res.text();
  assert.ok(ics.startsWith('BEGIN:VCALENDAR\r\n') && ics.endsWith('END:VCALENDAR\r\n'));
  assert.equal((ics.match(/BEGIN:VEVENT/g) || []).length, 3);
  assert.match(ics, /UID:internal-test-2@notice-decoder/);
  assert.match(ics, /X-WR-CALNAME:III CSE A/);
  assert.match(ics, /DTSTART;TZID=Asia\/Kolkata:20261113T100000/);
  assert.ok(ics.split('\r\n').every((l) => new TextEncoder().encode(l).length <= 75));
});

await test('a revised notice (same title, new time) updates the event instead of adding one', async () => {
  const res = await req('POST', `/api/class/${cls.id}/publish`, { body: { events: [{ ...test2, start: '14:00', end: '15:30' }] }, token: cls.secret });
  const r = await res.json();
  assert.deepEqual([r.added, r.updated, r.count], [0, 1, 3]);
  assert.equal(r.clashes.length, 1, 'the test moved to the afternoon: only the deadline-in-lecture clash is left');
  const ics = await (await req('GET', `/c/${cls.id}.ics`)).text();
  assert.equal((ics.match(/BEGIN:VEVENT/g) || []).length, 3);
  assert.match(ics, /DTSTART;TZID=Asia\/Kolkata:20261113T140000/);
  assert.ok(!/20261113T100000/.test(ics));
});

await test('cancel one event: it stays in the feed as STATUS:CANCELLED so subscribers drop it', async () => {
  const res = await req('DELETE', `/api/class/${cls.id}/events/${encodeURIComponent('lab-record-submission@notice-decoder')}`, { token: cls.secret });
  assert.equal(res.status, 200);
  const ics = await (await req('GET', `/c/${cls.id}.ics`)).text();
  assert.match(ics, /UID:lab-record-submission@notice-decoder[\s\S]*?STATUS:CANCELLED/);
  const j = await (await req('GET', `/c/${cls.id}.json`)).json();
  assert.equal(j.events.find((e) => e.uid === 'lab-record-submission@notice-decoder').cancelled, true);
  assert.equal(j.name, 'III CSE A');
});

await test('subscribe page: Google and webcal links, the event list, the app link', async () => {
  const res = await req('GET', `/c/${cls.id}`);
  assert.equal(res.status, 200);
  const html = await res.text();
  assert.match(html, /calendar\.google\.com\/calendar\/r\?cid=webcal%3A%2F%2Ffeed\.test%2Fc%2F/);
  assert.match(html, new RegExp(`webcal://feed.test/c/${cls.id}.ics`));
  assert.match(html, /Internal Test 2/);
  assert.ok(!/Lab record submission/.test(html), 'cancelled events are not listed');
  assert.match(html, new RegExp(`#c=${cls.id}`));
});

await test('CR console: /events lists everything with the clash report, Bearer only; ETag gives 304 to pollers', async () => {
  assert.equal((await req('GET', `/api/class/${cls.id}/events`)).status, 401);
  const r = await req('GET', `/api/class/${cls.id}/events`, { token: cls.secret });
  assert.equal(r.status, 200);
  const j = await r.json();
  assert.equal(j.events.length, 3, 'cancelled ones are listed too (with cancelled:true)');
  assert.ok(j.events.some((e) => e.cancelled));
  assert.equal(j.clashes.length, 0, 'the deadline was cancelled, the test moved: nothing left to clash');
  assert.match(j.feed, /\.ics$/);
  const first = await req('GET', `/c/${cls.id}.json`);
  const etag = first.headers.get('etag');
  assert.ok(etag && /^"[0-9a-f]{64}"$/.test(etag));
  const again = await handle(new Request(`${BASE}/c/${cls.id}.json`, { headers: { 'if-none-match': etag } }), env);
  assert.equal(again.status, 304);
  await req('POST', `/api/class/${cls.id}/publish`, { body: { events: [{ title: 'Viva', type: 'test', date: '2026-11-14', start: '11:00' }] }, token: cls.secret });
  const after = await handle(new Request(`${BASE}/c/${cls.id}.json`, { headers: { 'if-none-match': etag } }), env);
  assert.equal(after.status, 200, 'a publish changes the ETag');
  const ics = await (await req('GET', `/c/${cls.id}.ics`)).text();
  assert.match(ics, /REFRESH-INTERVAL;VALUE=DURATION:PT1H/);
  assert.match(ics, /X-PUBLISHED-TTL:PT1H/);
  assert.ok(ics.split('\r\n').every((l) => new TextEncoder().encode(l).length <= 75));
});

await test('junk is refused: bad JSON, no events, events without a date, unknown class, oversized body', async () => {
  const bad = await handle(new Request(`${BASE}/api/class/${cls.id}/publish`, { method: 'POST', headers: { authorization: `Bearer ${cls.secret}`, 'content-type': 'application/json' }, body: '{not json' }), env);
  assert.equal(bad.status, 400);
  assert.equal((await req('POST', `/api/class/${cls.id}/publish`, { body: { events: [{ title: 'No date' }] }, token: cls.secret })).status, 400);
  assert.equal((await req('GET', '/c/nope')).status, 404);
  assert.equal((await req('POST', '/api/class', { body: { name: '' } })).status, 400);
  const big = await handle(new Request(`${BASE}/api/class/${cls.id}/publish`, { method: 'POST', headers: { authorization: `Bearer ${cls.secret}`, 'content-type': 'application/json' }, body: JSON.stringify({ events: [], pad: 'x'.repeat(70000) }) }), env);
  assert.equal(big.status, 413);
  const opt = await req('OPTIONS', '/api/class');
  assert.equal(opt.status, 204);
  assert.equal(opt.headers.get('access-control-allow-origin'), '*');
});

console.log(`\n${passed} passed`);
