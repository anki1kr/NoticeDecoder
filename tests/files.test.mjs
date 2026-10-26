// Run: node tests/files.test.mjs   (Node 20+: File, Blob and DecompressionStream are global)
// The .docx reader and the AI-answer guard, the two parts of the upload/AI path that run without a browser.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { docxToText, xmlToText } from '../app/docx.js';
import { parseNotice } from '../app/engine/parse.js';
import { needsAi, buildRequest, applyAnswer, locate, supported, weakTitle, summaryLine } from '../app/ai.js';

const file = (p, name = p.split('/').pop()) => new File([fs.readFileSync(new URL(`../${p}`, import.meta.url))], name);
const pastedAt = new Date(2026, 9, 26, 10);
let passed = 0;
const test = async (name, fn) => { await fn(); passed++; console.log('ok -', name); };

await test('Word notice: paragraphs and the timetable table come out as lines the rules read', async () => {
  const text = await docxToText(file('examples/14-word-notice.docx'));
  assert.match(text, /^NOTICE\n/);
  assert.match(text, /10 Nov 2026 \| Operating Systems \| 10:00 AM to 11:30 AM \| Room 204/);
  assert.match(text, /Department of Computer Science & Engineering\tDate: 26\/10\/2026/, 'tabs and & survive');
  const r = parseNotice(text, { pastedAt });
  const titles = r.events.map((e) => e.title);
  assert.ok(['Operating Systems', 'DBMS', 'Computer Networks'].every((s) => titles.some((t) => t.includes(s))), JSON.stringify(titles));
  const os = r.events.find((e) => /Operating Systems/.test(e.title));
  assert.deepEqual([os.date, os.start, os.end, os.venue], ['2026-11-10', '10:00', '11:30', 'Room 204']);
  const rec = r.events.find((e) => e.type === 'deadline');
  assert.deepEqual([rec.date, rec.start], ['2026-11-07', '17:00']);
});

await test('broken and wrong files say what is wrong, never crash or hang', async () => {
  const cases = [
    ['tests/fixtures/truncated.docx', /damaged/],
    ['tests/fixtures/not-really.docx', /not a Word document/],
    ['tests/fixtures/old-word.doc', /old Word file \(\.doc\)/],
    ['tests/fixtures/zip-bomb.docx', /too large/],
    ['tests/fixtures/empty.png', /not a Word document/],
  ];
  for (const [p, re] of cases) {
    const t0 = Date.now();
    await assert.rejects(docxToText(file(p)), re, p);
    assert.ok(Date.now() - t0 < 5000, `${p} took too long`);
  }
});

await test('xmlToText: entities, line breaks, tab stops in paragraph properties are not tabs, deleted text is not text', () => {
  const xml = '<w:document><w:body><w:p><w:pPr><w:tabs><w:tab w:val="left" w:pos="720"/></w:tabs></w:pPr><w:r><w:t>Fee &amp; form</w:t><w:br/><w:t xml:space="preserve">by 5 PM</w:t></w:r><w:del><w:r><w:delText>OLD 9 AM</w:delText></w:r></w:del></w:p></w:body></w:document>';
  assert.equal(xmlToText(xml), 'Fee & form\nby 5 PM');
});

// ---------- the AI answer guard ----------
const iicText = fs.readFileSync(new URL('../examples/13-promo-challenge.txt', import.meta.url), 'utf8');
const mk = (raw, i) => ({ id: raw.id || `e${i + 1}`, title: raw.title, type: raw.type, typeLabel: raw.typeLabel, date: raw.date, start: raw.start ?? null, end: raw.end ?? null, venue: raw.venue ?? null, sources: { ...(raw.sources || {}) }, why: { ...(raw.why || {}) }, flags: [...(raw.flags || [])] });
const ctx = { text: iicText, pastedAt, anchorDate: null, makeEvent: mk };

await test('needsAi: weak names, nothing found, photos; a clean notice costs no call', () => {
  const r = parseNotice(iicText, { pastedAt });
  assert.equal(needsAi(r, r.events, 'text'), false, 'the rules named it: no tokens spent');
  assert.equal(needsAi(r, [{ ...r.events[0], title: 'Practical' }], 'text'), true);
  assert.equal(needsAi(r, r.events, 'ocr'), true);
  assert.equal(needsAi({ text: 'Hello students, have a nice day. Regards.' }, [], 'text'), false, 'no digits: nothing to find');
  assert.equal(needsAi({ text: 'x' }, [], 'text'), false);
  assert.ok(weakTitle('Practical') && weakTitle('Registration deadline') && !weakTitle('Internal Test 2'));
  const { ids, body } = buildRequest(iicText, r.events);
  assert.deepEqual(ids, ['e1']);
  assert.deepEqual(Object.keys(body.events[0]), ['title', 'type', 'date', 'start', 'end', 'venue'], 'no sources, flags or why: fewer tokens');
});

await test('applyAnswer: a backed-up name is used and highlighted; an invented one is refused', () => {
  const events = [mk({ title: 'Practical', type: 'test', typeLabel: 'Practical', date: '2026-10-28', start: '14:20', venue: 'Room 208', why: { title: 'Taken from the words "practical".' } }, 0)];
  const r = applyAnswer(events, { events: [{ n: 1, title: 'Smart Campus Innovation Challenge', type: 'other', real: true, evidence: 'the Smart Campus Innovation Challenge' }], missed: [] }, ['e1'], ctx);
  assert.deepEqual([r.renamed, r.retyped, r.rejected], [1, 1, 0]);
  const [e] = r.events;
  assert.deepEqual([e.title, e.type, e.typeLabel, e.date, e.start], ['Smart Campus Innovation Challenge', 'other', 'Event', '2026-10-28', '14:20'], 'date and time untouched');
  assert.equal(iicText.slice(...e.sources.title), 'the Smart Campus Innovation Challenge');
  assert.match(e.why.title, /AI check/);
  assert.match(summaryLine(r), /renamed 1/);
  const bad = [mk({ title: 'Practical', type: 'test', date: '2026-10-28' }, 0)];
  const r2 = applyAnswer(bad, { events: [{ n: 1, title: 'Annual Robotics Olympiad Finals', type: 'test', real: true, evidence: 'Robotics Olympiad' }], missed: [] }, ['e1'], ctx);
  assert.deepEqual([r2.renamed, r2.rejected, bad[0].title], [0, 1, 'Practical'], 'evidence not in the notice: refused');
  const edited = [mk({ title: 'My own name', type: 'test', date: '2026-10-28', why: { title: 'edited by you' } }, 0)];
  applyAnswer(edited, { events: [{ n: 1, title: 'Smart Campus Innovation Challenge', type: 'other', real: true, evidence: 'Smart Campus Innovation Challenge' }], missed: [] }, ['e1'], ctx);
  assert.equal(edited[0].title, 'My own name', 'what the student typed always wins');
});

await test('applyAnswer: a missed event is dated by OUR rules from the quoted words, and comes in amber', () => {
  const text = 'Dear students,\nThe Robotics Club orientation will take place on 3 Nov 2026 at 4 PM in the Seminar Hall.\nAlso, the Quiz is on 5 Nov 2026 at 11 AM in Room 12.';
  const events = [mk({ title: 'Quiz', type: 'test', date: '2026-11-05', start: '11:00', venue: 'Room 12' }, 0)];
  const answer = { events: [], missed: [
    { title: 'Robotics Club orientation', type: 'lecture', date_text: '3 Nov 2026', time_text: '4 PM', venue: 'Seminar Hall', evidence: 'The Robotics Club orientation' },
    { title: 'Robotics Club orientation', type: 'lecture', date_text: '30 Nov 2026', time_text: '4 PM', venue: '', evidence: 'The Robotics Club orientation' },
    { title: 'Secret meeting', type: 'other', date_text: '9 Dec 2026', time_text: '', venue: '', evidence: 'Secret meeting' },
  ] };
  const r = applyAnswer(events, answer, ['e1'], { ...ctx, text });
  assert.equal(r.added, 1);
  assert.equal(r.rejected, 2, 'a date the notice never says and an event the notice never names are both refused');
  const ev = r.events.find((e) => e.ai && e.id.startsWith('ai-'));
  assert.deepEqual([ev.title, ev.type, ev.date, ev.start, ev.venue], ['Robotics Club orientation', 'lecture', '2026-11-03', '16:00', 'Seminar Hall']);
  assert.ok(ev.flags.some((f) => f.level === 'warn'), 'amber: the student checks it before export');
  assert.equal(text.slice(...ev.sources.date), '3 Nov 2026');
});

await test('locate and supported are whitespace- and case-tolerant, and strict about words', () => {
  assert.deepEqual(locate('Smart  Campus\nInnovation Challenge', 'smart campus innovation challenge'), [0, 34]);
  assert.equal(locate('abc', ''), null);
  assert.equal(locate('abc', 'a'), null);
  assert.ok(supported(iicText, 'Smart Campus Innovation Challenge'));
  assert.ok(supported(iicText, 'IIC Smart Campus challenge deadline'));
  assert.ok(!supported(iicText, 'Annual Robotics Olympiad'));
});

console.log(`\n${passed} passed`);
