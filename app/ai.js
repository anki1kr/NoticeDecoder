// AI check on top of the rules: which notices are worth a paid call, what to send, and how to use the answer without
// trusting it. The model never sets a date or a time. A new name is used only when the notice backs it (the quoted
// evidence is really in the notice and the name's words are the notice's words); a missed event is read by OUR date
// rules from the words the model quotes, and always comes in amber for the student to check.
import { parseNotice } from './engine/parse.js';

export const AI_PATH = '/api/ai/refine';
const TYPE_LABELS = { test: 'Test', deadline: 'Deadline', lecture: 'Lecture', other: 'Event' };
// A title that only names a kind of thing. "Practical" from "practical innovations" was one.
const WEAK_TITLE = /^(?:event|events|test|tests|exam|exams|quiz|viva|practical|class|classes|lecture|session|meeting|deadline|submission|registration|seminar|workshop|webinar|results?|interview|group discussion|drive|presentation|review|challenge|competition|programme?|activity|talk|training|orientation|form|payment|upload)(?:\s+(?:deadline|submission))?$/i;
const ALWAYS_OK_WORDS = /^(?:deadline|submission|exam|test|quiz|class|lecture|registration|event|session|payment|drive|challenge|viva|form|upload|fee|fees)$/i;

export const weakTitle = (title) => !String(title || '').trim() || WEAK_TITLE.test(String(title).trim());

// Worth a call: a weak title, a type the rules could not tell, a notice with dates but no events, or text that came
// out of a photo (OCR garbles names first). A clean notice costs no tokens at all.
export function needsAi(result, events, source = 'text') {
  if (!result || typeof result.text !== 'string' || result.text.trim().length < 15) return false;
  if (source === 'ocr') return events.length > 0 || /\d/.test(result.text);
  if (!events.length) return /\d/.test(result.text) && !(result.pending || []).length;
  return events.some((e) => !e.manual && (weakTitle(e.title) || /^No event word/.test(e.why?.title || '')));
}

export function buildRequest(text, events) {
  const sent = events.slice(0, 25);
  return {
    ids: sent.map((e) => e.id),
    body: { text: String(text).slice(0, 6000), events: sent.map(({ title, type, date, start, end, venue }) => ({ title, type, date, start, end, venue })) },
  };
}

const norm = (s) => String(s || '').toLowerCase().replace(/\s+/g, ' ').trim();
const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

// Where the quote sits in the notice, whitespace-insensitive. null when the notice does not say it.
export function locate(text, quote) {
  const words = String(quote || '').trim().split(/\s+/).filter(Boolean);
  if (!words.length || words.join(' ').length < 3) return null;
  const m = new RegExp(words.map(escapeRe).join('\\s+'), 'iu').exec(text);
  return m ? [m.index, m.index + m[0].length] : null;
}

// The name is the notice's own words: at least 60% of its words (3+ letters) are in the notice.
export function supported(text, title) {
  const words = String(title || '').toLowerCase().match(/[\p{L}\p{M}\p{N}]{3,}/gu) || [];
  if (!words.length) return false;
  const hay = norm(text);
  return words.filter((w) => hay.includes(w) || ALWAYS_OK_WORDS.test(w)).length / words.length >= 0.6;
}

const short = (s, n = 70) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);

// Apply an answer to the working copies. Fields the student already edited are never touched.
// ctx: { text, pastedAt, anchorDate, makeEvent(raw, index) }. Returns what changed, in words, for the status line.
export function applyAnswer(events, answer, ids, ctx) {
  const lines = [];
  let renamed = 0, retyped = 0, doubted = 0, rejected = 0, added = 0;
  const byId = new Map(events.map((e) => [e.id, e]));
  for (const item of answer?.events || []) {
    const ev = byId.get(ids[item.n - 1]);
    if (!ev) continue;
    const span = locate(ctx.text, item.evidence);
    const title = String(item.title || '').replace(/\s+/g, ' ').trim().slice(0, 90);
    const editedTitle = ev.why?.title === 'edited by you';
    if (title && norm(title) !== norm(ev.title) && !editedTitle) {
      if (span && supported(ctx.text, title)) {
        lines.push(`"${ev.title || 'Untitled'}" → "${title}"`);
        ev.title = title;
        ev.why = { ...ev.why, title: `AI check (Claude Haiku): the notice calls it "${short(ctx.text.slice(...span))}".` };
        ev.sources = { ...ev.sources, title: span };
        ev.ai = true;
        renamed++;
      } else rejected++;
    }
    if (item.type && TYPE_LABELS[item.type] && item.type !== ev.type && ev.why?.type !== 'edited by you' && (span || weakTitle(ev.title))) {
      ev.type = item.type;
      ev.typeLabel = TYPE_LABELS[item.type];
      ev.why = { ...ev.why, type: `AI check: this is ${item.type === 'other' ? 'an event' : `a ${item.type}`}.` };
      ev.ai = true;
      retyped++;
    }
    if (item.real === false && !(ev.flags || []).some((f) => f.ai)) {
      ev.flags = [...(ev.flags || []), { field: 'title', level: 'warn', ai: true, msg: `The AI check thinks this may not be an event${span ? ` ("${short(ctx.text.slice(...span), 60)}")` : ''}. Delete it if so, or press "Looks right".` }];
      doubted++;
    }
  }
  for (const m of answer?.missed || []) {
    const span = locate(ctx.text, m.evidence);
    const dateSpan = m.date_text ? locate(ctx.text, m.date_text) : null;
    const timeSpan = m.time_text ? locate(ctx.text, m.time_text) : null;
    if (!span || !(dateSpan || timeSpan) || !supported(ctx.text, m.title)) { rejected++; continue; }
    // Our own rules read the date and time out of the quoted words; the model's reading is never used.
    const mini = `Meeting on ${dateSpan ? ctx.text.slice(...dateSpan) : ''}${timeSpan ? ` at ${ctx.text.slice(...timeSpan)}` : ''}${m.venue && locate(ctx.text, m.venue) ? ` in ${m.venue}` : ''}.`;
    const read = parseNotice(mini, { pastedAt: ctx.anchorDate ? new Date(`${ctx.anchorDate}T09:00:00`) : ctx.pastedAt }).events[0];
    if (!read || !read.date) { rejected++; continue; }
    if (events.some((e) => e.date === read.date && (e.start || null) === (read.start || null) && (norm(e.title) === norm(m.title) || e.start))) continue;
    const ev = ctx.makeEvent({
      id: `ai-${events.length + 1}`, title: m.title.slice(0, 90), type: m.type, typeLabel: TYPE_LABELS[m.type] || 'Event',
      date: read.date, start: read.start, end: read.end, venue: read.venue,
      sources: { title: span, ...(dateSpan ? { date: dateSpan } : {}), ...(timeSpan ? { start: timeSpan } : {}) },
      why: { title: `Found by the AI check: "${short(ctx.text.slice(...span))}".`, date: `Read by the rules from "${dateSpan ? ctx.text.slice(...dateSpan) : read.date}".` },
      flags: [{ field: 'date', level: 'warn', ai: true, msg: 'Found by the AI check, not by the rules: compare the date and time with the notice.' }],
    }, events.length);
    ev.ai = true;
    events.push(ev);
    lines.push(`added "${ev.title}"`);
    added++;
  }
  return { events, renamed, retyped, doubted, rejected, added, lines };
}

export function summaryLine(r, { cached = false } = {}) {
  const parts = [];
  if (r.renamed) parts.push(`renamed ${r.renamed}`);
  if (r.retyped) parts.push(`fixed ${r.retyped} type${r.retyped > 1 ? 's' : ''}`);
  if (r.added) parts.push(`found ${r.added} more`);
  if (r.doubted) parts.push(`${r.doubted} to check`);
  const what = parts.length ? parts.join(', ') : 'nothing to change';
  return `AI check: ${what}${r.lines.length ? ` (${r.lines.slice(0, 3).join('; ')})` : ''}.${cached ? ' (same notice checked before, no new call)' : ''}`;
}
