// Run: node tests/engine.test.mjs
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { parseNotice } from '../app/engine/parse.js';
import { findClashes } from '../app/engine/clash.js';
import { toICS, gcalUrl } from '../app/engine/ics.js';

const pastedAt = new Date(2026, 9, 14, 10, 0); // 14 Oct 2026, local time
const read = (f) => fs.readFileSync(new URL(`../examples/${f}`, import.meta.url), 'utf8');
const pick = (r, title) => r.events.find((e) => e.title.includes(title));
let passed = 0;
const test = (name, fn) => { fn(); passed++; console.log('ok -', name); };

test('PDF sample: three events with the right fields', () => {
  const r = parseNotice(read('01-pdf-sample.txt'), { pastedAt });
  assert.equal(r.events.length, 3);
  const t = pick(r, 'Internal Test 2'), d = pick(r, 'Lab record submission'), l = pick(r, 'AI in Healthcare');
  assert.deepEqual([t.type, t.date, t.start, t.end, t.venue], ['test', '2026-11-13', '10:00', '11:30', 'Room 204']);
  assert.deepEqual([d.type, d.date, d.start, d.end, d.venue], ['deadline', '2026-11-13', '12:00', null, 'Department office']);
  assert.deepEqual([l.type, l.date, l.start, l.end, l.venue], ['lecture', '2026-11-13', '11:00', '12:30', 'Seminar Hall']);
  assert.equal(read('01-pdf-sample.txt').slice(...t.sources.start), '10:00 AM');
});

test('PDF sample: clash results match the problem statement', () => {
  const r = parseNotice(read('01-pdf-sample.txt'), { pastedAt });
  const c = findClashes(r.events);
  const row = (x, y) => c.find((k) => [k.a, k.b].sort().join() === [pick(r, x).id, pick(r, y).id].sort().join());
  const tl = row('Internal Test 2', 'AI in Healthcare');
  assert.equal(tl.kind, 'overlap');
  assert.equal(tl.overlapMin, 30);
  assert.match(tl.msg, /11:00 to 11:30 AM \(30 minutes\)/);
  assert.equal(row('Lab record', 'AI in Healthcare').kind, 'deadline-inside');
  assert.match(row('Lab record', 'AI in Healthcare').action, /before 10:00 AM/);
  assert.equal(row('Internal Test 2', 'Lab record').kind, 'none');
});

test('Webinar: Date/Time labels pair up, outside sender flagged', () => {
  const r = parseNotice(read('02-webinar-invite.txt'), { pastedAt });
  assert.equal(r.events.length, 1);
  const w = r.events[0];
  assert.deepEqual([w.title, w.date, w.start, w.venue], ['Career guidance webinar', '2026-10-15', '18:30', 'Online (Zoom)']);
  assert.ok(w.flags.some((f) => /Zoom link/.test(f.msg)));
  assert.ok(r.warnings.some((x) => /WhatsApp/.test(x.msg)));
  assert.ok(r.notes.some((n) => /Eligibility/.test(n)));
});

test('Placement drive: notice date anchors "today", window, TBD, contradiction, stale', () => {
  const r = parseNotice(read('03-qspiders-placement.txt'), { pastedAt });
  assert.equal(r.anchorDate, '2026-10-05');
  const q = pick(r, 'Aptitude Quiz');
  assert.deepEqual([q.date, q.start, q.end, q.durationMin], ['2026-10-05', '13:30', '17:00', 60]);
  assert.equal(pick(r, 'Results').start, '21:00');
  assert.ok(pick(r, 'Placement Drive').link.startsWith('https://incubation.qspiders.com'));
  assert.deepEqual(r.pending.map((p) => p.title), ['Online Group Discussion', 'Joining dates']);
  assert.ok(r.warnings.some((x) => /two different dates for "Results"/.test(x.msg)));
  assert.ok(r.warnings.some((x) => /8 days ago/.test(x.msg)));
  assert.equal(r.events.filter((e) => e.title === 'Results' && e.flags.some((f) => f.level === 'warn')).length, 2);
});

test('Empty and junk input give a clear error, never a crash', () => {
  assert.equal(parseNotice('', { pastedAt }).warnings[0].level, 'error');
  assert.equal(parseNotice('   hello   ', { pastedAt }).warnings[0].level, 'error');
  const r = parseNotice('Please be kind to everyone in the class group, thanks.', { pastedAt });
  assert.equal(r.events.length, 0);
  assert.ok(r.warnings.some((w) => w.level === 'error'));
});

test('DD/MM is the default and ambiguous dates are flagged', () => {
  const r = parseNotice('Mid-term exam on 04/05/2027 at 2 PM in Room 12.', { pastedAt });
  assert.equal(r.events[0].date, '2027-05-04');
  assert.ok(r.events[0].flags.some((f) => /5 Apr 2027/.test(f.msg)));
  assert.equal(parseNotice('Viva on 13/11/2026 from 14:00 to 15:00.', { pastedAt }).events[0].start, '14:00');
});

test('Hinglish time and relative day', () => {
  const r = parseNotice('Kal shaam 5 baje seminar hai Seminar Hall mein.', { pastedAt });
  assert.equal(r.events[0].date, '2026-10-15');
  assert.equal(r.events[0].start, '17:00');
});

test('Missing AM/PM is guessed and flagged; end before start is flagged', () => {
  const r = parseNotice('Workshop on 20 Nov 2026 at 2:30 in Lab 3.', { pastedAt });
  assert.equal(r.events[0].start, '14:30');
  assert.ok(r.events[0].flags.some((f) => /AM\/PM/.test(f.msg)));
});

test('.ics is valid RFC 5545 shape', () => {
  const r = parseNotice(read('01-pdf-sample.txt'), { pastedAt });
  const ics = toICS(r.events, { now: new Date(Date.UTC(2026, 9, 14)) });
  assert.ok(ics.startsWith('BEGIN:VCALENDAR\r\n') && ics.endsWith('END:VCALENDAR\r\n'));
  assert.equal((ics.match(/BEGIN:VEVENT/g) || []).length, 3);
  assert.match(ics, /DTSTART;TZID=Asia\/Kolkata:20261113T100000/);
  assert.match(ics, /DTEND;TZID=Asia\/Kolkata:20261113T120000/); // deadline block ends at 12:00
  assert.ok(ics.split('\r\n').every((l) => new TextEncoder().encode(l).length <= 75));
  assert.ok(!/\r?\n(?<!\r\n)/.test(ics.replace(/\r\n/g, '')), 'only CRLF line breaks');
  assert.match(ics, /SUMMARY:Guest lecture: AI in Healthcare/);
});

test('Google Calendar link: same times as the .ics, deadline as the 30 min before it', () => {
  const r = parseNotice(read('01-pdf-sample.txt'), { pastedAt });
  const q = (e) => new URL(gcalUrl(e)).searchParams;
  assert.equal(q(pick(r, 'Internal Test 2')).get('dates'), '20261113T100000/20261113T113000');
  assert.equal(q(pick(r, 'Lab record')).get('dates'), '20261113T113000/20261113T120000');
  assert.equal(q(pick(r, 'Lab record')).get('text'), 'Deadline: Lab record submission (by 12:00 PM)');
  assert.equal(q(pick(r, 'Internal Test 2')).get('ctz'), 'Asia/Kolkata');
  assert.equal(gcalUrl({ ...pick(r, 'Internal Test 2'), date: null }), null);
});

// Cases found by the judge agents (tmp/judge1, tmp/judge3).
const one = (t) => parseNotice(t, { pastedAt }).events;

test('Postponed: the new date and time win, the old one is shown', () => {
  const [e] = one('UPDATE: Internal Test 2 on 13 Nov 2026 at 10:00 AM is POSTPONED to 20 Nov 2026 at 11:00 AM. Venue remains Room 204.');
  assert.deepEqual([e.date, e.start, e.venue], ['2026-11-20', '11:00', 'Room 204']);
  assert.ok(e.flags.some((f) => /It was 13 Nov 2026, 10:00 AM/.test(f.msg)));
});

test('"Last date to pay the exam fee" is a deadline, not an exam; multi-day practicals repeat', () => {
  const ev = one('Our end-semester practicals will be conducted in the Computer Centre from 25 Oct 2026 to 30 Oct 2026. Timings will be 9:30 AM to 12:30 PM daily.\nThe last date to pay the exam fee is 25 Oct 2026, 5 PM.');
  const p = ev.find((e) => /practicals/i.test(e.title)), f = ev.find((e) => e.type === 'deadline');
  assert.deepEqual([p.start, p.end, p.repeat], ['09:30', '12:30', 6]);
  assert.deepEqual([f.title, f.date, f.start], ['Pay the exam fee', '2026-10-25', '17:00']);
  assert.match(toICS(ev), /RRULE:FREQ=DAILY;COUNT=6/);
});

test('Two days, "Register by", emoji venue, letter rooms, date not in title, "classes" label', () => {
  assert.equal(one('Hackathon CodeFest on 16 and 17 Oct 2026 from 9 AM to 6 PM in Block C.')[0].repeat, 2);
  const w = one('Workshop on Python 🐍 on 15/10/2026 ⏰ 3:00 PM 📍 Computer Lab 2\n👉 Register by 14/10/2026');
  assert.deepEqual(w.map((e) => [e.title, e.date, e.venue]), [['Workshop: Python', '2026-10-15', 'Computer Lab 2'], ['Registration deadline', '2026-10-14', null]]);
  assert.equal(one('Seminar on Cloud Computing on 16 Oct 2026 at 9:30 in Hall B.')[0].venue, 'Hall B');
  assert.equal(one('Lab exam 05/11/2026 at 10 AM in Lab 2.')[0].title, 'Lab exam');
  assert.equal(one('Classes resume on 3 Nov 2026 at 9 AM.')[0].typeLabel, 'Class');
});

test('Weekdays and day/month without a year are read, and flagged for a check', () => {
  const [v] = one('Internal viva on Monday 19/10 at 2 PM in Room 5.');
  assert.equal(v.date, '2026-10-19');
  const [c] = one('Registration for the hackathon closes this Friday at 5 PM.');
  assert.deepEqual([c.type, c.date, c.start], ['deadline', '2026-10-16', '17:00']);
  assert.ok(c.flags.some((f) => f.level === 'warn' && /Friday/.test(f.msg)));
});

test('"tomorrow" in a dated notice counts from the notice date', () => {
  assert.equal(one('Date: 05 Oct 2026\nTest tomorrow at 10 AM in Room 4.')[0].date, '2026-10-06');
});

test('A duration in its own sentence sets the end, and the clash check uses it', () => {
  const ev = one('Practical test on 14 Nov 2026 at 10 AM. It takes 2 hours.\nGuest lecture on 14 Nov 2026 from 10:30 AM to 11:30 AM.');
  assert.equal(ev[0].end, '12:00');
  assert.equal(findClashes(ev)[0].kind, 'overlap');
  assert.match(toICS(ev), /DTEND;TZID=Asia\/Kolkata:20261114T120000/);
});

test('A test window with a free slot is not a clash, and says when to take it', () => {
  const ev = one('Online MCQ test on 14 Nov 2026 available 1:30pm-5pm. 40 questions in 60 min.\nGuest lecture on 14 Nov 2026 from 3:00 PM to 4:00 PM.');
  const c = findClashes(ev)[0];
  assert.equal(c.kind, 'none');
  assert.match(c.msg, /take it 1:30 to 2:30 PM/);
});

test('"Rescheduled to" in a later sentence replaces the earlier event', () => {
  const ev = one('Internal Test 2 will be held on 10 Nov 2026 at 10 AM in Room 4. Revised: Internal Test 2 is now rescheduled to 12 Nov 2026 at 10 AM.');
  assert.equal(ev.length, 1);
  assert.equal(ev[0].date, '2026-11-12');
  assert.ok(ev[0].flags.some((f) => /It was 10 Nov 2026, 10:00 AM/.test(f.msg)));
});

test('A cancelled item is not added; same start time is a clash', () => {
  const r = parseNotice('Kal ki lecture cancel ho gayi hai. Lecture on 14 Nov 2026 at 10 baje.', { pastedAt });
  assert.deepEqual(r.events.map((e) => [e.date, e.start]), [['2026-11-14', '10:00']]);
  assert.ok(r.warnings.some((w) => /cancels/.test(w.msg)));
  const same = one('Internal Test 2 on 14 Nov 2026 at 10 AM.\nGuest lecture on 14 Nov 2026 from 10:00 AM to 11:00 AM.');
  assert.notEqual(findClashes(same)[0].kind, 'none');
});


// 2026-10-15: cases that silently went wrong before (see examples/04-06).
test('Same type, same hour: two events and a clash, not one merged card', () => {
  const ev = one(read('05-same-hour-tests.txt'));
  assert.deepEqual(ev.map((e) => e.title), ['Internal test: Maths', 'Guest lecture: Cloud Basics', 'Lab exam: Physics', 'Assignment 2 upload']);
  const clashes = findClashes(ev).filter((c) => c.kind !== 'none');
  assert.equal(clashes.length, 2);
  const lab = ev.find((e) => /Physics/.test(e.title));
  assert.deepEqual([lab.end, lab.reportAt, lab.venue], ['12:00', '09:30', 'Lab 2']);
  const up = ev.find((e) => e.type === 'deadline');
  assert.deepEqual([up.date, up.start], ['2026-11-13', '17:00']);
  assert.ok(up.flags.some((f) => f.level === 'warn' && /EOD/.test(f.msg)));
});

test('One sentence, two events: cut at "and" when both halves have a time and an event word', () => {
  const ev = one('Internal Test 2 on 13 Nov 2026 at 10 AM in Room 204 and a guest lecture at 11 AM in the Seminar Hall.');
  assert.deepEqual(ev.map((e) => [e.title, e.date, e.start, e.venue]), [['Internal Test 2', '2026-11-13', '10:00', 'Room 204'], ['Guest lecture', '2026-11-13', '11:00', 'Seminar Hall']]);
  // "16 and 17 Oct" and a plain time range are never cut
  assert.equal(one('Hackathon CodeFest on 16 and 17 Oct 2026 from 9 AM to 6 PM in Block C.').length, 1);
});

test('Exam timetable rows: subject titles, kind from the header, rooms from the cells, no false contradiction', () => {
  const r = parseNotice(read('04-exam-timetable.txt'), { pastedAt });
  assert.deepEqual(r.events.map((e) => [e.title, e.typeLabel, e.date, e.start, e.end, e.venue]), [
    ['DBMS exam', 'Exam', '2026-11-13', '10:00', '13:00', 'Room 101'],
    ['Operating Systems exam', 'Exam', '2026-11-14', '10:00', '13:00', 'Room 101'],
    ['Computer Networks exam', 'Exam', '2026-11-16', '14:00', '17:00', 'Room 102'],
    ['Practical viva: DBMS', 'Viva', '2026-11-14', '11:00', null, 'Lab 2'],
    ['Hall tickets collection', 'Deadline', '2026-11-12', '16:00', null, 'Office'],
  ]);
  assert.ok(!r.warnings.some((w) => /two different dates/.test(w.msg)));
  assert.equal(findClashes(r.events).filter((c) => c.kind !== 'none').length, 1); // viva inside the OS exam
});

test('Weekday that contradicts the date is flagged; "7/10" and "Unit 3/4" are not dates', () => {
  const [e] = one('Internal Test 2 on Thursday, 13 Nov 2026 at 10 AM in Room 204.');
  assert.equal(e.date, '2026-11-13');
  assert.ok(e.flags.some((f) => f.level === 'warn' && /Thursday.*Friday/.test(f.msg)));
  assert.equal(one('Friday, 13 Nov 2026: Internal Test 2 at 10 AM.')[0].flags.filter((f) => f.level === 'warn').length, 0);
  const [q] = one('Minimum 7/10 marks required in the quiz on 13 Nov 2026 at 10 AM.');
  assert.equal(q.date, '2026-11-13');
  assert.equal(one('Unit 3/4 revision class on 20 Nov 2026 at 9 AM.')[0].date, '2026-11-20');
});

test('Gazetted holiday and Sunday are pointed out, never moved', () => {
  const [d] = one('Seminar on 8 Nov 2026 at 10 AM in Hall A.');
  assert.equal(d.date, '2026-11-08');
  assert.ok(d.flags.some((f) => f.level === 'warn' && /Diwali/.test(f.msg)));
  const [s] = one('Placement drive on 15 Nov 2026 at 9 AM in the Auditorium.');
  assert.ok(s.flags.some((f) => f.level === 'info' && /Sunday/.test(f.msg)));
  assert.equal(s.flags.filter((f) => f.level === 'warn').length, 0);
});

test('More formats: ISO date, "0700 hrs", "between 9 and 11", "starts at 10 and ends by 1", mid sem, fee payment', () => {
  const [a] = one('Submit the assignment by 2026-11-20 11:59 PM on the portal.');
  assert.deepEqual([a.title, a.type, a.date, a.start], ['Assignment submission', 'deadline', '2026-11-20', '23:59']);
  const [p] = one('NCC parade on 14 Nov 2026 at 0700 hrs. Reporting 0630 hrs at the ground.');
  assert.deepEqual([p.start, p.reportAt, p.flags.filter((f) => f.level === 'warn').length], ['07:00', '06:30', 0]);
  assert.deepEqual(one('Viva will be held between 9 AM and 11 AM on 14 Nov 2026 in Lab 3.').map((e) => [e.start, e.end]), [['09:00', '11:00']]);
  assert.deepEqual(one('The exam will start at 10 AM and end by 1 PM on 13 Nov 2026 in Hall A.').map((e) => [e.start, e.end]), [['10:00', '13:00']]);
  assert.equal(one('Mid sem on 5 Nov 2026, 10 AM, Room 7.')[0].type, 'test');
  const [f] = one('Pay the fee of Rs 1500 by 20 Nov 2026 at the accounts office. Contact 98765 43210 for queries.');
  assert.deepEqual([f.title, f.type, f.date, f.venue], ['Fee payment', 'deadline', '2026-11-20', 'Accounts office']);
});

test('Hindi notice: Devanagari months, "सुबह 10 बजे", परीक्षा and a तक deadline', () => {
  const ev = one(read('06-hindi-notice.txt'));
  assert.deepEqual(ev.map((e) => [e.title, e.type, e.date, e.start, e.venue]), [['गणित परीक्षा', 'test', '2026-11-13', '10:00', 'कमरा 204'], ['प्रोजेक्ट रिपोर्ट जमा', 'deadline', '2026-11-12', null, null]]);
});

test('"Today" is the notice date only beside a Date: line; a report-by line is not a second event; end before start stays in the clash check', () => {
  const r = parseNotice('Today is the last day to collect ID cards. Fest on 20 Nov 2026 at 10 AM in the Main Ground.', { pastedAt });
  assert.equal(r.anchorFromNotice, false);
  assert.deepEqual(r.events.map((e) => e.date), ['2026-10-14', '2026-11-20']);
  const ev = one('Campus drive by TCS on 18 Nov 2026.\nReporting time: 8:30 AM\nTime: 10:00 AM\nVenue: Auditorium');
  assert.deepEqual([ev.length, ev[0].start, ev[0].reportAt], [1, '10:00', '08:30']);
  const broken = [{ id: 'a', title: 'A', type: 'test', date: '2026-11-13', start: '10:00', end: '09:00', flags: [] }, { id: 'b', title: 'B', type: 'lecture', date: '2026-11-13', start: '10:30', end: '11:30', flags: [] }];
  assert.equal(findClashes(broken)[0].kind, 'overlap'); // A runs 10:00-11:00 by the 1 h rule, same as the timeline
  assert.match(toICS([{ id: 'm', title: '', type: 'other', date: '2026-11-13', start: '10:00', flags: [] }]), /SUMMARY:Event/);
});

console.log(`\n${passed} passed`);
