// Live smoke test after a deploy. No login needed. Checks the published app and, when configured, the class feed
// Worker end to end (create a throwaway class, publish the PS-02 sample, read the .ics back, cancel one event).
//   node tools/smoke-live.mjs                      # uses app/config.js FEED_BASE and the live app URL
//   APP_URL=https://... FEED_BASE=https://... node tools/smoke-live.mjs
//   node tools/smoke-live.mjs --ai                 # also one real AI check (Claude Haiku, well under $0.001; cached after that)
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const cfg = fs.readFileSync(path.join(root, 'app/config.js'), 'utf8');
const get = (n) => (cfg.match(new RegExp(`export const ${n} = '([^']*)'`)) || [])[1] || '';
const APP = (process.env.APP_URL || 'https://noticedecoder.pages.dev/app/').replace(/\/?$/, '/');
const FEED = (process.env.FEED_BASE || get('FEED_BASE')).replace(/\/+$/, '');
const rows = [];
const check = (name, ok, note = '') => { rows.push([ok ? 'PASS' : 'FAIL', name, note]); };
const fetchText = async (u, init) => { const r = await fetch(u, init); return { r, t: await r.text() }; };

// ---- the app
try {
  const { r, t } = await fetchText(APP);
  check('app page 200', r.status === 200, String(r.status));
  check('app page is Notice Decoder', /Notice Decoder/.test(t) && /gcal-all-btn/.test(t));
  for (const f of ['app.js', 'gcal.js', 'ocr.js', 'pdftext.js', 'docx.js', 'ai.js', 'sw.js', 'manifest.webmanifest', 'engine/parse.js', 'engine/ocrfix.js', 'icon-192.png']) {
    const x = await fetch(APP + f);
    check(`app/${f} 200`, x.status === 200, String(x.status));
  }
  const man = await (await fetch(APP + 'manifest.webmanifest')).json().catch(() => null);
  check('manifest share_target accepts files', Boolean(man?.share_target?.params?.files?.length), man ? man.share_target?.method : 'no manifest');
  const live = await (await fetch(APP + 'config.js')).text();
  const liveId = (live.match(/GOOGLE_CLIENT_ID = '([^']*)'/) || [])[1] || '';
  check('live GOOGLE_CLIENT_ID set (one-tap Google)', Boolean(liveId), liveId ? 'set' : 'empty: button shows the setup note');
  const liveFeed = (live.match(/FEED_BASE = '([^']*)'/) || [])[1] || '';
  check('live FEED_BASE set (class calendar)', Boolean(liveFeed), liveFeed || 'empty: class section hidden');
} catch (err) { check('app reachable', false, String(err.message)); }

// ---- the feed
if (!FEED) {
  check('class feed configured', false, 'FEED_BASE empty: deploy worker/ then node tools/configure.mjs --feed-base <url>');
} else {
  try {
    const h = await (await fetch(`${FEED}/health`)).json().catch(() => ({}));
    check('feed /health', h.ok === true, JSON.stringify(h));
    check('feed AI check configured', h.ai === true, h.ai ? 'ANTHROPIC_API_KEY set' : 'no key: npx wrangler secret put ANTHROPIC_API_KEY (in worker/)');
    // A month ahead, always: the clash report only counts what is still to come.
    const day = new Date(Date.now() + 30 * 86400000).toISOString().slice(0, 10);
    const sample = { title: 'Internal Test 2', type: 'test', typeLabel: 'Test', date: day, start: '10:00', end: '11:30', venue: 'Room 204' };
    const lecture = { title: 'Guest lecture: AI in Healthcare', type: 'lecture', typeLabel: 'Lecture', date: day, start: '11:00', end: '12:30', venue: 'Seminar Hall' };
    const c = await (await fetch(`${FEED}/api/class`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ name: `smoke ${new Date().toISOString().slice(0, 16)}` }) })).json();
    check('feed create class', Boolean(c.id && c.secret), c.id || JSON.stringify(c));
    const dry = await (await fetch(`${FEED}/api/class/${c.id}/publish?dry=1`, { method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${c.secret}` }, body: JSON.stringify({ events: [sample, lecture] }) })).json();
    check('feed dry run (preview) returns a plan', Array.isArray(dry.plan) && dry.plan.every((x) => x.action === 'add'), JSON.stringify(dry.plan?.map((x) => x.action)));
    const pub = await (await fetch(`${FEED}/api/class/${c.id}/publish`, { method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${c.secret}` }, body: JSON.stringify({ events: [sample, lecture] }) })).json();
    check('feed publish 2 events, 1 clash reported', pub.count === 2 && pub.clashes?.length === 1, JSON.stringify({ added: pub.added, clashes: pub.clashes?.length }));
    const ics = await (await fetch(`${FEED}/c/${c.id}.ics`)).text();
    check('feed .ics valid shape', ics.startsWith('BEGIN:VCALENDAR\r\n') && ics.endsWith('END:VCALENDAR\r\n') && /UID:internal-test-2@notice-decoder/.test(ics) && ics.split('\r\n').every((l) => Buffer.byteLength(l) <= 75));
    const page = await fetchText(`${FEED}/c/${c.id}`);
    check('feed subscribe page', page.r.status === 200 && /calendar\.google\.com/.test(page.t));
    const del = await (await fetch(`${FEED}/api/class/${c.id}/events/${encodeURIComponent('internal-test-2@notice-decoder')}`, { method: 'DELETE', headers: { authorization: `Bearer ${c.secret}` } })).json();
    const ics2 = await (await fetch(`${FEED}/c/${c.id}.ics?cb=${Date.now()}`)).text();
    check('feed cancel -> STATUS:CANCELLED', del.ok === true && /STATUS:CANCELLED/.test(ics2));
    const moved = await (await fetch(`${FEED}/api/class/${c.id}/events/${encodeURIComponent('guest-lecture-ai-in-healthcare@notice-decoder')}`, { method: 'PATCH', headers: { 'content-type': 'application/json', authorization: `Bearer ${c.secret}` }, body: JSON.stringify({ start: '14:00', end: '15:00' }) })).json();
    check('feed console edit (PATCH) keeps the UID', moved.ok === true && moved.event?.start === '14:00', JSON.stringify(moved).slice(0, 120));
    check('feed wrong secret refused', (await fetch(`${FEED}/api/class/${c.id}/publish`, { method: 'POST', headers: { 'content-type': 'application/json', authorization: 'Bearer nope' }, body: '{"events":[]}' })).status === 401);
    const gone = await fetch(`${FEED}/api/class/${c.id}`, { method: 'DELETE', headers: { authorization: `Bearer ${c.secret}` } });
    check('feed throwaway class deleted', gone.status === 200);
    if (process.argv.includes('--ai')) {
      const text = 'IIC Club invites you to the Smart Campus Innovation Challenge. Turn your ideas into practical innovations.\nDate: Wednesday, 28 October 2026\nTime: 2:20 PM\nVenue: Room 208';
      const t0 = Date.now();
      const r = await fetch(`${FEED}/api/ai/refine`, { method: 'POST', headers: { 'content-type': 'application/json', origin: 'https://noticedecoder.pages.dev' }, body: JSON.stringify({ text, events: [{ title: 'Practical', type: 'test', date: '2026-10-28', start: '14:20', venue: 'Room 208' }] }) });
      const j = await r.json().catch(() => ({}));
      check('AI check answers (Claude Haiku)', r.status === 200 && Array.isArray(j.events), `${r.status} ${Date.now() - t0} ms ${j.error || ''}`);
      check('AI check names the challenge', /Innovation Challenge/i.test(j.events?.[0]?.title || ''), `"${j.events?.[0]?.title}" ${j.events?.[0]?.type} cached=${j.cached} tokens in/out=${j.usage?.input}/${j.usage?.output}`);
      check('AI check refuses a foreign page', (await fetch(`${FEED}/api/ai/refine`, { method: 'POST', headers: { 'content-type': 'application/json', origin: 'https://evil.example' }, body: JSON.stringify({ text }) })).status === 403);
    }
  } catch (err) { check('feed reachable', false, String(err.message)); }
}

const width = Math.max(...rows.map((r) => r[1].length));
for (const [s, n, note] of rows) console.log(`${s}  ${n.padEnd(width)}  ${note}`);
const failed = rows.filter((r) => r[0] === 'FAIL').length;
console.log(`\n${rows.length - failed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
