// Browser check of the whole page (phone width), the share link round trip, the share target and the service worker.
// Needs the server: python -m http.server 8771 --bind 127.0.0.1 --directory app
// Run from the repo root: node tools/ui-check.mjs   (screenshots land in tmp/)
// Playwright is not a dependency of this repo: `npm i -D playwright` here, or point PLAYWRIGHT_DIR at a project that has it.
import { createRequire } from 'node:module';
import path from 'node:path';
const require = createRequire(path.join(process.env.PLAYWRIGHT_DIR || process.cwd(), 'package.json'));
const { chromium } = require('playwright');

const BASE = 'http://127.0.0.1:8771/';
let pass = 0, fail = 0;
const ok = (cond, name, extra = '') => { if (cond) { pass++; console.log('ok -', name); } else { fail++; console.log('FAIL -', name, extra); } };

const browser = await chromium.launch({ channel: process.env.PW_CHANNEL || 'chrome' });
const context = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, permissions: ['clipboard-read', 'clipboard-write'] });
const errors = [];
// Google Calendar stand-in: records every request; GET lookups find nothing, POST /import creates, DELETE removes.
await context.addInitScript(() => {
  const log = [];
  let n = 0;
  window.__ndGcalLog = log;
  window.__ndGcalDeps = {
    token: 'test-token',
    fetch: async (url, init = {}) => {
      const body = init.body ? JSON.parse(init.body) : null;
      log.push({ method: init.method, url: String(url), body });
      if (init.method === 'GET') return new Response(JSON.stringify({ items: [] }), { status: 200 });
      if (init.method === 'DELETE') return new Response(null, { status: 204 });
      return new Response(JSON.stringify({ id: `g${++n}`, htmlLink: `https://calendar.google.com/event?eid=g${n}` }), { status: 200 });
    },
  };
});
await context.addInitScript(() => {
  window.__ndFeedBase = 'https://feed.test';
  // the fake feed's store lives in localStorage so a second page (the student) sees what the first (the CR) published
  const feed = { get events() { try { return JSON.parse(localStorage.getItem('__ndFeed') || '[]'); } catch { return []; } }, set events(v) { localStorage.setItem('__ndFeed', JSON.stringify(v)); } };
  window.__ndFeedLog = [];
  const real = window.fetch.bind(window);
  window.fetch = async (url, init = {}) => {
    const u = String(url);
    if (!u.startsWith('https://feed.test')) return real(url, init);
    const body = init.body ? JSON.parse(init.body) : null;
    window.__ndFeedLog.push({ method: init.method || 'GET', url: u, body, auth: init.headers?.Authorization || null });
    const j = (d, s = 200) => new Response(JSON.stringify(d), { status: s, headers: { 'content-type': 'application/json' } });
    if (u.endsWith('/api/class')) return j({ id: 'abcd2345', secret: 'sec', name: body.name, feed: 'https://feed.test/c/abcd2345.ics', page: 'https://feed.test/c/abcd2345' }, 201);
    if (/\/publish$/.test(u)) { if (init.headers?.Authorization !== 'Bearer sec') return j({ error: 'Wrong or missing class secret.' }, 401); let added = 0, updated = 0; const list = feed.events; for (const e of body.events) { const i = list.findIndex((x) => x.title === e.title); if (i >= 0) { list[i] = e; updated++; } else { list.push(e); added++; } } feed.events = list; return j({ id: 'abcd2345', added, updated, count: list.length, clashes: feed.events.length >= 3 ? [{ a: 'Internal Test 2', b: 'Guest lecture: AI in Healthcare', date: '2026-11-13', msg: 'Clash. They overlap from 11:00 to 11:30 AM (30 minutes).' }] : [] }); }
    if (/\/api\/class\/abcd2345\/events$/.test(u) && (init.method || 'GET') === 'GET') { if (init.headers?.Authorization !== 'Bearer sec') return j({ error: 'Wrong or missing class secret.' }, 401); const evs = feed.events.map((e) => ({ ...e, uid: `${e.title.toLowerCase().replace(/[^a-z0-9]+/g, '-')}@notice-decoder` })); return j({ id: 'abcd2345', name: 'III CSE A', updatedAt: '2026-10-15T10:00:00Z', events: evs, clashes: evs.filter((e) => !e.cancelled).length >= 3 ? [{ a: 'Internal Test 2', b: 'Guest lecture: AI in Healthcare', date: '2026-11-13', msg: 'Clash. They overlap from 11:00 to 11:30 AM (30 minutes).' }] : [] }); }
    if (/\/api\/class\/abcd2345\/events\//.test(u) && init.method === 'DELETE') { const uid = decodeURIComponent(u.split('/events/')[1]); const list = feed.events; const i = list.findIndex((e) => `${e.title.toLowerCase().replace(/[^a-z0-9]+/g, '-')}@notice-decoder` === uid); if (i >= 0) { list[i] = { ...list[i], cancelled: true }; feed.events = list; } return j({ ok: true, uid }); }
    if (/\/c\/abcd2345\.json$/.test(u)) return j({ id: 'abcd2345', name: 'III CSE A', updatedAt: '2026-10-15T10:00:00Z', events: feed.events.map((e) => ({ ...e, uid: `${e.title.toLowerCase().replace(/[^a-z0-9]+/g, '-')}@notice-decoder` })) });
    return j({ error: 'Not found' }, 404);
  };
});
const titlesOf = () => page.locator('#event-list .ev').evaluateAll((els) => els.map((e) => e.querySelector('[data-field="title"] input')?.value ?? e.querySelector('.row-title')?.firstChild?.textContent));
const page = await context.newPage();
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
page.on('pageerror', (e) => errors.push(String(e)));

await page.goto(BASE, { waitUntil: 'networkidle' });
for (const f of ['manifest.webmanifest', 'icon-192.png', 'icon-512.png', 'icon-maskable-512.png', 'sw.js', 'engine/holidays.js']) {
  const r = await page.request.get(BASE + f);
  ok(r.status() === 200, `GET ${f} 200`);
}

// 1. PDF sample: 3 events, 2 clashes, export open
await page.getByRole('button', { name: 'Exam day clash (PDF sample)' }).click();
await page.waitForSelector('#event-list .ev');
ok(await page.locator('#event-list .ev').count() === 3, 'PDF sample: 3 event cards');
ok((await page.locator('#summary').innerText()).includes('2 clashes'), 'PDF sample: summary says 2 clashes');
ok(await page.locator('#export-btn').isEnabled(), 'PDF sample: export enabled');
ok(await page.locator('#event-list .row').count() === 3 && await page.locator('#event-list article.card').count() === 0, 'PDF sample: nothing amber, so three one-line rows and no form');
await page.locator('#event-list .row').first().getByRole('button', { name: /^Edit/ }).click();
ok(await page.locator('#event-list article.card').count() === 1, 'Edit opens the full card for one event');
ok(await page.locator('.ev [data-field="link"] input').count() === 1 && await page.locator('.ev [data-field="durationMin"] input').count() === 1, 'card has Link and Takes (minutes) fields');
await page.screenshot({ path: 'tmp/shot-pdf-390.png', fullPage: true });

// 2. Edit: lecture start 11:30 -> the 30 min overlap is gone
await page.locator('#event-list .ev').filter({ hasText: 'AI in Healthcare' }).getByRole('button', { name: /^Edit/ }).click();
const lecture = page.locator('#event-list .ev').filter({ hasText: 'AI in Healthcare' });
await lecture.locator('[data-field="start"] input').fill('11:30');
ok((await page.locator('#summary').innerText()).includes('1 clash'), 'edit lecture start to 11:30: one clash left (deadline inside lecture)');

// 3. Delete + Undo
await page.locator('#event-list .ev').first().getByRole('button', { name: /^Delete/ }).click();
ok(await page.locator('#event-list .ev').count() === 2, 'delete removes a card');
ok((await page.locator('#events-hint').innerText()).includes('Undo'), 'Undo offered');
await page.locator('#events-hint').getByRole('button', { name: 'Undo' }).click();
ok(await page.locator('#event-list .ev').count() === 3, 'undo restores the card');

// 4. Copy summary for the class group
await page.locator('#copy-btn').click();
await page.waitForFunction(() => /Copied/.test(document.querySelector('#export-status').innerText), null, { timeout: 5000 }).catch(() => {});
const summary = await page.evaluate(() => navigator.clipboard.readText());
ok(/📅 .*13 Nov 2026/.test(summary) && /Internal Test 2/.test(summary) && /clash/i.test(summary), 'copy summary: dates, events and clashes in plain text', summary.slice(0, 200));

// 4b. Add all to Google Calendar (mocked API): 3 lookups, 3 imports with the .ics UIDs and times, then Undo deletes 3
ok(await page.locator('#gcal-all-btn').isEnabled(), 'gcal: Add all enabled');
await page.locator('#gcal-all-btn').click();
await page.waitForFunction(() => /Google Calendar: added 3/.test(document.querySelector('#export-status').innerText), null, { timeout: 5000 }).catch(() => {});
ok(/Google Calendar: added 3/.test(await page.locator('#export-status').innerText()), 'gcal: status says added 3', await page.locator('#export-status').innerText());
const glog = await page.evaluate(() => window.__ndGcalLog);
const imports = glog.filter((r) => r.method === 'POST' && /\/import$/.test(r.url));
const mk = glog.filter((r) => r.method === 'POST' && /\/calendars$/.test(r.url));
ok(mk.length === 1 && mk[0].body.summary === 'Notice Decoder' && imports.every((r) => /\/calendars\/g1\/events\/import$/.test(r.url)), 'gcal: one "Notice Decoder" calendar is created and every event goes into it, never the primary calendar', JSON.stringify(mk));
ok(glog.filter((r) => r.method === 'GET' && /iCalUID=/.test(r.url)).length === 3 && imports.length === 3, 'gcal: 3 lookups by iCalUID + 3 imports');
const test2 = imports.find((r) => r.body.iCalUID === 'internal-test-2@notice-decoder');
const dl = imports.find((r) => /lab-record/.test(r.body.iCalUID));
ok(test2 && ['11', '6'].includes(test2.body.colorId) && /^(🔴|🟠) 📝/.test(test2.body.summary) && test2.body.reminders.overrides[0].minutes === 1440 && /📅/.test(test2.body.description), 'gcal: test is flagged red or orange for its neighbours, has a 1-day reminder and a formatted description', JSON.stringify(test2?.body));
ok(test2 && test2.body.start.dateTime === '2026-11-13T10:00:00' && test2.body.start.timeZone === 'Asia/Kolkata' && test2.body.end.dateTime === '2026-11-13T11:30:00', 'gcal: test times match the .ics', JSON.stringify(test2?.body));
ok(dl && dl.body.start.dateTime === '2026-11-13T11:30:00' && dl.body.end.dateTime === '2026-11-13T12:00:00' && /Deadline:/.test(dl.body.summary) && dl.body.reminders.overrides[0].minutes === 180, 'gcal: deadline is the 30 min before, 3 h reminder', JSON.stringify(dl?.body));
await page.locator('#export-status').getByRole('button', { name: 'Undo' }).click();
await page.waitForFunction(() => /Removed 3/.test(document.querySelector('#export-status').innerText), null, { timeout: 5000 }).catch(() => {});
ok((await page.evaluate(() => window.__ndGcalLog)).filter((r) => r.method === 'DELETE').length === 3, 'gcal: Undo deleted the 3 events');

// 5. Share with class: link copied, opens in a fresh page with the same events and the export open
await page.locator('#share-btn').click();
await page.waitForFunction(() => /Link copied|Shared/.test(document.querySelector('#export-status').innerText), null, { timeout: 5000 }).catch(() => {});
ok(/Link copied|Shared/.test(await page.locator('#export-status').innerText()), 'share: link copied');
const link = await page.evaluate(() => navigator.clipboard.readText());
ok(link.startsWith(BASE) && link.includes('#s='), 'share: link is this app with #s=', link.slice(0, 80));
const page2 = await context.newPage();
page2.on('pageerror', (e) => errors.push(String(e)));
await page2.goto(link, { waitUntil: 'networkidle' });
await page2.waitForSelector('#event-list .ev');
ok(await page2.locator('#event-list .ev').count() === 3, 'shared link: 3 events render');
ok(await page2.locator('#shared-banner').isVisible(), 'shared link: banner shown');
ok(await page2.locator('#notice-card').isHidden(), 'shared link: no notice panel');
ok(await page2.locator('#export-btn').isEnabled(), 'shared link: export open');
ok((await page2.locator('#summary').innerText()).includes('1 clash'), 'shared link: edited start travelled (1 clash)');
await page2.screenshot({ path: 'tmp/shot-shared-390.png', fullPage: true });
await page2.close();

// 5b. Class feed: first publish creates the class, the report comes back, a student opens it by id and by #c= link
ok(await page.locator('#class-section').isVisible(), 'class feed: section shown when a feed base is configured');
page.once('dialog', (d) => d.accept('III CSE A'));
await page.locator('#class-publish-btn').click();
await page.waitForFunction(() => /Published: 3 new/.test(document.querySelector('#class-result').innerText), null, { timeout: 5000 }).catch(() => {});
const pub = await page.locator('#class-result').innerText();
ok(/Published: 3 new, 0 updated, 3 in the class calendar/.test(pub) && /1 clash across/.test(pub), 'class feed: publish created the class, 3 events, clash report', pub);
const flog = await page.evaluate(() => window.__ndFeedLog);
ok(flog.some((r) => r.url.endsWith('/api/class') && r.body.name === 'III CSE A') && flog.some((r) => /publish$/.test(r.url) && r.auth === 'Bearer sec' && r.body.events.length === 3 && r.body.events[0].title === 'Internal Test 2'), 'class feed: create + authenticated publish with the reviewed events');
ok((await page.locator('#class-status').innerText()).includes('Your class: III CSE A'), 'class feed: class remembered for the CR');
ok(await page.locator('#class-publish-btn').innerText() === 'Publish to III CSE A', 'class feed: publish button names the class');
await page.locator('#class-publish-btn').click();
await page.waitForFunction(() => /0 new, 3 updated/.test(document.querySelector('#class-result').innerText), null, { timeout: 5000 }).catch(() => {});
ok(/0 new, 3 updated/.test(await page.locator('#class-result').innerText()), 'class feed: second publish updates, never duplicates');
await page.waitForFunction(() => /3 events in III CSE A/.test(document.querySelector('#class-console-hint').innerText), null, { timeout: 5000 }).catch(() => {});
ok(/3 events in III CSE A, 1 clash across the term/.test(await page.locator('#class-console-hint').innerText()), 'CR console: lists what is published with the term clash report', await page.locator('#class-console-hint').innerText());
ok(await page.locator('#class-console-list li').count() === 4, 'CR console: 1 clash line + 3 events');
page.once('dialog', (d) => d.accept());
await page.locator('#class-console-list').getByRole('button', { name: /^Cancel Lab record/ }).click();
await page.waitForFunction(() => /2 events in III CSE A/.test(document.querySelector('#class-console-hint').innerText), null, { timeout: 5000 }).catch(() => {});
ok(/2 events in III CSE A/.test(await page.locator('#class-console-hint').innerText()) && (await page.locator('#class-console-list').innerText()).includes('(cancelled)'), 'CR console: Cancel marks the event cancelled for the class');
const page5 = await context.newPage();
page5.on('pageerror', (e) => errors.push(String(e)));
await page5.goto(BASE, { waitUntil: 'networkidle' });
await page5.locator('#class-join').fill('https://feed.test/c/abcd2345');
await page5.locator('#class-join-btn').click();
await page5.waitForSelector('#event-list .ev', { timeout: 5000 }).catch(() => {});
ok(await page5.locator('#event-list .ev').count() === 2, 'class feed: student opens the class by link, 2 live events (the cancelled one is gone)');
ok((await page5.locator('#shared-text').innerText()).includes('III CSE A'), 'class feed: banner names the class');
ok(await page5.locator('#gcal-all-btn').isEnabled() && await page5.locator('#export-btn').isEnabled(), 'class feed: student can add all in one tap');
await page5.goto(`${BASE}#c=abcd2345`, { waitUntil: 'networkidle' });
await page5.waitForSelector('#event-list .ev', { timeout: 5000 }).catch(() => {});
ok(await page5.locator('#event-list .ev').count() === 2, 'class feed: #c=<id> link opens the class directly');
await page5.close();

// 6. Placement sample: amber fields lock the export; "Looks right" opens it
await page.getByRole('button', { name: 'Placement drive' }).click();
await page.waitForSelector('#event-list .ev');
ok(await page.locator('#export-btn').isDisabled(), 'placement: export locked while fields need a check');
ok(await page.locator('#pending-list li').count() === 2, 'placement: 2 items not scheduled yet');

// 7. Timetable paste
await page.locator('#notice-input').fill('Exam schedule:\n10 Nov 2026 - Maths - 10 AM to 1 PM - Room 1\n11 Nov 2026 - Physics - 10 AM to 1 PM - Room 1\n12 Nov 2026 - Chemistry - 2 PM to 5 PM - Room 2');
await page.locator('#decode-btn').click();
const titles = await titlesOf();
ok(JSON.stringify(titles) === JSON.stringify(['Maths exam', 'Physics exam', 'Chemistry exam']), 'timetable: subject titles', JSON.stringify(titles));
ok(await page.locator('#warnings').isHidden(), 'timetable: no false contradiction warning');

// 8. Same-hour tests: two cards and a clash
await page.locator('#notice-input').fill('Internal test in Maths on 13 Nov 2026 at 10 AM in Room 1.\nLab exam in Physics on 13 Nov 2026 at 10 AM in Lab 2.');
await page.locator('#decode-btn').click();
ok(await page.locator('#event-list .ev').count() === 2, 'two tests at 10 AM: two cards');
ok((await page.locator('#summary').innerText()).includes('1 clash'), 'two tests at 10 AM: clash reported');

// 8b. Exam timetable chip: five cards, Thursday/Friday flag, export locked until it is answered
await page.getByRole('button', { name: 'Exam timetable' }).click();
await page.waitForSelector('#event-list .ev');
ok(await page.locator('#event-list .ev').count() === 5, 'timetable chip: 5 events');
ok(await page.locator('#event-list article.card').count() === 1 && await page.locator('#event-list .row').count() === 4, 'timetable chip: only the amber one is a form, the other four are rows');
ok((await page.locator('#event-list').innerText()).includes('is a Friday'), 'timetable chip: weekday mismatch shown on the card');
ok(await page.locator('#export-btn').isDisabled(), 'timetable chip: export locked by the amber flag');
await page.locator('#event-list .ev').first().getByRole('button', { name: 'Looks right' }).click();
ok(await page.locator('#export-btn').isEnabled(), 'timetable chip: Looks right opens the export');
await page.screenshot({ path: 'tmp/shot-timetable-390.png', fullPage: true });

// 9. Untitled manual event locks the export
await page.locator('#clear-btn').click();
await page.locator('#notice-input').fill('Viva on 14 Nov 2026 from 2 PM to 3 PM in Lab 3.');
await page.locator('#decode-btn').click();
await page.locator('#add-btn').click();
ok((await page.locator('#export-status').innerText()).includes('Add a date'), 'manual event: needs a date first');
await page.locator('#event-list .ev').last().locator('[data-field="date"] input').fill('2026-11-14');
ok((await page.locator('#export-status').innerText()).includes('Give a title'), 'manual event: needs a title');
await page.locator('#event-list .ev').last().locator('[data-field="title"] input').fill('Project review');
ok(await page.locator('#export-btn').isEnabled(), 'manual event: titled and dated, export open');

// 9b. Auto-decode: a pasted notice decodes with no button press
await page.locator('#clear-btn').click();
await page.locator('#notice-input').fill('Guest lecture on 20 Nov 2026 at 11 AM in Seminar Hall.');
await page.waitForSelector('#event-list .ev', { timeout: 4000 }).catch(() => {});
ok(await page.locator('#event-list .ev').count() === 1, 'auto-decode: typed notice decoded after a pause, no Decode click');

// 10. Share target (?text=) decodes on load
const page3 = await context.newPage();
page3.on('pageerror', (e) => errors.push(String(e)));
await page3.goto(`${BASE}?text=${encodeURIComponent('Guest lecture on 20 Nov 2026 at 11 AM in Seminar Hall.')}`, { waitUntil: 'networkidle' });
await page3.waitForSelector('#event-list .ev');
ok(await page3.locator('#event-list .ev').count() === 1, 'share target: ?text= decoded on load');
ok(!page3.url().includes('text='), 'share target: query removed from the address');
ok(!/added automatically/.test(await page3.locator('#export-status').innerText()), 'share target: no auto-add while the setting is off');
await page3.evaluate(() => localStorage.setItem('nd-auto-add', '1'));
await page3.goto(`${BASE}?text=${encodeURIComponent('Guest lecture on 20 Nov 2026 at 11 AM in Seminar Hall.')}`, { waitUntil: 'networkidle' });
await page3.waitForFunction(() => /added automatically/.test(document.querySelector('#export-status').innerText), null, { timeout: 5000 }).catch(() => {});
ok(/Google Calendar: added 1.*added automatically/.test(await page3.locator('#export-status').innerText()), 'share target + auto-add on: event added to Google Calendar with no tap', await page3.locator('#export-status').innerText());
await page3.evaluate(() => localStorage.removeItem('nd-auto-add'));
await page3.close();

// 11. Service worker registered and the shell cached
const swState = await page.evaluate(async () => {
  const reg = await navigator.serviceWorker.ready;
  const keys = await caches.keys();
  const cache = await caches.open(keys[0]);
  const hit = await cache.match('./engine/parse.js');
  return { active: Boolean(reg.active), keys, parseCached: Boolean(hit) };
});
ok(swState.active && swState.parseCached, 'service worker active, engine cached', JSON.stringify(swState));

// 12. Offline: the page still loads from the cache
await context.setOffline(true);
const page4 = await context.newPage();
await page4.goto(BASE, { waitUntil: 'load' });
ok(await page4.locator('#decode-btn').isVisible(), 'offline: page served from cache');
ok(await page4.locator('#offline-note').isVisible(), 'offline: note shown');
await page4.close();
await context.setOffline(false);

// 14. Files: a PDF upload reads the timetable (pdf.js from the CDN; needs internet the first time)
await page.setViewportSize({ width: 390, height: 844 });
await page.locator('#clear-btn').click();
await page.locator('#file-input').setInputFiles('examples/08-pdf-timetable.pdf');
await page.waitForFunction(() => document.querySelectorAll('#event-list .ev').length >= 5, null, { timeout: 60000 }).catch(() => {});
ok(await page.locator('#event-list .ev').count() === 5, 'pdf upload: 5 events from the timetable PDF', await page.locator('#file-status').innerText());
ok((await page.locator('#file-status').innerText()).startsWith('Read 08-pdf-timetable.pdf'), 'pdf upload: status names the file');
ok(await page.locator('#export-btn').isEnabled() === false && /Thursday|photo|check/i.test(await page.locator('#event-list').innerText()), 'pdf upload: amber (PDF source) keeps the review gate');

// 15. Share target with a FILE: the service worker parks the POSTed file and the page picks it up
const shared = await page.evaluate(async () => {
  const blob = await (await fetch('./samples.js')).blob(); // any same-origin bytes; we send the timetable as text/plain
  const text = 'Exam schedule:\n10 Nov 2026 - Maths - 10 AM to 1 PM - Room 1\n11 Nov 2026 - Physics - 10 AM to 1 PM - Room 1';
  const fd = new FormData();
  fd.append('title', 'Timetable');
  fd.append('file', new File([text], 'timetable.txt', { type: 'text/plain' }));
  const res = await fetch('./', { method: 'POST', body: fd, redirect: 'follow' });
  const cache = await caches.open('nd-share');
  const parked = await cache.match('./shared-file');
  return { status: res.status, url: res.url, parked: Boolean(parked), size: blob.size > 0 };
});
ok(shared.parked && shared.status === 200, 'share target file: service worker parked the POSTed file (303 followed to the shell)', JSON.stringify(shared));
await page.goto(`${BASE}?shared=file`, { waitUntil: 'networkidle' });
await page.waitForSelector('#event-list .ev', { timeout: 10000 }).catch(() => {});
ok(await page.locator('#event-list .ev').count() === 2, 'share target file: the parked text file was decoded on load');
ok(!page.url().includes('shared='), 'share target file: query removed');
const stillParked = await page.evaluate(async () => Boolean(await (await caches.open('nd-share')).match('./shared-file')));
ok(!stillParked, 'share target file: parked file deleted after use');

// 16. Photo OCR (tesseract.js; ~10 MB download on first run) only when OCR_CHECKS=1
if (process.env.OCR_CHECKS === '1') {
  await page.locator('#clear-btn').click();
  await page.locator('#file-input').setInputFiles('examples/07-photo-notice.png');
  await page.waitForFunction(() => /^(Read |Nothing readable|The text reader)/.test(document.querySelector('#file-status').innerText), null, { timeout: 240000 }).catch(() => {});
  console.log('   photo OCR status:', await page.locator('#file-status').innerText());
  console.log('   photo OCR text:', JSON.stringify((await page.locator('#notice-input').inputValue()).slice(0, 300)));
  const titles = await titlesOf();
  const got = (re) => titles.some((t) => re.test(t || ''));
  ok(titles.length >= 2 && got(/Internal Test/i) && (got(/Lab record/i) || got(/Guest lecture/i)), 'photo OCR: events read from the photographed notice', JSON.stringify(titles));
  ok(/photo/i.test(await page.locator('#event-list').innerText()), 'photo OCR: every event asks for a check against the picture');
  const libs = await page.evaluate(async () => (await (await caches.open('nd-libs-v1')).keys()).length);
  ok(libs >= 2, 'photo OCR: reader libraries cached for offline use', String(libs));
}

// 13. Desktop screenshot
await page.setViewportSize({ width: 1280, height: 900 });
await page.getByRole('button', { name: 'Exam day clash (PDF sample)' }).click();
await page.waitForSelector('#event-list .ev');
await page.screenshot({ path: 'tmp/shot-pdf-1280.png', fullPage: true });

ok(errors.length === 0, 'no console or page errors', errors.join(' | '));
console.log(`\n${pass} passed, ${fail} failed`);
await browser.close();
process.exit(fail ? 1 : 0);
