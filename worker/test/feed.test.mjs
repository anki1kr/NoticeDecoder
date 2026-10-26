// Run: node worker/test/feed.test.mjs   (no wrangler needed: the handler takes a fake KV; `npm ci` in worker/ first)
import assert from 'node:assert/strict';
import { handle } from '../src/index.js';

const store = new Map();
const kv = { get: async (k) => store.get(k) ?? null, put: async (k, v) => { store.set(k, v); }, delete: async (k) => { store.delete(k); } };
const env = { CLASSES: kv, APP_URL: 'https://anki1kr.me/NoticeDecoder/app/', TODAY: '2026-10-26' };
const BASE = 'https://feed.test';
const req = (method, path, { body, token, headers = {}, e = env } = {}) => handle(new Request(BASE + path, {
  method,
  headers: { ...(body !== undefined ? { 'content-type': 'application/json' } : {}), ...(token ? { authorization: `Bearer ${token}` } : {}), ...headers },
  body: body !== undefined ? (typeof body === 'string' ? body : JSON.stringify(body)) : undefined,
}), e);
const J = async (res) => ({ status: res.status, ...(await res.json()) });

let passed = 0;
const test = async (name, fn) => { await fn(); passed++; console.log('ok -', name); };

const test2 = { title: 'Internal Test 2', type: 'test', typeLabel: 'Test', date: '2026-11-13', start: '10:00', end: '11:30', venue: 'Room 204' };
const lecture = { title: 'Guest lecture: AI in Healthcare', type: 'lecture', typeLabel: 'Lecture', date: '2026-11-13', start: '11:00', end: '12:30', venue: 'Seminar Hall' };
const deadline = { title: 'Lab record submission', type: 'deadline', typeLabel: 'Deadline', date: '2026-11-13', start: '12:00', venue: 'Department office' };
const newClass = async (name) => J(await req('POST', '/api/class', { body: { name } }));
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
  assert.equal((await req('POST', `/api/class/${cls.id}/publish`, { body: { events: [test2] }, token: 'nope-nope' })).status, 401);
  assert.equal((await req('POST', '/api/class/zzzzzzzz/publish', { body: { events: [test2] }, token: cls.secret })).status, 404);
});

await test('publish the PDF sample: 3 events, the 2 clashes come back in the report', async () => {
  const r = await J(await req('POST', `/api/class/${cls.id}/publish`, { body: { events: [test2, lecture, deadline] }, token: cls.secret }));
  assert.equal(r.status, 200);
  assert.deepEqual([r.added, r.updated, r.moved, r.count], [3, 0, 0, 3]);
  assert.deepEqual(r.plan.map((p) => p.action), ['add', 'add', 'add']);
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

await test('a revised notice (same title, same day, new time) updates the event instead of adding one', async () => {
  const r = await J(await req('POST', `/api/class/${cls.id}/publish`, { body: { events: [{ ...test2, start: '14:00', end: '15:30' }] }, token: cls.secret }));
  assert.deepEqual([r.added, r.updated, r.count], [0, 1, 3]);
  assert.equal(r.plan[0].prev.start, '10:00');
  assert.equal(r.clashes.length, 1, 'the test moved to the afternoon: only the deadline-in-lecture clash is left');
  const ics = await (await req('GET', `/c/${cls.id}.ics`)).text();
  assert.equal((ics.match(/BEGIN:VEVENT/g) || []).length, 3);
  assert.match(ics, /DTSTART;TZID=Asia\/Kolkata:20261113T140000/);
  assert.ok(!/20261113T100000/.test(ics));
});

await test('publishing the same events again changes nothing', async () => {
  const r = await J(await req('POST', `/api/class/${cls.id}/publish`, { body: { events: [{ ...test2, start: '14:00', end: '15:30' }, lecture] }, token: cls.secret }));
  assert.deepEqual(r.plan.map((p) => p.action), ['same', 'same']);
  assert.equal(r.unchanged, 2);
});

await test('cancel one event: it stays in the feed as STATUS:CANCELLED so subscribers drop it', async () => {
  const res = await req('DELETE', `/api/class/${cls.id}/events/${encodeURIComponent('lab-record-submission@notice-decoder')}`, { token: cls.secret });
  assert.equal(res.status, 200);
  const ics = await (await req('GET', `/c/${cls.id}.ics`)).text();
  assert.match(ics, /UID:lab-record-submission@notice-decoder[\s\S]*?STATUS:CANCELLED/);
  assert.ok(!/SUMMARY:🔴/.test(ics), 'a cancelled deadline no longer marks the lecture as a clash');
  const j = await (await req('GET', `/c/${cls.id}.json`)).json();
  assert.equal(j.events.find((e) => e.uid === 'lab-record-submission@notice-decoder').cancelled, true);
  assert.equal(j.name, 'III CSE A');
  assert.equal(j.changes[0].kind, 'cancelled');
});

await test('subscribe page: Google and webcal links, upcoming list, what changed, the app link, noindex', async () => {
  const res = await req('GET', `/c/${cls.id}`);
  assert.equal(res.status, 200);
  assert.equal(res.headers.get('x-frame-options'), 'DENY');
  const html = await res.text();
  assert.match(html, /calendar\.google\.com\/calendar\/r\?cid=webcal%3A%2F%2Ffeed\.test%2Fc%2F/);
  assert.match(html, new RegExp(`webcal://feed.test/c/${cls.id}.ics`));
  assert.match(html, /Internal Test 2/);
  assert.match(html, /2 upcoming events/);
  assert.match(html, /<span class="tag k-cancelled">Cancelled<\/span> Lab record submission/, 'the cancel is announced');
  assert.match(html, /<span class="tag k-moved">Moved<\/span> Internal Test 2: 13 Nov 2026 10:00 AM → <b>13 Nov 2026 2:00 PM<\/b>/);
  assert.match(html, new RegExp(`#c=${cls.id}`));
  assert.match(html, /<meta name="robots" content="noindex">/);
  assert.match(html, /integrity="sha384-/);
});

await test('CR console: /events lists everything with the clash report and changes, Bearer only; ETag gives 304 to pollers', async () => {
  assert.equal((await req('GET', `/api/class/${cls.id}/events`)).status, 401);
  const j = await J(await req('GET', `/api/class/${cls.id}/events`, { token: cls.secret }));
  assert.equal(j.status, 200);
  assert.equal(j.events.length, 3, 'cancelled ones are listed too (with cancelled:true)');
  assert.ok(j.events.some((e) => e.cancelled));
  assert.equal(j.clashes.length, 0, 'the deadline was cancelled, the test moved: nothing left to clash');
  assert.ok(j.changes.length >= 4);
  assert.match(j.feed, /\.ics$/);
  const first = await req('GET', `/c/${cls.id}.json`);
  const etag = first.headers.get('etag');
  assert.ok(etag && /^"[0-9a-f]{32}"$/.test(etag));
  const again = await handle(new Request(`${BASE}/c/${cls.id}.json`, { headers: { 'if-none-match': etag } }), env);
  assert.equal(again.status, 304);
  await req('POST', `/api/class/${cls.id}/publish`, { body: { events: [{ title: 'Viva', type: 'test', date: '2026-11-14', start: '11:00' }] }, token: cls.secret });
  const after = await handle(new Request(`${BASE}/c/${cls.id}.json`, { headers: { 'if-none-match': etag } }), env);
  assert.equal(after.status, 200, 'a publish changes the ETag');
  const ics = await (await req('GET', `/c/${cls.id}.ics`)).text();
  assert.match(ics, /REFRESH-INTERVAL;VALUE=DURATION:PT1H/);
  assert.match(ics, /X-PUBLISHED-TTL:PT1H/);
  assert.ok(ics.split('\r\n').every((l) => new TextEncoder().encode(l).length <= 75));
  const page1 = (await req('GET', `/c/${cls.id}`)).headers.get('etag');
  const page2 = (await req('GET', `/c/${cls.id}`, { e: { ...env, TODAY: '2026-10-27' } })).headers.get('etag');
  assert.notEqual(page1, page2, 'the page tag changes at midnight, so "upcoming" never goes stale in a cache');
});

await test('same generic title on another date is a NEW event (v1 silently moved the first quiz)', async () => {
  const c = await newClass('II ECE A');
  await req('POST', `/api/class/${c.id}/publish`, { body: { events: [{ title: 'Quiz', type: 'test', date: '2026-11-05', start: '10:00' }] }, token: c.secret });
  const r = await J(await req('POST', `/api/class/${c.id}/publish`, { body: { events: [{ title: 'Quiz', type: 'test', date: '2026-11-12', start: '10:00' }] }, token: c.secret }));
  assert.deepEqual([r.added, r.moved, r.count], [1, 0, 2]);
  assert.equal(r.plan[0].action, 'add');
  assert.equal(r.plan[0].uid, 'quiz-20261112@notice-decoder');
  assert.deepEqual([r.plan[0].alt.action, r.plan[0].alt.intent, r.plan[0].alt.date], ['move', 'replace:quiz@notice-decoder', '2026-11-05'], 'the other reading is offered to the CR');
  const ics = await (await req('GET', `/c/${c.id}.ics`)).text();
  assert.match(ics, /UID:quiz@notice-decoder[\s\S]*DTSTART;TZID=Asia\/Kolkata:20261105T100000/);
  assert.match(ics, /UID:quiz-20261112@notice-decoder/);
});

await test('a specific title on another date MOVES the event; the CR can say "it is a different one" instead', async () => {
  const c = await newClass('III IT B');
  const pub = async (events, extra = {}, dry = false) => J(await req('POST', `/api/class/${c.id}/publish${dry ? '?dry=1' : ''}`, { body: { events, ...extra }, token: c.secret }));
  await pub([test2]);
  const before = store.get(`class:${c.id}`);
  const dry = await pub([{ ...test2, date: '2026-11-16' }], {}, true);
  assert.equal(dry.plan[0].action, 'move');
  assert.deepEqual([dry.plan[0].prev.date, dry.plan[0].alt.intent], ['2026-11-13', 'new']);
  assert.equal(store.get(`class:${c.id}`), before, 'a dry run writes nothing');
  const moved = await pub([{ ...test2, date: '2026-11-16' }]);
  assert.deepEqual([moved.moved, moved.count], [1, 1]);
  const both = await pub([{ ...test2, date: '2026-11-20' }], { intents: { 0: 'new' } });
  assert.deepEqual([both.added, both.count], [1, 2], 'intent "new" keeps both');
  const j = await J(await req('GET', `/api/class/${c.id}/events`, { token: c.secret }));
  const mv = j.changes.find((x) => x.kind === 'moved');
  assert.deepEqual([mv.from.date, mv.date], ['2026-11-13', '2026-11-16']);
  assert.equal(j.stats.revised, 1);
  const quiz = await pub([{ title: 'Quiz', type: 'test', date: '2026-11-05' }]);
  const replace = await pub([{ title: 'Quiz', type: 'test', date: '2026-11-07' }], { intents: { 0: `replace:${quiz.plan[0].uid}` } });
  assert.deepEqual([replace.plan[0].action, replace.moved], ['move', 1], 'intent "replace:<uid>" moves even a generic title');
  const notice = await pub([{ title: 'Quiz', type: 'test', date: '2026-11-09', moved: true }]);
  assert.equal(notice.plan[0].action, 'move', 'the notice itself said "postponed to": a move');
});

await test('edit one published event from the console (same UID), restore a cancel, refuse a broken edit', async () => {
  const c = await newClass('IV ME');
  await req('POST', `/api/class/${c.id}/publish`, { body: { events: [test2, lecture] }, token: c.secret });
  const uid = encodeURIComponent('internal-test-2@notice-decoder');
  const ed = await J(await req('PATCH', `/api/class/${c.id}/events/${uid}`, { body: { start: '15:00', end: '16:30', venue: 'Room 301' }, token: c.secret }));
  assert.equal(ed.status, 200);
  assert.deepEqual([ed.event.start, ed.event.end, ed.event.venue, ed.event.uid], ['15:00', '16:30', 'Room 301', 'internal-test-2@notice-decoder']);
  assert.equal((await req('PATCH', `/api/class/${c.id}/events/${uid}`, { body: { date: '2026-02-31' }, token: c.secret })).status, 400);
  assert.equal((await req('PATCH', `/api/class/${c.id}/events/${uid}`, { body: { title: '   ' }, token: c.secret })).status, 400);
  assert.equal((await req('PATCH', `/api/class/${c.id}/events/${uid}`, { body: { start: '9:00' } })).status, 401);
  await req('DELETE', `/api/class/${c.id}/events/${uid}`, { token: c.secret });
  const back = await J(await req('POST', `/api/class/${c.id}/events/${uid}/restore`, { token: c.secret }));
  assert.equal(back.event.cancelled, false);
  const j = await J(await req('GET', `/api/class/${c.id}/events`, { token: c.secret }));
  assert.deepEqual(j.changes.slice(0, 3).map((x) => x.kind), ['restored', 'cancelled', 'moved']);
  assert.equal(j.stats.cancelled, 1);
  assert.equal((await req('PATCH', `/api/class/${c.id}/events/${encodeURIComponent('nope@notice-decoder')}`, { body: { start: '09:00' }, token: c.secret })).status, 404);
  assert.equal((await req('PATCH', `/api/class/${c.id}/events/%E0%A4%A`, { body: {}, token: c.secret })).status, 400, 'a broken %-escape is a 400, not a 500');
});

await test('rename, rotate the key (the old one stops working), delete the class', async () => {
  const c = await newClass('Temp');
  assert.equal((await J(await req('PATCH', `/api/class/${c.id}`, { body: { name: '  III   CSE B  ' }, token: c.secret }))).name, 'III CSE B');
  assert.equal((await req('PATCH', `/api/class/${c.id}/whatever`, { body: { name: 'X' }, token: c.secret })).status, 404, 'an unknown sub-path never renames');
  const rot = await J(await req('POST', `/api/class/${c.id}/rotate`, { token: c.secret }));
  assert.equal(rot.secret.length, 32);
  assert.equal((await req('GET', `/api/class/${c.id}/events`, { token: c.secret })).status, 401, 'old key is dead');
  assert.equal((await req('GET', `/api/class/${c.id}/events`, { token: rot.secret })).status, 200);
  assert.equal((await req('DELETE', `/api/class/${c.id}`, { token: rot.secret })).status, 200);
  assert.equal((await req('GET', `/c/${c.id}.json`)).status, 404);
  assert.equal((await req('GET', `/c/${c.id}`)).status, 404);
});

await test('Hindi titles get their own UIDs (v1 gave every Hindi event the UID "event")', async () => {
  const c = await newClass('हिंदी कक्षा');
  const r = await J(await req('POST', `/api/class/${c.id}/publish`, { body: { events: [
    { title: 'गणित की परीक्षा', type: 'test', date: '2026-11-13', start: '10:00' },
    { title: 'भौतिकी की परीक्षा', type: 'test', date: '2026-11-14', start: '10:00' },
  ] }, token: c.secret }));
  assert.equal(r.added, 2);
  assert.equal(new Set(r.plan.map((p) => p.uid)).size, 2);
  const again = await J(await req('POST', `/api/class/${c.id}/publish`, { body: { events: [{ title: 'गणित की परीक्षा', type: 'test', date: '2026-11-13', start: '11:00' }] }, token: c.secret }));
  assert.deepEqual([again.plan[0].action, again.count], ['update', 2]);
});

await test('nothing a CR or a stranger sends can inject HTML or break the feed', async () => {
  const c = await newClass('<script>alert(1)</script> & "CSE"');
  await req('POST', `/api/class/${c.id}/publish`, { body: { events: [
    { title: '<img src=x onerror=alert(1)>', type: 'evil', date: '2026-11-13', start: '25:00', end: '10:00', venue: '<b>x</b>', link: 'javascript:alert(1)', durationMin: -5, repeat: 9999, every: 'XX' },
    { title: 'Ok event', type: 'other', date: '2026-02-31' }, 'string', null, 42, [], { title: 'No date' },
  ] }, token: c.secret });
  const html = await (await req('GET', `/c/${c.id}`)).text();
  assert.ok(!/<script>alert|<img src=x|<b>x<\/b>|javascript:/.test(html), 'everything is escaped or dropped');
  assert.match(html, /&lt;script&gt;alert\(1\)&lt;\/script&gt; &amp; &quot;CSE&quot;/);
  const j = await (await req('GET', `/c/${c.id}.json`)).json();
  assert.equal(j.events.length, 1, 'only the event with a real date got in');
  const [e] = j.events;
  assert.deepEqual([e.type, e.start, e.link, e.durationMin, e.repeat, e.every], ['other', undefined, undefined, undefined, undefined, undefined]);
  const r = await J(await req('POST', `/api/class/${c.id}/publish`, { body: { events: [{ title: 'Viva', type: 'test', date: '2026-11-13' }, { title: 'x', date: 'soon' }] }, token: c.secret }));
  assert.equal(r.skipped, 1, 'the CR is told how many events were left out');
});

await test('junk is refused: bad JSON, no events, unknown class, oversized body, wrong body shape, rate limit', async () => {
  const bad = await handle(new Request(`${BASE}/api/class/${cls.id}/publish`, { method: 'POST', headers: { authorization: `Bearer ${cls.secret}`, 'content-type': 'application/json' }, body: '{not json' }), env);
  assert.equal(bad.status, 400);
  assert.equal((await req('POST', `/api/class/${cls.id}/publish`, { body: '[1,2]', token: cls.secret })).status, 400);
  assert.equal((await req('POST', `/api/class/${cls.id}/publish`, { body: { events: [{ title: 'No date' }] }, token: cls.secret })).status, 400);
  assert.equal((await req('POST', `/api/class/${cls.id}/publish`, { body: { events: 'x' }, token: cls.secret })).status, 400);
  assert.equal((await req('GET', '/c/nope')).status, 404);
  assert.equal((await req('GET', '/c/abcdefgh.ics')).status, 404);
  assert.equal((await req('POST', '/api/class', { body: { name: '' } })).status, 400);
  assert.equal((await req('POST', '/api/class', { body: { name: { x: 1 } } })).status, 400, 'a non-string name is refused, never stored as "[object Object]"');
  const big = await handle(new Request(`${BASE}/api/class/${cls.id}/publish`, { method: 'POST', headers: { authorization: `Bearer ${cls.secret}`, 'content-type': 'application/json' }, body: JSON.stringify({ events: [], pad: 'x'.repeat(140000) }) }), env);
  assert.equal(big.status, 413);
  const opt = await req('OPTIONS', '/api/class');
  assert.equal(opt.status, 204);
  assert.equal(opt.headers.get('access-control-allow-origin'), '*');
  assert.match(opt.headers.get('access-control-allow-methods'), /PATCH/);
  let n = 0;
  const limitedEnv = { ...env, CREATE_LIMIT: { limit: async () => ({ success: ++n <= 2 }) } };
  const codes = [];
  for (let i = 0; i < 4; i++) codes.push((await req('POST', '/api/class', { body: { name: 'Spam' }, e: limitedEnv })).status);
  assert.deepEqual(codes, [201, 201, 429, 429]);
  const health = await J(await req('GET', '/health'));
  assert.deepEqual([health.ok, health.ai], [true, false]);
});

await test('a v1 record (no keys, no changes) is read and upgraded on the fly', async () => {
  store.set('class:oldclass1', JSON.stringify({ name: 'Old', secretHash: 'x', events: { 'quiz@notice-decoder': { title: 'Quiz', type: 'test', date: '2026-11-05', uid: 'quiz@notice-decoder' } }, createdAt: '2026-10-01T00:00:00Z', updatedAt: '2026-10-01T00:00:00Z' }));
  const j = await (await req('GET', '/c/oldclass1.json')).json();
  assert.equal(j.events.length, 1);
  assert.deepEqual(j.changes, []);
  assert.equal((await req('GET', '/c/oldclass1')).status, 200);
});

await test('pilot numbers: publishes, revisions, clashes counted once, cancellations', async () => {
  const c = await newClass('II ECE B');
  const pub = (events) => req('POST', `/api/class/${c.id}/publish`, { body: { events }, token: c.secret });
  await pub([test2, lecture, deadline]);
  await pub([{ ...test2, start: '14:00', end: '15:30' }]);
  await pub([{ ...test2, start: '14:00', end: '15:30' }]);
  const listed = await (await req('GET', `/api/class/${c.id}/events`, { token: c.secret })).json();
  const uid = listed.events.find((e) => e.title === deadline.title).uid;
  await req('DELETE', `/api/class/${c.id}/events/${encodeURIComponent(uid)}`, { token: c.secret });
  const { stats } = await (await req('GET', `/api/class/${c.id}/events`, { token: c.secret })).json();
  assert.deepEqual([stats.publishes, stats.events, stats.revised, stats.cancelled, stats.clashesFound], [3, 2, 1, 1, 2]);
  assert.ok(stats.since);
  assert.ok(!('clashSeen' in stats), 'the clash keys stay inside the class record');
});

console.log(`\n${passed} passed`);
