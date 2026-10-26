// Run: node tests/fuzz.test.mjs   (seeded, so a failure reproduces: FUZZ_SEED=123 FUZZ_N=5000 node tests/fuzz.test.mjs)
// What a user can throw at the engine: random mixes of real notice fragments, junk, emoji, Devanagari, HTML, huge pastes.
// The engine must never throw, never hang, and never hand the calendar a date or a time that does not exist.
import assert from 'node:assert/strict';
import { parseNotice } from '../app/engine/parse.js';
import { findClashes } from '../app/engine/clash.js';
import { toICS, calendarEntries, gcalUrl } from '../app/engine/ics.js';
import { fixOcrText } from '../app/engine/ocrfix.js';

const SEED = Number(process.env.FUZZ_SEED || 20261026);
const N = Number(process.env.FUZZ_N || 1500);
let s = SEED;
const rnd = () => ((s = (s * 1103515245 + 12345) % 2147483648) / 2147483648);
const pick = (a) => a[Math.floor(rnd() * a.length)];

const FRAGMENTS = [
  'Internal Test 2', 'Lab record submission', 'Guest lecture', 'Placement drive', 'Hackathon', 'Viva', 'Practical', 'Quiz', 'Seminar',
  'on 13 Nov 2026', '13/11/2026', '04/05/2027', '31 Feb 2026', '29 Feb 2027', '32/13/2026', '2026-11-20', 'Nov 13', '13th of November',
  'at 10 AM', '10:00 AM to 11:30 AM', '25:00', '12:60 PM', '0700 hrs', 'by EOD', 'by 12 noon', 'FN', 'AN', 'between 9 and 11',
  'in Room 204', 'Seminar Hall', 'Lab 3', 'LT-2', 'Venue: Auditorium', 'Date: 15 Oct', 'Time: 6:30 PM', 'Reporting time: 8 AM',
  'today', 'tomorrow', 'kal shaam 5 baje', 'next Monday', 'every Monday and Wednesday 4-5 PM', 'from 25 Oct to 30 Oct', '1-2 Nov',
  'postponed to 20 Nov at 11 AM', 'cancelled', 'no classes on 14 Nov', 'will be announced', 'https://meet.google.com/abc-defg-hij',
  'chat.whatsapp.com/INVITE', '१३ नवंबर २०२६', 'गणित की परीक्षा', 'सुबह 10 बजे', 'कमरा 204', '🚀', '📅', '⏰', '​', '‮',
  '<img src=x onerror=alert(1)>', '"quoted topic"', ';', ',', '.', '!', '\n', '\n\n', '\t', ' - ', ' | ', '75/100', 'Unit 3/4',
  'Deadline extended from 15/11/2026 to 22/11/2026 5 PM', 'Mr. Sharma', 'MST-2', 'CIE-1', '1O:OO AM', 'l3 Nov', 'Thrusday', 'Sepetmber',
];
const JUNK = () => Array.from({ length: 1 + Math.floor(rnd() * 30) }, () => String.fromCharCode(32 + Math.floor(rnd() * 0x2000))).join('');

const DATE = /^\d{4}-\d{2}-\d{2}$/;
const TIME = /^([01]\d|2[0-3]):[0-5]\d$/;
const realDate = (d) => { const [y, m, day] = d.split('-').map(Number); const t = new Date(Date.UTC(y, m - 1, day)); return t.getUTCFullYear() === y && t.getUTCMonth() === m - 1 && t.getUTCDate() === day; };
const TYPES = new Set(['test', 'deadline', 'lecture', 'other']);

function check(text, label) {
  let r;
  const t0 = performance.now();
  try { r = parseNotice(text, { pastedAt: new Date(2026, 9, 26, 10) }); } catch (err) { assert.fail(`${label}: parseNotice threw ${err.stack}\n--- input ---\n${JSON.stringify(text).slice(0, 400)}`); }
  const ms = performance.now() - t0;
  for (const e of r.events) {
    assert.ok(typeof e.title === 'string' && e.title.trim(), `${label}: empty title`);
    assert.ok(TYPES.has(e.type), `${label}: bad type ${e.type}`);
    if (e.date !== null) assert.ok(DATE.test(e.date) && realDate(e.date), `${label}: bad date ${e.date} in ${JSON.stringify(text).slice(0, 200)}`);
    for (const f of ['start', 'end', 'reportAt']) if (e[f] != null) assert.ok(TIME.test(e[f]), `${label}: bad ${f} ${e[f]}`);
    for (const [f, range] of Object.entries(e.sources || {})) {
      assert.ok(Array.isArray(range) && range[0] >= 0 && range[1] <= r.text.length && range[0] <= range[1], `${label}: source ${f} out of range ${range}`);
    }
  }
  try {
    findClashes(r.events);
    const ics = toICS(r.events, { now: new Date(2026, 9, 26) });
    assert.ok(ics.startsWith('BEGIN:VCALENDAR\r\n') && ics.endsWith('END:VCALENDAR\r\n'), `${label}: ics frame`);
    assert.ok(ics.split('\r\n').every((l) => new TextEncoder().encode(l).length <= 75), `${label}: an ics line is longer than 75 octets`);
    assert.equal((ics.match(/BEGIN:VEVENT/g) || []).length, calendarEntries(r.events).length);
    for (const e of r.events) if (e.date) assert.ok(gcalUrl(e).startsWith('https://calendar.google.com/'));
  } catch (err) { assert.fail(`${label}: calendar step failed ${err.stack}\n--- input ---\n${JSON.stringify(text).slice(0, 400)}`); }
  return ms;
}

let worst = 0;
for (let i = 0; i < N; i++) {
  const parts = Array.from({ length: 1 + Math.floor(rnd() * 25) }, () => (rnd() < 0.12 ? JUNK() : pick(FRAGMENTS)));
  const text = parts.join(pick([' ', ' ', '', '\n', '. ', ', ']));
  worst = Math.max(worst, check(text, `case ${i}`));
}
console.log(`ok - ${N} random notices: no throw, real dates and times only, sources in range, valid .ics (slowest ${worst.toFixed(1)} ms)`);
assert.ok(worst < 500, `a short notice took ${worst} ms`);

// Things a user really does: paste nothing, paste a whole PDF, paste the same thing 500 times, a line with no spaces.
for (const [name, value] of [['null', null], ['undefined', undefined], ['number', 42], ['object', { a: 1 }], ['spaces', '   \n\t  '], ['14 chars', 'Test on 13 Nov'], ['emoji only', '🚀🤖📅⏰📍'.repeat(20)]]) {
  const r = parseNotice(value, { pastedAt: new Date(2026, 9, 26) });
  assert.ok(Array.isArray(r.events) && r.events.length === 0, `${name}: no events`);
}
console.log('ok - empty, short, emoji-only and non-string input: no events, no throw');

const PATHOLOGICAL = {
  'one 200 KB notice': (read('01')).repeat(1),
  'same notice pasted 400 times': 'Internal Test 2 on 13 Nov 2026 at 10 AM in Room 204. '.repeat(400),
  '100k chars, no spaces': 'a'.repeat(100000),
  '50k digits and slashes': '1/1/1 '.repeat(8000),
  'room room room': 'in Room Room Room '.repeat(5000),
  '20k newlines': '\n'.repeat(20000) + 'Test on 13 Nov 2026 at 10 AM',
  'label lines forever': 'Date: 13 Nov 2026\nTime: 10 AM\n'.repeat(1500),
  'dots and capitals': 'A. B. C. D. '.repeat(10000),
};
function read() {
  const base = 'Dear students, Internal Test 2 on 13 Nov 2026 from 10:00 AM to 11:30 AM in Room 204. Lab record must be submitted by 12 noon. ';
  return base.repeat(Math.ceil(200000 / base.length));
}
for (const [name, text] of Object.entries(PATHOLOGICAL)) {
  const ms = check(text, name);
  console.log(`ok - ${name} (${text.length} chars): ${ms.toFixed(0)} ms`);
  assert.ok(ms < 8000, `${name} took ${ms} ms`);
}

// The clash check and the calendar writers get events straight from edits, share links and the class feed, not only
// from the parser: any mix of missing ends, points, windows, durations and multi-day runs must work.
const hm = () => `${String(Math.floor(rnd() * 24)).padStart(2, '0')}:${pick(['00', '15', '30', '45', '59'])}`;
for (let i = 0; i < 4000; i++) {
  const events = Array.from({ length: 2 + Math.floor(rnd() * 6) }, (_, k) => ({
    id: `x${k}`, title: pick(['Test', 'Lecture', 'Form submission', 'गणित की परीक्षा', 'Quiz', '']), type: pick(['test', 'deadline', 'lecture', 'other']),
    typeLabel: pick(['Test', 'Deadline', 'Lecture', 'Event', 'Practicals', undefined]), date: pick(['2026-11-13', '2026-11-14']),
    start: rnd() < 0.9 ? hm() : null, end: rnd() < 0.5 ? hm() : null, durationMin: rnd() < 0.3 ? pick([30, 60, 90, 180]) : null,
    point: rnd() < 0.15, window: rnd() < 0.15, repeat: rnd() < 0.2 ? pick([2, 3, 6]) : null, every: rnd() < 0.1 ? 'MO,WE' : null,
  }));
  try {
    for (const c of findClashes(events)) assert.ok(typeof c.msg === 'string' && c.msg.length, 'clash row without a message');
    const ics = toICS(events, { now: new Date(2026, 9, 26) });
    assert.ok(ics.split('\r\n').every((l) => new TextEncoder().encode(l).length <= 75));
    assert.equal(new Set(calendarEntries(events).map((e) => e.uid)).size, calendarEntries(events).length, 'two events share a UID');
  } catch (err) { assert.fail(`event list ${i}: ${err.stack}\n${JSON.stringify(events)}`); }
}
console.log('ok - 4000 random event lists through the clash check and the calendar writers');

// OCR cleanup runs before the rules on every photo; it must not throw or blow up either.
for (let i = 0; i < 300; i++) {
  const text = Array.from({ length: 1 + Math.floor(rnd() * 20) }, () => (rnd() < 0.3 ? JUNK() : pick(FRAGMENTS))).join(pick([' ', '\n', ' | ']));
  const out = fixOcrText(text);
  assert.equal(typeof out, 'string');
  check(out, `ocr case ${i}`);
}
console.log('ok - 300 OCR-cleaned random texts');
console.log('\nfuzz passed');
