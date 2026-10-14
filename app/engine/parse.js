// Notice -> events. Pure rules, no AI: every field records the rule that set it (why) and the
// exact words it came from (sources), so the UI can explain and highlight each result.
import { findDates, findTimes, findDurations, iso, addDays, daysBetween, prettyDate, localISO, fmt12, toMin, fromMin } from './dates.js';

// Keyword families, checked in this order. type = one of the problem statement's types.
const FAMILIES = [
  // A deadline phrase wins over the topic it is about: "last date to pay the exam fee" is a deadline, not an exam.
  { fam: 'deadline', type: 'deadline', re: /\b(last date|deadline|due date|(?:submit|register|apply|pay)\w*\s+(?:by|before)|clos(?:es|ing date))\b/i },
  { fam: 'gd', type: 'test', re: /\b(?:[Gg]roup [Dd]iscussions?|GD)\b/ },
  { fam: 'interview', type: 'test', re: /\binterviews?\b/i },
  { fam: 'results', type: 'other', re: /\bresults?\b/i },
  { fam: 'test', type: 'test', re: /\b(internal tests?|unit tests?|class tests?|mid[- ]?terms?(?: exams?| tests?)?|end[- ]?sem(?:ester)?(?: (?:exams?|practicals?))?|examinations?|exams?|tests?|quiz(?:zes)?|viva(?: voce)?|practicals?|assessments?|aptitude)\b/i },
  { fam: 'deadline', type: 'deadline', re: /\b(submissions?|submit(?:ted)?|deadline|last date|due(?! to)(?: date)?|registrations?)\b/i },
  { fam: 'lecture', type: 'lecture', re: /\b(guest lectures?|lectures?|classes|seminars?(?!\s+(?:hall|room))|webinars?|workshops?|sessions?|orientation|talks?|trainings?)\b/i },
  { fam: 'other', type: 'other', re: /\b(placement drives?|drives?|fests?|hackathons?|meetings?|ceremony|competitions?|joining(?: dates?)?|(?:project )?reviews?|presentations?|events?)\b/i },
];
const TYPE_LABEL = { test: 'Test', deadline: 'Deadline', lecture: 'Lecture', other: 'Event' };
const TYPE_PHRASE = { test: 'a test', deadline: 'a deadline', lecture: 'a lecture or talk', other: 'an event' };
const REVISED = /\b(postponed|rescheduled|preponed|pre-poned|shifted|moved|changed|deferred)\s+(?:to|till|until|on)\b/i;
const RANGE_JOIN = /^\s*(?:,|and|&|to|till|until|-|–)\s*$/i;

const LABEL_LINE = /^[^\p{L}\p{N}\n]*\s*(date|day|time|timings?|venue|place|location|platform|mode|eligibility|participation|duration|reporting time)\s*[:\-–]/iu;
const VAGUE = /\b((?:this|next|coming)\s+(?:week|month)(?:\s+or\s+(?:this|next)\s+(?:week|month))?|next working days?|will be (?:confirmed|announced|intimated|informed|notified|decided)|to be (?:announced|decided|confirmed|notified)|TBD|TBA)\b/i;
const DEADLINE_CUE = /\b(by|before|latest by|not later than|within|till|until)\b[^.\n]{0,25}$/i;
const NOTE = /^(note\b[\s:\-–]*|please (?:do not|don['’]t|note|ensure|carry|bring)|do not|don['’]t|also ensure|ensure|make sure|carry|bring|mandatory|compulsory|students (?:must|should))/i;
const STOP = new Set('a an the all our your their his her its this that these those of for to in on at by from with and or is are was were be will can may dear please thanks thank expect steps exactly kindly also free today today’s today\'s you we they it as about into take join have has had see attend attended attending find below details selected shortlisted students student'.split(' '));
const PLACE = /(?:\b(?:in|at|to|inside|near)\s+(?:the\s+)?|\bvenue(?:\s+(?:remains|is|will be))?\s*[:\-–]?\s*|📍\s*|,\s*)((?:[A-Za-z]+\s+){0,2}?(?:room|hall|lab|laboratory|auditorium|office|block|ground|library|classroom|campus|centre|center|building|theatre|theater)(?:\s+[A-H]\b|\s*(?:no\.?\s*)?[A-Z]?-?\d+[A-Za-z]?)?)\b/i;
const ONLINE = /\b(zoom|google meet|ms teams|microsoft teams|webex|youtube live)\b/i;
const URL_RE = /https?:\/\/[^\s<>"')\]]+/g;
const CANCEL = /\b(cancell?ed|cancels?|called off|will not be held|cancel ho gay[ia])\b/i;
const GROUP_INVITE = /chat\.whatsapp\.com|t\.me\/|join (?:the |our )?[^.\n]{0,40}\b(?:whatsapp|telegram) group/i;

const cap = (s) => s.charAt(0).toUpperCase() + s.slice(1);

// 1. Split into units: label blocks ("Date: ... / Time: ...") stay together, other lines split into sentences.
function units(text) {
  const lines = [];
  let pos = 0;
  for (const line of text.split('\n')) { lines.push({ s: pos, e: pos + line.length, t: line }); pos += line.length + 1; }
  const out = [];
  let i = 0;
  while (i < lines.length) {
    if (LABEL_LINE.test(lines[i].t)) {
      let j = i, last = i;
      while (j < lines.length && (LABEL_LINE.test(lines[j].t) || !lines[j].t.trim())) { if (lines[j].t.trim()) last = j; j++; }
      let k = i - 1;
      while (k >= 0 && !lines[k].t.trim()) k--;
      out.push({ s: lines[i].s, e: lines[last].e, block: true, prevLine: k >= 0 ? lines[k] : null, lines: lines.slice(i, last + 1).filter((l) => l.t.trim()) });
      i = last + 1;
      continue;
    }
    const { s, t } = lines[i];
    if (t.trim()) {
      let start = 0;
      for (const m of t.matchAll(/[.!?](?=\s+["“(]?[A-Z])/g)) { out.push({ s: s + start, e: s + m.index + 1 }); start = m.index + 1; }
      out.push({ s: s + start, e: s + t.length });
    }
    i++;
  }
  return out
    .map((u) => { const raw = text.slice(u.s, u.e); const lead = raw.length - raw.trimStart().length; return { ...u, s: u.s + lead, e: u.e - (raw.length - raw.trimEnd().length) }; })
    .filter((u) => u.e > u.s)
    .map((u) => ({ ...u, text: text.slice(u.s, u.e) }));
}

function labelFor(k) {
  const w = k.kw.toLowerCase();
  if (k.fam === 'gd') return 'Group discussion';
  if (k.fam === 'deadline') return 'Deadline';
  if (k.fam === 'results') return 'Results';
  if (k.fam === 'test') return /quiz/.test(w) ? 'Quiz' : /exam/.test(w) ? 'Exam' : /viva/.test(w) ? 'Viva' : /practical/.test(w) ? 'Practical' : 'Test';
  return cap(w === 'classes' ? 'class' : w.replace(/s$/, ''));
}

function spanOf(info, base, k) {
  info.kwSpan = [base + k.i, base + k.i + k.kw.length];
  return info.at ? [base + info.at[0], base + info.at[1]] : info.kwSpan;
}

function keyword(str) {
  for (const f of FAMILIES) {
    const m = f.re.exec(str);
    if (m) return { ...f, kw: m[0], i: m.index };
  }
  return null;
}

// Walk back from the keyword over capitalised words ("Internal Test 2", "QSpiders Placement Drive").
function walkTitle(str, kwIndex, kw, lowercaseOk = false) {
  // Stay inside the clause: stop at line breaks, punctuation and list dashes (not hyphens inside words).
  const head = str.slice(0, kwIndex);
  const cut = Math.max(0, ...[...head.matchAll(/[\n.:;,()[\]!?@]|(?:^|\s)[-–]|[-–]\s/g)].map((m) => m.index + m[0].length));
  const before = head.slice(cut).split(/[^\p{L}\p{N}'’-]+/u);
  const words = [];
  for (let w = before.length - 1; w >= 0 && words.length < 3; w--) {
    const word = before[w];
    if (!word) { if (w === before.length - 1) continue; break; }
    if (STOP.has(word.toLowerCase())) break;
    if (!lowercaseOk && !/^[\p{Lu}\p{N}]/u.test(word)) break;
    words.unshift(word);
  }
  // A trailing number names the event ("Internal Test 2") unless it starts a date ("Lab exam 05/11/2026", "Test 13 Nov").
  const num = /^\s*(\d{1,2}|[IVX]{1,4})\b(?![/.-]\d)(?!(?:st|nd|rd|th)?\s*(?:of\s+)?(?:jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec))/i.exec(str.slice(kwIndex + kw.length));
  return [...words, kw].join(' ') + (num && !/\d{3,}/.test(num[1]) ? ' ' + num[1] : '');
}

function titleFor(str, k) {
  const quoted = /["“]([^"”]{3,60})["”]/.exec(str);
  if (quoted) return { title: `${cap(k.kw.toLowerCase())}: ${quoted[1]}`, why: `Named after the quoted topic "${quoted[1]}".`, at: [quoted.index, quoted.index + quoted[0].length] };
  const sub = /\b([A-Za-z]+\s+)?(records?|assignments?|reports?|files?|forms?|projects?|fees?|documents?|journals?|notebooks?)\s+(?:must|should|are to|have to|need to|to)\s+be\s+submitted/i.exec(str);
  if (sub) {
    const what = `${sub[1] || ''}${sub[2].replace(/s$/i, '')}`.trim();
    return { title: `${cap(what.toLowerCase())} submission`, why: `"${sub[0]}" means a submission.`, at: [sub.index, sub.index + sub[0].length] };
  }
  const topic = /\b([Ww]orkshop|[Ss]eminar|[Ww]ebinar|[Ll]ecture|[Tt]alk|[Ss]ession|[Qq]uiz|[Hh]ackathon|[Cc]ompetition|[Tt]raining)\s+on\s+((?:[A-Z][\w+#.-]*\s?){1,4})/.exec(str);
  if (topic && /^[A-Z]/.test(topic[2])) return { title: `${cap(topic[1].toLowerCase())}: ${topic[2].trim()}`, why: `"${topic[0].trim()}" names the topic.`, at: [topic.index, topic.index + topic[0].length] };
  const last = /\blast date (?:to|for) (?:the )?(.{3,40}?)(?=\s+(?:is|on|:)\b|[,:])/i.exec(str);
  if (last) return { title: cap(last[1]), why: `"${last[0]}" names what is due.`, at: [last.index, last.index + last[0].length] };
  const by = /\b(submit|register|apply|pay)\w*\s+(?:by|before)\b/i.exec(str);
  if (by) {
    const noun = { submit: 'Submission', register: 'Registration', apply: 'Application', pay: 'Payment' }[by[1].toLowerCase()];
    return { title: `${noun} deadline`, why: `"${by[0]}" is a deadline.`, at: [by.index, by.index + by[0].length] };
  }
  const t = walkTitle(str, k.i, k.kw, k.fam === 'deadline');
  return { title: cap(t), why: `Taken from the words "${t}".` };
}

// A one-word title ("Quiz") borrows a fuller name used elsewhere in the notice ("Aptitude Quiz").
function upgradeTitle(title, text, fam) {
  if (/\s/.test(title)) return title;
  const re = new RegExp(String.raw`\b${title.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\b`, 'gi');
  let best = title;
  // Lowercase phrases ("career guidance webinar") only for talks and events; for tests they pick up junk.
  for (const lower of fam === 'lecture' || fam === 'other' ? [false, true] : [false]) {
    for (const m of text.matchAll(re)) {
      const t = walkTitle(text, m.index, m[0], lower);
      if (t.split(' ').length > best.split(' ').length && t.split(' ').length <= 4) best = cap(t);
    }
    if (best !== title) break;
  }
  return best;
}

function venueFor(u) {
  if (u.block) {
    for (const l of u.lines) {
      const v = /(venue|place|location|platform|mode)\s*[:\-–]\s*(.+)$/i.exec(l.t);
      if (!v) continue;
      const val = v[2].trim(), s = l.s + l.t.indexOf(val);
      const online = ONLINE.exec(val) || /^online$/i.exec(val);
      return { venue: online && !/^online$/i.test(val) ? `Online (${val})` : val, span: [s, s + val.length], why: `"${v[1]}:" line.`, zoom: /zoom/i.test(val) };
    }
  }
  const p = PLACE.exec(u.text);
  if (p) { const s = u.s + p.index + p[0].indexOf(p[1]); return { venue: cap(p[1]), span: [s, s + p[1].length], why: `Place word found: "${p[1]}".` }; }
  const o = ONLINE.exec(u.text);
  if (o) return { venue: `Online (${o[1]})`, span: [u.s + o.index, u.s + o.index + o[0].length], why: `"${o[1]}" means it is online.`, zoom: /zoom/i.test(o[1]) };
  return null;
}

export function parseNotice(text, { pastedAt = new Date() } = {}) {
  const result = { anchorDate: null, events: [], pending: [], notes: [], warnings: [] };
  if (typeof text !== 'string' || !text.trim()) {
    result.warnings.push({ level: 'error', msg: 'Paste a notice first. It needs at least one sentence with a date or a time, for example "Test on 13 Nov at 10 AM".' });
    return result;
  }
  if (text.trim().length < 15) {
    result.warnings.push({ level: 'error', msg: `"${text.trim()}" is too short to be a notice. Paste the whole message, with its date and time.` });
    return result;
  }
  const pasted = localISO(pastedAt);
  const dates = findDates(text), times = findTimes(text), durations = findDurations(text);

  // 2. Year for dates that do not say one, then the anchor date for "today" / "next day".
  let lastYear = null;
  for (const d of dates.filter((x) => x.kind === 'abs')) {
    if (d.y) { lastYear = d.y; d.why = d.numeric ? `"${d.raw}" read as day/month/year (Indian format).` : `Date written in the notice: "${d.raw.trim()}".`; }
    else if (lastYear) { d.y = lastYear; d.why = `"${d.raw.trim()}" has no year; used ${lastYear} from earlier in the notice.`; }
    else {
      const [py] = pasted.split('-').map(Number);
      d.y = iso(py, d.m, d.d) < addDays(pasted, -60) ? py + 1 : py;
      d.why = `"${d.raw.trim()}" has no year; used the next ${d.d} ${prettyDate(iso(2000, d.m, d.d)).split(' ')[1]} from today.`;
      d.yearGuessed = true;
    }
    d.date = iso(d.y, d.m, d.d);
  }
  const firstAbs = dates.find((x) => x.kind === 'abs');
  const saysToday = /\b(today|tonight)\b/i.test(text);
  // "tomorrow" in a notice with a "Date:" line counts from the notice's date, like "today" does.
  const relWords = /\b(tomorrow|next day|day after tomorrow|kal|parso)\b/i.test(text);
  const dateLine = /^[^\p{L}\p{N}\n]*\s*date\s*[:\-–]/imu.test(text);
  const fromNotice = firstAbs && (saysToday || (dateLine && relWords));
  result.anchorDate = fromNotice ? firstAbs.date : pasted;
  result.anchorFromNotice = Boolean(fromNotice);
  const anchorWhy = fromNotice ? `the notice's own date (${prettyDate(firstAbs.date)})` : `the day you pasted it (${prettyDate(pasted)})`;
  for (const d of dates.filter((x) => x.kind === 'rel')) {
    if (d.weekday !== undefined) {
      const dow = new Date(`${result.anchorDate}T00:00:00Z`).getUTCDay();
      const ahead = (d.weekday - dow + 7) % 7 || (d.thisWeek ? 0 : 7);
      d.date = addDays(result.anchorDate, ahead);
      d.why = `"${d.raw}" = ${prettyDate(d.date)}, the next one after ${anchorWhy}.`;
      d.weekdayGuess = true;
      continue;
    }
    d.date = addDays(result.anchorDate, d.offset);
    d.why = d.offset === 0 ? `"${d.raw}" = ${anchorWhy}.` : `"${d.raw}" = ${d.offset} day${d.offset > 1 ? 's' : ''} after ${anchorWhy}.`;
  }

  // 3. One candidate event per unit that has a date or time and something to call it.
  const us = units(text);
  const inside = (toks, u) => toks.filter((t) => t.s >= u.s && t.e <= u.e);
  const candidates = [];
  const durationsByFam = [];
  let ctxDate = null;
  let id = 0;

  for (const u of us) {
    let ud = inside(dates, u), ut = inside(times, u);
    const udur = inside(durations, u);
    const k = keyword(u.text);
    // "POSTPONED to 20 Nov at 11 AM": the date and time after the change are the real ones.
    const rev = REVISED.exec(u.text);
    let oldWhen = null;
    if (rev) {
      const cut = u.s + rev.index;
      const after = ud.filter((x) => x.s >= cut);
      if (after.length) {
        const oldD = ud.find((x) => x.s < cut), oldT = ut.find((x) => x.s < cut);
        oldWhen = [oldD && prettyDate(oldD.date), oldT && fmt12(oldT.start)].filter(Boolean).join(', ');
        ud = after;
        if (ut.some((x) => x.s >= cut)) ut = ut.filter((x) => x.s >= cut);
      }
    }
    const firstDate = ud.find((x) => x.kind === 'abs') || ud[0];
    const prevCtx = ctxDate;
    if (firstDate) ctxDate = firstDate;

    // Cancelled items are reported, never added.
    if (k && CANCEL.test(u.text)) {
      result.warnings.push({ level: 'warn', span: [u.s, u.e], msg: `This part cancels something, so it is not added to your calendar: "${u.text.slice(0, 90).trim()}"` });
      continue;
    }
    // A time line with no event word ("Timings will be 9:30 AM to 12:30 PM daily") belongs to the event just above it.
    const prevEv = candidates[candidates.length - 1];
    if (!k && !ud.length && ut.length && !u.block && prevEv && !prevEv.start && us.indexOf(prevEv.unit) === us.indexOf(u) - 1) {
      setTime(prevEv, ut, u, text);
      continue;
    }

    if (!ud.length && !ut.length) {
      // "Venue remains Room 204." right after the event sentence gives that event its place.
      if (/^venue\b/i.test(u.text) && prevEv && !prevEv.venue && us.indexOf(prevEv.unit) === us.indexOf(u) - 1) {
        const v = venueFor(u);
        if (v) { prevEv.venue = v.venue; prevEv.sources.venue = v.span; prevEv.why.venue = v.why; continue; }
      }
      // "It takes 2 hours." right after an event belongs to that event.
      if (!k && udur.length && prevEv && !prevEv.durationMin && us.indexOf(prevEv.unit) === us.indexOf(u) - 1) { prevEv.durationMin = udur[0].minutes; continue; }
      if (k && udur.length) durationsByFam.push({ fam: k.fam, d: udur[0] });
      if (!u.block && NOTE.test(u.text.replace(/^[\s\-•*·]+/, ''))) result.notes.push(u.text.replace(/^[\s\-•*·]+/, '').replace(/^note\s*[:\-–]\s*/i, ''));
      const vague = VAGUE.exec(u.text);
      if (vague && k) addPending(result, u, k, vague[0]);
      continue;
    }
    const vague = VAGUE.exec(u.text);
    if (vague && k && !ud.some((d) => d.kind === 'abs')) { addPending(result, u, k, vague[0]); continue; }
    if (u.block) {
      for (const l of u.lines) if (/^[^\p{L}]*\s*(eligibility|participation)\s*[:\-–]/iu.test(l.t)) result.notes.push(l.t.replace(/^[^\p{L}]+/u, '').trim());
    }

    let kw = k, titleInfo;
    if (u.block) {
      const prevK = u.prevLine && keyword(u.prevLine.t);
      if (prevK) { kw = prevK; titleInfo = titleFor(u.prevLine.t, prevK); titleInfo.span = spanOf(titleInfo, u.prevLine.s, prevK); }
      else {
        const before = [...us].reverse().find((v) => v.e <= u.s && keyword(v.text));
        if (before) { kw = keyword(before.text); titleInfo = titleFor(before.text, kw); titleInfo.span = spanOf(titleInfo, before.s, kw); }
      }
    }
    if (!kw && !ut.length) continue; // a bare date with nothing happening on it
    if (!titleInfo && kw) { titleInfo = titleFor(u.text, kw); titleInfo.span = spanOf(titleInfo, u.s, kw); }
    if (!titleInfo) titleInfo = { title: 'Event', why: 'No event word found; please name it.', span: null };

    const ev = { id: `e${++id}`, title: titleInfo.title, family: kw ? kw.fam : 'other', type: kw ? kw.type : 'other', typeLabel: kw ? labelFor(kw) : 'Event',
      date: null, start: null, end: null, venue: null, link: null, durationMin: null, sources: {}, why: {}, flags: [], unit: u };
    ev.why.title = titleInfo.why;
    if (titleInfo.span) ev.sources.title = titleInfo.span;
    ev.why.type = kw ? `The word "${kw.kw}" means ${TYPE_PHRASE[kw.type]}.` : 'No event word found; set the type yourself.';
    if (titleInfo.kwSpan) ev.sources.type = titleInfo.kwSpan;

    // Date: own date, else the last date before it, else the anchor.
    const d = firstDate || prevCtx;
    if (d) {
      ev.date = d.date;
      ev.sources.date = [d.s, d.e];
      ev.why.date = firstDate ? d.why : `No date in this sentence; used the last date mentioned before it (${prettyDate(d.date)}).`;
      if (rev && firstDate) ev.revisedBy = rev[0];
      if (d.kal && firstDate) ev.flags.push({ field: 'date', level: 'warn', msg: `"kal" can mean yesterday or tomorrow; read as tomorrow (${prettyDate(d.date)}).` });
      if (oldWhen) { ev.why.date = `The notice moved it: "${rev[0]}" ${prettyDate(d.date)}.`; ev.flags.push({ field: 'date', level: 'info', msg: `Revised. It was ${oldWhen}.` }); }
      if (d.ambiguous) ev.flags.push({ field: 'date', level: 'warn', msg: `"${d.raw}" read as ${prettyDate(d.date)} (day first). If it means ${prettyDate(iso(d.y, d.d, d.m))}, fix the date.` });
      if (d.yearGuessed && firstDate) ev.flags.push({ field: 'date', level: 'info', msg: `Year not written; assumed ${d.y}.` });
      if (d.weekdayGuess && firstDate) ev.flags.push({ field: 'date', level: 'warn', msg: `"${d.raw}" read as ${prettyDate(d.date)}. Check it is the right week.` });
      if (firstDate) dateSpread(ev, ud, text);
    } else {
      ev.flags.push({ field: 'date', level: 'warn', msg: 'No date found in this part of the notice. Pick the date.' });
    }

    setTime(ev, ut, u, text);
    if (udur.length) ev.durationMin = udur[0].minutes;
    const v = venueFor(u);
    if (v) { ev.venue = v.venue; ev.sources.venue = v.span; ev.why.venue = v.why; if (v.zoom) ev.zoom = true; }
    candidates.push(ev);
  }

  // 4. Merge mentions of the same thing, catch contradictions, attach links and durations.
  const events = [];
  const norm = (s) => s.toLowerCase().replace(/[^a-z0-9]/g, '');
  for (const ev of candidates) {
    // A later "rescheduled to 12 Nov" replaces the earlier event of the same name instead of adding a second one.
    const earlier = ev.revisedBy && events.find((x) => norm(x.title) === norm(ev.title));
    if (earlier) {
      const was = [earlier.date && prettyDate(earlier.date), earlier.start && fmt12(earlier.start)].filter(Boolean).join(', ');
      for (const f of ['date', 'start', 'end']) {
        if (f !== 'date' || ev.date) earlier[f] = ev[f];
        if (ev.sources[f]) earlier.sources[f] = ev.sources[f];
        if (ev.why[f]) earlier.why[f] = ev.why[f];
      }
      earlier.flags.push({ field: 'date', level: 'info', msg: `Revised by "${ev.revisedBy}". It was ${was}.` });
      continue;
    }
    const same = events.find((x) => x.family === ev.family && x.date && ev.date && compatible(x, ev));
    if (same) { mergeInto(same, ev); continue; }
    const clash = events.find((x) => x.family === ev.family && x.date && ev.date && x.date !== ev.date && norm(x.title) === norm(ev.title) && x.family !== 'test');
    if (clash) {
      result.warnings.push({ level: 'warn', span: [ev.unit.s, ev.unit.e],
        msg: `The notice gives two different dates for "${clash.title}": ${prettyDate(clash.date)} ("${clash.unit.text.slice(0, 60).trim()}") and ${prettyDate(ev.date)} ("${ev.unit.text.slice(0, 60).trim()}"). Both are shown; keep the right one and delete the other.` });
      for (const x of [clash, ev]) x.flags.push({ field: 'date', level: 'warn', msg: 'The notice gives another date for this too. Keep the right one and delete the other.' });
    }
    events.push(ev);
  }
  for (const { fam, d } of durationsByFam) {
    const ev = events.find((x) => x.family === fam && !x.durationMin);
    if (ev) ev.durationMin = d.minutes;
  }
  attachLinks(text, events, us);

  for (const ev of events) {
    const full = upgradeTitle(ev.title, text, ev.family);
    if (full !== ev.title) { ev.why.title = `"${ev.title}" is called "${full}" elsewhere in the notice.`; ev.title = full; }
    if (ev.date && !ev.start) ev.flags.push({ field: 'start', level: 'info', msg: 'No time given; it will be an all-day event.' });
    // A known duration gives the end time, so the clash check and the calendar file use the same length.
    if (ev.start && !ev.end && ev.durationMin && !ev.point && ev.type !== 'deadline') {
      ev.end = fromMin(Math.min(toMin(ev.start) + ev.durationMin, 1439));
      ev.why.end = `It takes ${ev.durationMin} minutes, so it ends at ${fmt12(ev.end)}.`;
    }
    if (ev.start && !ev.end && !ev.point && ev.type !== 'deadline') ev.flags.push({ field: 'end', level: 'info', msg: 'End time not given. The calendar file uses 1 hour.' });
    if (ev.window && ev.durationMin) ev.flags.push({ field: 'end', level: 'info', msg: `Open from ${fmt12(ev.start)} to ${fmt12(ev.end)}; it takes ${ev.durationMin} minutes once you start.` });
    if (ev.zoom && !(ev.link && /zoom/i.test(ev.link))) ev.flags.push({ field: 'venue', level: 'warn', msg: 'The Zoom link is not in this message.' });
    if (!ev.venue && ev.link) { ev.venue = 'Online'; ev.why.venue = 'A joining link is given.'; }
    if (ev.end && toMin(ev.end) <= toMin(ev.start)) ev.flags.push({ field: 'end', level: 'warn', msg: 'End time is before the start. Please fix it.' });
    delete ev.unit;
  }
  result.events = events;

  // 5. Notice-level warnings.
  const dated = events.filter((e) => e.date).map((e) => e.date).sort();
  if (dated.length && dated[dated.length - 1] < pasted) {
    const last = dated[dated.length - 1];
    result.warnings.push({ level: 'warn', msg: `This notice looks old: its last event was on ${prettyDate(last)}, ${daysBetween(last, pasted)} days ago. These events have already passed.` });
  }
  const invite = GROUP_INVITE.exec(text);
  if (invite) {
    const college = /students of ([A-Z][A-Z&.,' ]{6,}[A-Z])/.exec(text);
    result.warnings.push({ level: 'warn', span: [invite.index, invite.index + invite[0].length],
      msg: `This message has a WhatsApp/Telegram group invite link${college ? ` and is addressed to "${college[1]}"` : ''}. Check that it comes from your college before joining or sharing your number.` });
  }
  if (!events.length && !result.pending.length) {
    result.warnings.push({ level: 'error', msg: 'No dates or times found in this text. Check that it has a date (like 13 Nov or 13/11/2026) and a time (like 2 PM or 14:00), or add the event by hand.' });
  }
  result.notes = [...new Set(result.notes)].slice(0, 8);
  return result;
}

function setTime(ev, ut, u, text) {
  const t = ut.find((x) => x.end) || ut[0];
  if (!t) return;
  ev.start = t.start;
  ev.sources.start = t.spanStart;
  const cue = DEADLINE_CUE.exec(text.slice(u.s, t.s));
  const noon = /noon/i.test(t.raw) ? " ('noon' = 12 PM)" : '';
  if (t.end) {
    ev.end = t.end;
    ev.sources.end = t.spanEnd;
    ev.why.start = ev.why.end = t.session ? `"${t.raw}" = ${t.raw === 'FN' ? 'forenoon' : 'afternoon'} session, assumed ${fmt12(t.start)} to ${fmt12(t.end)}.` : `Time range "${t.raw.trim()}".`;
    if (/\b(available|window|between|b\/w|any ?time)\b/i.test(u.text)) ev.window = true;
  } else if (cue) {
    ev.point = true;
    ev.why.start = `"${cue[0].trim()} ${t.raw.trim()}" = must happen by ${fmt12(t.start)}${noon}.`;
    if (ev.family === 'deadline') ev.type = 'deadline';
  } else {
    ev.why.start = `Time written: "${t.raw.trim()}"${noon}.`;
  }
  if (t.guessed) ev.flags.push({ field: 'start', level: 'warn', msg: t.session ? `${t.raw} session times differ by college; check ${fmt12(t.start)} - ${fmt12(t.end)}.` : `No AM/PM written; assumed ${fmt12(t.start)}.` });
  if (t.hinglish) ev.why.start = `Hinglish time "${t.raw}" = ${fmt12(t.start)}.`;
}

// Several dates in one sentence: "16 and 17 Oct" or "25 Oct to 30 Oct" is one event on every day;
// anything else is a question for the student, so it is flagged amber.
function dateSpread(ev, ud, text) {
  const abs = ud.filter((x) => x.kind === 'abs');
  if (abs.length < 2) return;
  const joined = abs.every((x, i) => i === 0 || RANGE_JOIN.test(text.slice(abs[i - 1].e, x.s)));
  const days = daysBetween(abs[0].date, abs[abs.length - 1].date) + 1;
  if (joined && days >= 2 && days <= 14) {
    ev.repeat = days; // ponytail: clashes are checked on the first day only; check each day if multi-day clashes matter
    ev.flags.push({ field: 'date', level: 'info', msg: `Runs every day from ${prettyDate(abs[0].date)} to ${prettyDate(abs[abs.length - 1].date)} (${days} days). The calendar file repeats it.` });
  } else {
    ev.flags.push({ field: 'date', level: 'warn', msg: `This part mentions more than one date (${abs.map((x) => prettyDate(x.date)).join(', ')}). We used the first; check it.` });
  }
}

function addPending(result, u, k, vague) {
  if (result.pending.some((p) => p.fam === k.fam)) return;
  const title = upgradeTitle(titleFor(u.text, k).title, u.text, k.fam);
  result.pending.push({ fam: k.fam, title, text: u.text.replace(/^[\s\-•*·]+/, '').slice(0, 180), why: `No firm date: the notice only says "${vague}".` });
}

function compatible(a, b) {
  if (!a.start || !b.start || a.start === b.start) return a.date === b.date;
  const within = (t, e) => e.end && toMin(t) >= toMin(e.start) && toMin(t) <= toMin(e.end);
  return a.date === b.date && (within(b.start, a) || within(a.start, b));
}

function mergeInto(keep, other) {
  const score = (e) => (e.end ? 2 : 0) + (e.start ? 1 : 0);
  if (score(other) > score(keep)) {
    for (const f of ['date', 'start', 'end']) {
      keep[f] = other[f];
      if (other.sources[f]) keep.sources[f] = other.sources[f]; else delete keep.sources[f];
      if (other.why[f]) keep.why[f] = other.why[f]; else delete keep.why[f];
    }
    keep.window = other.window; keep.point = other.point;
    keep.flags = keep.flags.filter((f) => !['date', 'start', 'end'].includes(f.field)).concat(other.flags.filter((f) => ['date', 'start', 'end'].includes(f.field)));
  }
  if (other.title.split(' ').length > keep.title.split(' ').length) { keep.title = other.title; keep.sources.title = other.sources.title; keep.why.title = other.why.title; }
  if (!keep.venue && other.venue) { keep.venue = other.venue; keep.sources.venue = other.sources.venue; keep.why.venue = other.why.venue; keep.zoom = other.zoom; }
  keep.durationMin = keep.durationMin || other.durationMin;
  keep.repeat = keep.repeat || other.repeat;
}

// A link line naming an event kind ("Aptitude Test Link") goes to that event; otherwise to the nearest event above it.
function attachLinks(text, events, us) {
  for (const m of text.matchAll(URL_RE)) {
    const url = m[0].replace(/[.,]+$/, '');
    if (GROUP_INVITE.test(url)) continue;
    const u = us.find((x) => m.index >= x.s && m.index < x.e);
    const k = u && keyword(u.text.replace(url, ''));
    let ev = k && events.find((e) => e.family === k.fam && !e.link);
    if (!ev) ev = [...events].reverse().find((e) => e.unit.s <= m.index && !e.link) || events.find((e) => !e.link);
    if (ev) ev.link = url;
  }
}
