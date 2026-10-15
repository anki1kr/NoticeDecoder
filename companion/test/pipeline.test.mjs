// Run from companion/: npm test   (node, no phone needed). Covers everything that is not React Native.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { fromNotification, plan, hash, sharePayload, localDate, oneLine } from '../src/pipeline.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const repo = path.resolve(here, '../..');
const read = (f) => fs.readFileSync(path.join(repo, 'examples', f), 'utf8');
let passed = 0;
const test = (name, fn) => { fn(); passed++; console.log('ok -', name); };
const groups = ['III CSE A', 'Placement Cell 2027'];

test('only WhatsApp, only watched groups, sender prefix stripped, summaries skipped', () => {
  assert.deepEqual(fromNotification({ app: 'com.instagram.android', title: 'III CSE A', text: 'Test on 13 Nov at 10 AM in Room 1' }, groups), []);
  assert.deepEqual(fromNotification({ app: 'com.whatsapp', title: 'Family', text: 'Rahul: Test on 13 Nov at 10 AM in Room 1' }, groups), []);
  const m = fromNotification({ app: 'com.whatsapp', title: 'III CSE A', text: 'CR Rahul: Internal Test 2 on 13 Nov 2026 at 10 AM in Room 204.' }, groups);
  assert.equal(m.length, 1);
  assert.deepEqual([m[0].group, m[0].text], ['III CSE A', 'Internal Test 2 on 13 Nov 2026 at 10 AM in Room 204.']);
  assert.deepEqual(fromNotification({ app: 'com.whatsapp', title: 'III CSE A', text: '5 new messages' }, groups), []);
  assert.deepEqual(fromNotification({ app: 'com.whatsapp', title: 'III CSE A', text: 'ok' }, groups), []);
});

test('bigText beats text; "Sender @ Group" titles; grouped messages each become a notice', () => {
  const long = read('01-pdf-sample.txt').trim();
  const m = fromNotification({ app: 'com.whatsapp', title: 'Rahul @ III CSE A', text: 'All III-year CSE students: Internal Test 2 will be held on 13 Nov...', bigText: `Rahul: ${long}` }, groups);
  assert.equal(m[0].text, long);
  const g = fromNotification({ app: 'com.whatsapp', title: 'III CSE A', groupedMessages: [{ title: 'Rahul', text: 'Viva on 14 Nov 2026 at 2 PM in Lab 3.' }, { title: 'Priya', text: 'ok noted' }] }, groups);
  assert.deepEqual(g.map((x) => x.text), ['Viva on 14 Nov 2026 at 2 PM in Lab 3.']);
});

test('hash is stable and differs per group/text', () => {
  assert.equal(hash('a\nb'), hash('a\nb'));
  assert.notEqual(hash('III CSE A\nx'), hash('III CSE B\nx'));
});

test('plan: the PDF sample is all clean (3 entries, 2 clashes), the timetable parks exactly the Thursday/Friday row', () => {
  const p = plan(read('01-pdf-sample.txt'), new Date(2026, 9, 14, 9));
  assert.deepEqual([p.clean.length, p.amber.length, p.entries.length, p.clashes.length], [3, 0, 3, 2]);
  assert.equal(p.entries[0].uid, 'internal-test-2@notice-decoder');
  const t = plan(read('04-exam-timetable.txt'), new Date(2026, 9, 15, 9));
  assert.deepEqual([t.clean.length, t.amber.length], [4, 1]);
  assert.equal(t.amber[0].title, 'DBMS exam');
});

test('localDate keeps wall-clock time; sharePayload round-trips the parked events', () => {
  const d = localDate('2026-11-13T10:00:00');
  assert.deepEqual([d.getFullYear(), d.getMonth() + 1, d.getDate(), d.getHours(), d.getMinutes()], [2026, 11, 13, 10, 0]);
  const t = plan(read('04-exam-timetable.txt'), new Date(2026, 9, 15, 9));
  const b64 = sharePayload(t.amber);
  const back = JSON.parse(Buffer.from(b64.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8'));
  assert.deepEqual(back.e.map((e) => [e.t, e.d, e.s, e.e]), [['DBMS exam', '2026-11-13', '10:00', '13:00']]);
  assert.equal(oneLine(t.amber[0]), 'DBMS exam, 13 Nov 2026 10:00 AM-1:00 PM, Room 101');
});

console.log(`\n${passed} passed`);
