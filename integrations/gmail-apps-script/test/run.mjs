// Runs Code.gs against fake Apps Script services. Run from the repo root:
//   node tools/bundle-engine.mjs && node integrations/gmail-apps-script/test/run.mjs
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '../../..');
const read = (p) => fs.readFileSync(path.join(root, p), 'utf8');

// ---- fakes ----
const labels = new Map();
const sent = [];
const logs = [];
let triggers = [];
const calEvents = [];
let nextId = 1;

class FakeEvent {
  constructor(title, start, end, opts, allDay) { this.id = nextId++; this.title = title; this.start = start; this.end = end; this.allDay = allDay; this.location = opts.location || ''; this.description = opts.description || ''; this.tags = {}; this.reminders = []; }
  setTag(k, v) { this.tags[k] = v; return this; }
  getTag(k) { return this.tags[k]; }
  setTime(s, e) { this.start = s; this.end = e; this.allDay = false; return this; }
  setAllDayDate(d) { this.start = d; this.end = d; this.allDay = true; return this; }
  setTitle(t) { this.title = t; return this; }
  setDescription(d) { this.description = d; return this; }
  setLocation(l) { this.location = l; return this; }
  removeAllReminders() { this.reminders = []; return this; }
  addPopupReminder(m) { this.reminders.push(m); return this; }
}
const calendar = {
  createEvent: (t, s, e, o = {}) => { const ev = new FakeEvent(t, s, e, o, false); calEvents.push(ev); return ev; },
  createAllDayEvent: (t, d, o = {}) => { const ev = new FakeEvent(t, d, d, o, true); calEvents.push(ev); return ev; },
  getEvents: (from, to) => calEvents.filter((ev) => ev.start >= from && ev.start <= to),
};
class FakeThread {
  constructor(subject, body, date) { this.subject = subject; this.body = body; this.date = date; this.labels = new Set(); }
  getMessages() { return [{ getSubject: () => this.subject, getPlainBody: () => this.body, getDate: () => this.date }]; }
  addLabel(l) { this.labels.add(l.name); }
}
let inbox = [];
const sandbox = {
  console,
  GmailApp: {
    getUserLabelByName: (n) => labels.get(n) || null,
    createLabel: (n) => { const l = { name: n }; labels.set(n, l); return l; },
    search: (q, start, max) => inbox.filter((t) => !t.labels.has('nd-done')).slice(start, start + max),
  },
  CalendarApp: { getDefaultCalendar: () => calendar, getCalendarsByName: () => [calendar], createCalendar: () => calendar },
  MailApp: { sendEmail: (to, subject, body) => sent.push({ to, subject, body }) },
  Session: { getActiveUser: () => ({ getEmail: () => 'student@example.com' }) },
  ScriptApp: {
    getProjectTriggers: () => triggers,
    deleteTrigger: (t) => { triggers = triggers.filter((x) => x !== t); },
    newTrigger: (fn) => ({ timeBased: () => ({ everyMinutes: () => ({ create: () => { const t = { getHandlerFunction: () => fn }; triggers.push(t); return t; } }) }) }),
  },
  Utilities: {
    formatDate: (d) => d.toISOString().slice(0, 10),
    newBlob: (s) => ({ getBytes: () => [...Buffer.from(s, 'utf8')] }),
    base64EncodeWebSafe: (bytes) => Buffer.from(bytes).toString('base64').replace(/\+/g, '-').replace(/\//g, '_'),
  },
  Logger: { log: (m) => logs.push(String(m)) },
};
// Apps Script V8 has no TextEncoder: make sure the bundle copes without it.
sandbox.TextEncoder = undefined;
vm.createContext(sandbox);
vm.runInContext(read('dist/notice-engine.js'), sandbox, { filename: 'notice-engine.js' });
vm.runInContext(read('integrations/gmail-apps-script/Code.gs'), sandbox, { filename: 'Code.gs' });
const call = (fn, ...args) => vm.runInContext(fn, sandbox)(...args);

let passed = 0;
const test = (name, fn) => { fn(); passed++; console.log('ok -', name); };

test('bundle works in a context without TextEncoder and matches the ES module engine', () => {
  const ics = call('NoticeEngine.toICS', [{ title: 'Internal Test 2', type: 'test', date: '2026-11-13', start: '10:00', end: '11:30' }]);
  assert.match(ics, /DTSTART;TZID=Asia\/Kolkata:20261113T100000/);
  assert.ok(ics.split('\r\n').every((l) => Buffer.byteLength(l) <= 75));
});

test('install: labels + one trigger, idempotent', () => {
  call('install'); call('install');
  assert.ok(labels.has('nd-done') && labels.has('nd-check'));
  assert.equal(triggers.length, 1);
});

test('clean notice (PS-02 sample): 3 events created, tagged with UIDs, reminders by type, labelled nd-done', () => {
  inbox = [new FakeThread('Internal Test 2 schedule', read('examples/01-pdf-sample.txt'), new Date(2026, 9, 14, 9, 0))];
  const s = call('processNotices');
  assert.deepEqual([s.threads, s.added, s.updated, s.check], [1, 3, 0, 0]);
  assert.equal(calEvents.length, 3);
  const t = calEvents.find((e) => e.tags['nd-uid'] === 'internal-test-2@notice-decoder');
  assert.deepEqual([t.start.getHours(), t.start.getMinutes(), t.end.getHours(), t.end.getMinutes(), t.location, t.reminders], [10, 0, 11, 30, 'Room 204', [1440]]);
  const d = calEvents.find((e) => /^Deadline:/.test(e.title));
  assert.deepEqual([d.start.getHours(), d.start.getMinutes(), d.end.getHours(), d.reminders], [11, 30, 12, [180]]);
  assert.ok(inbox[0].labels.has('nd-done') && !inbox[0].labels.has('nd-check'));
  assert.equal(sent.length, 0);
});

test('the same mail is not read twice; a revised notice updates the event instead of adding one', () => {
  assert.equal(call('processNotices').threads, 0);
  inbox = [new FakeThread('Revised', 'UPDATE: Internal Test 2 on 13 Nov 2026 at 10:00 AM is POSTPONED to 20 Nov 2026 at 11:00 AM. Venue remains Room 204.', new Date(2026, 9, 15, 9, 0))];
  const s = call('processNotices');
  assert.deepEqual([s.added, s.updated], [0, 1]);
  assert.equal(calEvents.length, 3);
  const t = calEvents.find((e) => e.tags['nd-uid'] === 'internal-test-2@notice-decoder');
  assert.deepEqual([t.start.getDate(), t.start.getMonth() + 1, t.start.getHours()], [20, 11, 11]);
});

test('amber notice (timetable with Thursday/Friday): nothing added for it, nd-check label, one email with a #s= link', () => {
  const before = calEvents.length;
  inbox = [new FakeThread('End sem timetable', read('examples/04-exam-timetable.txt'), new Date(2026, 9, 15, 9, 0))];
  const s = call('processNotices');
  assert.equal(s.check, 1, 'only the DBMS row is amber');
  assert.equal(calEvents.length - before, 4, 'the four certain rows went in');
  assert.ok(inbox[0].labels.has('nd-check') && inbox[0].labels.has('nd-done'));
  assert.equal(sent.length, 1);
  assert.match(sent[0].subject, /Check 1 event/);
  assert.match(sent[0].body, /Thursday.*Friday/);
  const link = /https:\/\/\S+#s=([A-Za-z0-9_-]+)/.exec(sent[0].body);
  assert.ok(link, 'email carries the share link');
  const payload = JSON.parse(Buffer.from(link[1].replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8'));
  assert.equal(payload.v, 1);
  assert.deepEqual(payload.e.map((e) => [e.t, e.d, e.s]), [['DBMS exam', '2026-11-13', '10:00']]);
});

test('a mail with no dates does nothing and is labelled done', () => {
  inbox = [new FakeThread('Hi', 'Please be kind to everyone in the class group, thanks.', new Date())];
  const s = call('processNotices');
  assert.deepEqual([s.added, s.check, s.none], [0, 0, 1]);
  assert.ok(inbox[0].labels.has('nd-done'));
});

test('uninstall removes the trigger', () => {
  call('uninstall');
  assert.equal(triggers.length, 0);
});

console.log(`\n${passed} passed`);
