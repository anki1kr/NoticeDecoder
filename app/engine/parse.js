// Notice -> events. Pure rules, no AI: every field records the rule that set it (why) and the
// exact words it came from (sources), so the UI can explain and highlight each result.
import { findDates, findTimes, findDurations, iso, addDays, daysBetween, prettyDate, localISO, fmt12, toMin, fromMin, weekdayOf, WEEKDAY_NAMES, DAY_CODES } from './dates.js';
import { holidayOn } from './holidays.js';

// Keyword families, checked in this order. type = one of the problem statement's types.
const FAMILIES = [
  // A deadline phrase wins over the topic it is about: "last date to pay the exam fee" is a deadline, not an exam.
  { fam: 'deadline', type: 'deadline', re: /\b(last date|last day|deadline|due date|(?:submit|register|apply|pay|upload|fill|collect|return|send|mail|complete|deposit)\w*\s+(?:by|before|on or before|latest by)|(?:must|should|have to|has to|need to|needs to|are to|is to)\s+be\s+\w+(?:ed|t)\b[^.\n]{0,40}?\b(?:by|before|latest by|on or before)\b|clos(?:es|ing date))\b/i },
  { fam: 'deadline', type: 'deadline', re: /(अंतिम तिथि|अंतिम दिनांक|जमा करन[ेा]|जमा कर)/u },
  { fam: 'gd', type: 'test', re: /\b(?:[Gg]roup [Dd]iscussions?|GD)\b/ },
  { fam: 'interview', type: 'test', re: /\binterviews?\b/i },
  { fam: 'results', type: 'other', re: /\bresults?\b|परिणाम/i },
  // "practical" is a test only as a noun: "Practical on 5 Nov", not "practical innovations" or "practical knowledge".
  { fam: 'test', type: 'test', re: /\b(practical vivas?|lab vivas?|internal tests?|unit tests?|class tests?|slip tests?|surprise tests?|mock tests?|mid[- ]?(?:terms?|sems?|semesters?)(?: exams?| tests?)?|sessionals?(?: exams?)?|end[- ]?sem(?:ester)?(?: (?:exams?|practicals?))?|semester exams?|model exams?|lab exams?|re-?exams?|supplementary(?: exams?)?|backlog exams?|internal assessments?|examinations?|exams?|tests?|quiz(?:zes)?|viva(?: voce)?|practicals?(?!\s+(?:innovations?|knowledge|skills?|experiences?|exposure|solutions?|approach(?:es)?|applications?|ideas?|problems?|learning|training|insights?|tips|uses?|implementations?|projects?|work|ways?|aspects?|understanding|examples?|guidance|purposes?|steps?|life|world|matters?|sense|demonstrations?|sessions?|orientation)\b)|assessments?|aptitude|olympiad)\b/i },
  { fam: 'test', type: 'test', re: /(परीक्षा|टेस्ट|क्विज़|क्विज|प्रैक्टिकल|मौखिकी)/u },
  // Exam acronyms are case-sensitive on purpose: "see" and "cat" are ordinary words.
  { fam: 'test', type: 'test', re: /\b(CIE|SEE|CAT[- ]?[12]|FAT|MST|EST)\b/ },
  { fam: 'deadline', type: 'deadline', re: /\b(submissions?|submit(?:ted)?|upload(?:ed|ing)?|deadline|last date|due(?! to)(?: date)?|registrations?|fee payment|fees?|pay(?:ment)?)\b/i },
  { fam: 'lecture', type: 'lecture', re: /\b((?:extra|remedial|make-?up|doubt|revision|bridge|special|additional|compensatory|substitute)\s+(?:class(?:es)?|lectures?|sessions?)|guest lectures?|expert lectures?|lectures?|classes|courses?|tutorials?|seminars?(?!\s+(?:hall|room))|webinars?|workshops?|masterclass(?:es)?|bootcamps?|sessions?|orientation|induction|talks?|trainings?)\b/i },
  { fam: 'lecture', type: 'lecture', re: /(व्याख्यान|कक्षा|सेमिनार|कार्यशाला|वेबिनार|सत्र)/u },
  { fam: 'other', type: 'other', re: /\b(placement drives?|campus drives?|pool campus|drives?|fests?|hackathons?|ideathons?|(?:industrial|field|educational|study)\s+(?:visits?|trips?|tours?)|excursions?|meetings?|ceremony|convocation|competitions?|contests?|tournaments?|symposi(?:um|a)|conclaves?|summits?|conferences?|exhibitions?|expos?|sports day|annual day|farewell|freshers?(?:['’]s)? party|cultural (?:fest|event|night)|parade|camp|joining(?: dates?)?|(?:project )?reviews?|presentations?|events?)\b/i },
  // "Smart Campus Innovation Challenge": a named challenge is an event. Lower-case "challenges" in a sentence is not.
  { fam: 'other', type: 'other', re: /\b((?:[Ii]nnovation|[Cc]oding|[Dd]esign|[Ss]tartup|[Ii]deation|[Cc]ase [Ss]tudy|[Pp]itch(?:ing)?)\s+[Cc]hallenges?|(?<![.!?]\s)(?<!^)Challenges?)\b/ },
  { fam: 'other', type: 'other', re: /(कार्यक्रम|प्रतियोगिता|बैठक|समारोह|उत्सव)/u },
];
const TYPE_LABEL = { test: 'Test', deadline: 'Deadline', lecture: 'Lecture', other: 'Event' };
const TYPE_PHRASE = { test: 'a test', deadline: 'a deadline', lecture: 'a lecture or talk', other: 'an event' };
const REVISED = /\b(?:(?:postponed|rescheduled|preponed|pre-poned|shifted|moved|changed|deferred)\s+(?:to|till|until|on)|(?:extended|advanced|revised|prolonged)\s+(?:from\s+[^.\n]{0,45}?\s+)?(?:to|till|until))\b/i;
const RANGE_JOIN = /^\s*(?:,|and|&|to|till|until|-|–|aur|और|व|से|(?:and\s+)?(?:will\s+)?(?:end|conclude|finish)(?:s|ing)?(?:\s+(?:on|by))?)\s*$/i;

const LABEL_LINE = /^[^\p{L}\p{N}\n]*\s*(date|day|time|timings?|venue|place|location|platform|mode|eligibility|participation|duration|reporting time|दिनांक|तिथि|समय|स्थान)\s*[:\-–]/iu;
const VAGUE = /\b((?:in|within|over)\s+(?:the\s+)?(?:upcoming|coming|next\s+few)\s+days|(?:this|next|coming)\s+(?:week|month)(?:\s+or\s+(?:this|next)\s+(?:week|month))?|next working days?|will be (?:confirmed|announced|intimated|informed|notified|decided)|to be (?:announced|decided|confirmed|notified)|TBD|TBA)\b/i;
const DEADLINE_CUE = /\b(by|before|latest by|not later than|within|till|until|on or before|तक)\b[^.\n]{0,25}$/iu;
const END_CUE = /^\W*(?:and\s+)?(?:(?:will\s+|would\s+|should\s+)?(?:ends?|close[sd]?|finish(?:es)?|get over|conclude[sd]?|be over)\s+(?:by|at|around)|to|till|until|upto|up to)\W*$/i;
const NOTE = /^(note\b[\s:\-–]*|please (?:do not|don['’]t|note|ensure|carry|bring)|do not|don['’]t|also ensure|ensure|make sure|carry|bring|mandatory|compulsory|students (?:must|should))/i;
const STOP = new Set('no not a an the all our your their his her its this that these those of for to in on at by from with and or is are was were be will can may dear please thanks thank expect steps exactly kindly also free today today’s today\'s you we they it as about into take join have has had see attend attended attending find below details selected shortlisted students student'.split(' '));
// Words that do not tell two events apart: "Test" and "Maths test" may be the same thing, "Maths test" and "Physics test" are not.
const GENERIC = new Set('event events test tests exam exams quiz deadline lecture lectures class classes session sessions submission registration workshop seminar webinar meeting viva practical practicals drive interview gd group discussion guest internal online offline'.split(' '));
// Hindi function words that never name an event.
const HINDI_STOP = 'की का के को में पर से और है हैं होगी होगा होंगे एवं तथा या कि'.split(' ');
// Place words. Indian campuses also say "LT-3" (lecture theatre), "CR-2" (classroom), "Lab-II", "Block A-204", "SH 1".
// A wide gap counts as a separator too: posters set date, place and time in columns ("28 October 2026  Room 208  2:20 PM").
const PLACE = /(?:\b(?:in|at|to|from|inside|near)\s+(?:the\s+)?|\bvenue(?:\s+(?:remains|is|will be))?\s*[:\-–]?\s*|📍\s*|,\s*|\S {2,})((?:[A-Za-z]+\s+){0,2}?(?:(?:room|hall|lab|laboratory|auditorium|office|block|ground|library|classroom|campus|centre|center|building|theatre|theater)(?:\s+[A-H]\b(?:-?\d{1,3})?|\s*(?:no\.?\s*)?[A-Z]?-?(?:\d{1,4}[A-Za-z]?|[IVX]{1,4}))?|(?:LT|CR|SH|LH|TH)[- ]?(?:\d{1,3}|[IVX]{1,4})\b))\b/i;
// Hinglish puts the place first: "Room 12 me", "Lab 3 mein".
const HINGLISH_PLACE = /\b((?:room|hall|lab|auditorium|block|classroom|library|seminar hall)\s*(?:no\.?\s*)?[A-Z]?-?\d{1,4}[A-Za-z]?)\s+(?:me|mein|mai|mei)\b/i;
const ONLINE = /\b(zoom|google meet|ms teams|microsoft teams|webex|youtube live)\b/i;
const HINDI_PLACE = /((?:कमरा|कक्ष|कमरे|हॉल|सभागार|प्रयोगशाला|लैब|पुस्तकालय|मैदान)\s*(?:नं\.?|संख्या|नंबर)?\s*[\dA-Za-z०-९-]*)/u;
const URL_RE = /https?:\/\/[^\s<>"')\]]+/g;
const CANCEL = /\b(cancell?ed|cancels?|called off|will not be held|cancel (?:ho gay[ia]|hai|hoga|hua|kar di[ay]e?)|nahi (?:hogi|hoga|honge|hui)|stands cancelled)\b|रद्द/i;
const NO_SESSION = /\bno\s+(?:classes|class|lectures?|teaching|tests?|exams?)\b|\b(?:classes|lectures|college|campus|library)\s+(?:will\s+)?(?:remains?|be)\s+closed\b/i;
const CLASS_WORD =/\b(class|lecture|period|lab|practical|test|exam)\b/i;
const GROUP_INVITE = /chat\.whatsapp\.com|t\.me\/|join (?:the |our )?[^.\n]{0,40}\b(?:whatsapp|telegram) group/i;
// Timetable rows: "10 Nov 2026 - Maths - 10 AM to 1 PM - Room 1", "Mon | 19/10 | DBMS | 2 PM | Lab 2"
const CELL_SPLIT = /\s*\|\s*|\t+|\s+[-–—]\s+|\s{3,}/;
const WEEKDAY_WORD = /^(?:sun|mon|tue|tues|wed|thu|thur|thurs|fri|sat)(?:day|sday|nesday|rsday|urday)?\.?$/i;

const cap = (s) => s.charAt(0).toUpperCase() + s.slice(1);
const norm = (s) => s.toLowerCase().replace(/[^\p{L}\p{M}\p{N}]/gu, '');
const sig = (title) => new Set(title.toLowerCase().split(/[^\p{L}\p{M}\p{N}]+/u).filter((w) => w && !STOP.has(w) && !GENERIC.has(w)));
// The same thing mentioned twice, or two different things? Both titles share a telling word, or one has none.
function sameThing(a, b) {
  if (norm(a) === norm(b)) return true;
  const sa = sig(a), sb = sig(b);
  // "Test" and "Maths test" may be one thing; "Internal test" and "Lab exam" (two generic names that differ) are two.
  if (!sa.size && !sb.size) return !/\s/.test(a.trim()) || !/\s/.test(b.trim());
  if (!sa.size || !sb.size) {
    const [generic, other] = sa.size ? [b, a] : [a, b];
    return norm(other).includes(norm(generic)); // "Test" is the "Maths test"; "Practical" is not the "OS exam"
  }
  return [...sa].some((w) => sb.has(w));
}

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
      for (const m of t.matchAll(/(?<!\b(?:Mr|Mrs|Ms|Dr|Prof|Shri|Smt|St|No|Sr|Jr|[A-Z]))[.!?।](?=\s+["“(]?[A-Z\u0900-\u097F])/gu)) { out.push({ s: s + start, e: s + m.index + 1 }); start = m.index + 1; }
      out.push({ s: s + start, e: s + t.length });
    }
    i++;
  }
  return out
    .map((u) => { const raw = text.slice(u.s, u.e); const lead = raw.length - raw.trimStart().length; return { ...u, s: u.s + lead, e: u.e - (raw.length - raw.trimEnd().length) }; })
    .filter((u) => u.e > u.s)
    .map((u) => ({ ...u, text: text.slice(u.s, u.e) }));
}

// "Internal Test 2 at 10 AM in Room 204 and a guest lecture at 11 AM in the Seminar Hall": one sentence, two events.
// A sentence is cut at "and" / ";" only when both halves have their own time AND their own event word.
// "Physics on 12 Nov at 9 AM and Chemistry on 13 Nov at 9 AM": the second half has no event word but a subject, so it
// takes the kind of the first (`inherit`); commas split only in that case.
const SUBJECT_ON = /^[A-Z][\w+#&./-]*(?:\s+[A-Z][\w+#&./-]*){0,2}(?=\s+(?:on|at)\b)/;
function splitCompound(us, text, times) {
  const out = [];
  for (const u of us) {
    if (u.block) { out.push(u); continue; }
    const inside = (s, e) => times.filter((t) => t.s >= s && t.e <= e);
    if (inside(u.s, u.e).length < 2) { out.push(u); continue; }
    let cur = u;
    for (const m of u.text.matchAll(/;\s*|,?\s+(?:and|&|aur|और)\s+|,\s+/g)) {
      const p = u.s + m.index, q = p + m[0].length;
      if (p <= cur.s) continue;
      const left = text.slice(cur.s, p), right = text.slice(q, u.e);
      const lk = keyword(left) || (cur.inherit && keyword(cur.inherit));
      const subject = !keyword(right) && lk && lk.fam !== 'deadline' && SUBJECT_ON.test(right);
      if (!inside(cur.s, p).length || !inside(q, u.e).length || !lk || !(keyword(right) || subject) || (/^,\s+$/.test(m[0]) && !subject)) continue;
      out.push({ s: cur.s, e: p, text: left, split: true, ...(cur.inherit ? { inherit: cur.inherit } : subject ? { head: true } : {}) });
      cur = { s: q, e: u.e, text: right, split: true, ...(subject ? { inherit: cur.inherit || left } : {}) };
    }
    out.push(cur);
  }
  return out;
}

function labelFor(k) {
  const w = k.kw.toLowerCase();
  if (k.fam === 'gd') return 'Group discussion';
  if (k.fam === 'deadline') return 'Deadline';
  if (k.fam === 'results') return 'Results';
  if (k.fam === 'test') return /quiz|क्विज/.test(w) ? 'Quiz' : /exam|sem|cie|see|sessional|परीक्षा/.test(w) ? 'Exam' : /viva|मौखिकी/.test(w) ? 'Viva' : /practical|प्रैक्टिकल/.test(w) ? 'Practical' : 'Test';
  if (/challenges?$/.test(w)) return 'Challenge';
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

// A weekday, month, AM/PM or clock/range word is part of the when, never of the title ("Wednesday 4-5 PM remedial class").
const DATEISH = /^(?:\d{1,2}[:.]\d{2}|\d{1,2}-\d{1,2}|[ap]\.?m\.?|(?:sun|mon|tues?|wed(?:nes)?|thu(?:rs)?|fri|sat(?:ur)?)(?:day)?|(?:jan|feb|mar|apr|jun|jul|aug|sep|oct|nov|dec)[a-z]*)$/i;

// Walk back from the keyword over capitalised words ("Internal Test 2", "QSpiders Placement Drive").
function walkTitle(str, kwIndex, kw, lowercaseOk = false) {
  // Stay inside the clause: stop at line breaks, punctuation and list dashes (not hyphens inside words).
  const head = str.slice(0, kwIndex);
  const cut = Math.max(0, ...[...head.matchAll(/[\n.:;,()[\]!?@।]|(?:^|\s)[-–]|[-–]\s/g)].map((m) => m.index + m[0].length));
  const before = head.slice(cut).split(/[^\p{L}\p{M}\p{N}'’-]+/u);
  const words = [];
  for (let w = before.length - 1; w >= 0 && words.length < 3; w--) {
    const word = before[w];
    if (!word) { if (w === before.length - 1) continue; break; }
    if (HINDI_STOP.includes(word)) continue;
    if (DATEISH.test(word)) break;
    if (STOP.has(word.toLowerCase())) break;
    if (!lowercaseOk && !/^[\p{Lu}\p{N}\p{Script=Devanagari}]/u.test(word)) break;
    words.unshift(word);
  }
  // A trailing number names the event ("Internal Test 2") unless it starts a date ("Lab exam 05/11/2026", "Test 13 Nov").
  const num = /^(-|\s*)(\d{1,2}|[IVX]{1,4})\b(?![/.-]\d)(?!(?:st|nd|rd|th)?\s*(?:of\s+)?(?:jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec|[\u0900-\u097F]))/i.exec(str.slice(kwIndex + kw.length));
  return [...words, kw].join(' ') + (num && !/\d{3,}/.test(num[2]) ? (num[1] === '-' && !/[a-z]/.test(kw) ? '-' : ' ') + num[2] : '');
}

function titleFor(str, k) {
  const quoted = /["“]([^"”]{3,60})["”]/.exec(str);
  if (quoted) return { title: `${cap(k.kw.toLowerCase())}: ${quoted[1]}`, why: `Named after the quoted topic "${quoted[1]}".`, at: [quoted.index, quoted.index + quoted[0].length] };
  const sub = /\b([A-Za-z]+\s+)?(records?|assignments?|reports?|files?|forms?|projects?|fees?|documents?|journals?|notebooks?)\s+(?:must|should|are to|have to|need to|to)\s+be\s+submitted/i.exec(str);
  if (sub) {
    const what = `${sub[1] || ''}${sub[2].replace(/s$/i, '')}`.trim();
    return { title: `${cap(what.toLowerCase())} submission`, why: `"${sub[0]}" means a submission.`, at: [sub.index, sub.index + sub[0].length] };
  }
  const passive = /\b((?:[\p{L}\p{N}-]+\s+){0,2}[\p{L}\p{N}-]+)\s+(?:must|should|are to|is to|have to|has to|need to|needs to)\s+be\s+(submitted|collected|returned|uploaded|paid|completed|filled|deposited|sent|mailed|handed over)\b/iu.exec(str);
  if (passive) {
    const what = passive[1].split(/\s+/).filter((w, i, a) => !(i < a.length - 1 && STOP.has(w.toLowerCase()))).join(' ');
    const noun = { submitted: 'submission', collected: 'collection', returned: 'return', uploaded: 'upload', paid: 'payment', completed: 'completion', filled: 'form', deposited: 'deposit', sent: 'submission', mailed: 'submission', 'handed over': 'submission' }[passive[2].toLowerCase()];
    return { title: `${cap(what)} ${noun}`, why: `"${passive[0]}" says what is due.`, at: [passive.index, passive.index + passive[0].length] };
  }
  const hindiDue = /^(.*?)\s*\d{1,2}\s*[\u0900-\u097F]+\s*(?:\d{4})?\s*(?:तक|से पहले)/u.exec(str);
  if (hindiDue && /[\u0900-\u097F]/.test(k.kw) && hindiDue[1].trim()) {
    const what = hindiDue[1].replace(/^[^\p{L}]*(?:सूचना|नोट)?[\s:\-–]*/u, '').split(/\s+/).filter((w) => !HINDI_STOP.includes(w)).slice(-3).join(' ');
    if (what) return { title: `${what} जमा`, why: `"${hindiDue[0].trim()}" = due by that date.`, at: [hindiDue.index, hindiDue.index + hindiDue[0].length] };
  }
  const topic = /\b([Ww]orkshop|[Ss]eminar|[Ww]ebinar|[Ll]ecture|[Tt]alk|[Ss]ession|[Qq]uiz|[Hh]ackathon|[Cc]ompetition|[Tt]raining|[Mm]asterclass)\s+on\s+((?:[A-Z][\w+#./&-]*\s?){1,4})/.exec(str);
  if (topic && /^[A-Z]/.test(topic[2])) return { title: `${cap(topic[1].toLowerCase())}: ${topic[2].trim().replace(/[.,&/-]+$/, '')}`, why: `"${topic[0].trim()}" names the topic.`, at: [topic.index, topic.index + topic[0].length] };
  const closing = /\b((?:[A-Za-z]+\s+)?(?:registrations?|admissions?|applications?|enrol?lments?))\b[^.\n]{0,40}?\bclos(?:es|ing|ed)\b/i.exec(str)
    || /\b((?:[A-Za-z]+\s+){0,2}(?:fees?|payment|registration|submission|application|form))\b[^.\n:]{0,30}[:,\s]\s*last (?:date|day)\b/i.exec(str);
  if (closing) return { title: `${cap(closing[1].toLowerCase())} deadline`, why: `"${closing[0].trim()}" is a deadline.`, at: [closing.index, closing.index + closing[0].length] };
  const last = /\blast (?:date|day) (?:to|for) (?:the )?(.{3,40}?)(?=\s+(?:is|on|:)\b|[,:.!?]|$)/i.exec(str);
  if (last) return { title: cap(last[1]), why: `"${last[0]}" names what is due.`, at: [last.index, last.index + last[0].length] };
  const verbObj = /\b(submit|upload|send|mail|register|pay|fill)\s+(?:your|their|the|all|his|her|in)?\s*([a-z][\w ]{2,60}?)\s+(?:by|before|on or before|latest by|till|not later than)\b/i.exec(str);
  if (verbObj) {
    const obj = verbObj[2].split(/\s+(?:of|for|in|on|to|at|through|via)\s+/i)[0].trim();
    const noun = { submit: 'submission', upload: 'upload', send: 'submission', mail: 'submission', register: 'registration', pay: 'payment', fill: 'form' }[verbObj[1].toLowerCase()];
    const objNoun = obj && /^(registration|submission|application|payment|upload|form)s?$/i.exec(obj);
    if (objNoun) return { title: `${cap(objNoun[1].toLowerCase())} deadline`, why: `"${verbObj[0]}" is a deadline.`, at: [verbObj.index, verbObj.index + verbObj[0].length] };
    if (obj && !/^\d/.test(obj)) return { title: `${cap(obj.toLowerCase())} ${noun}`, why: `"${verbObj[0]}" says what is due.`, at: [verbObj.index, verbObj.index + verbObj[0].length] };
  }
  const by = /\b(submit|register|apply|pay|upload|fill)\w*\s+(?:by|before|on or before|latest by)\b/i.exec(str);
  if (by) {
    const noun = { submit: 'Submission', register: 'Registration', apply: 'Application', pay: 'Payment', upload: 'Upload', fill: 'Form' }[by[1].toLowerCase()];
    return { title: `${noun} deadline`, why: `"${by[0]}" is a deadline.`, at: [by.index, by.index + by[0].length] };
  }
  const t = walkTitle(str, k.i, k.kw, k.fam === 'deadline');
  const subj = k.fam === 'test' && new RegExp(String.raw`${k.kw.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?:\s+\d{1,2})?\s+(?:in|of|for|on)\s+([A-Z][\w+#&.-]*(?:\s+[A-Z][\w+#&.-]*){0,3})(?=\s+(?:on|at|from|will|is|has|in|by)\b|[,.;:]|$)`).exec(str);
  if (subj) return { title: `${cap(t)}: ${subj[1]}`, why: `"${subj[0].trim()}" names the subject.`, at: [subj.index, subj.index + subj[0].length] };
  return { title: cap(t), why: `Taken from the words "${t}".` };
}

// A one-word title ("Quiz") borrows a fuller name used elsewhere in the notice ("Aptitude Quiz").
function upgradeTitle(title, text, fam, spoken = true) {
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
  // A bare "Event" is called what the rest of the notice calls it ("Hackathon registration closes ... Event on 1-2 Nov").
  const named = spoken && best === title && /^(?:event|programme?)$/i.test(title) && /\b(hackathon|fest|competition|contest|tournament|workshop|seminar|webinar|conference|symposium|orientation|convocation|challenge)\b/i.exec(text);
  if (named) {
    const t = walkTitle(text, named.index, named[0], true);
    if (t.split(' ').length <= 4) best = cap(t);
  }
  return best;
}

function venueFor(u) {
  if (u.block) {
    for (const l of u.lines) {
      const v = /(venue|place|location|platform|mode|स्थान)\s*[:\-–]\s*(.+)$/iu.exec(l.t);
      if (!v) continue;
      const val = v[2].trim(), s = l.s + l.t.indexOf(val);
      const online = ONLINE.exec(val) || /^online$/i.exec(val);
      return { venue: online && !/^online$/i.test(val) ? `Online (${val})` : val, span: [s, s + val.length], why: `"${v[1]}:" line.`, zoom: /zoom/i.test(val) };
    }
  }
  const p = PLACE.exec(u.text);
  if (p) { const s = u.s + p.index + p[0].indexOf(p[1]); return { venue: cap(p[1]), span: [s, s + p[1].length], why: `Place word found: "${p[1]}".` }; }
  const hing = HINGLISH_PLACE.exec(u.text);
  if (hing) return { venue: cap(hing[1]), span: [u.s + hing.index, u.s + hing.index + hing[1].length], why: `Place word found: "${hing[0]}".` };
  const o = ONLINE.exec(u.text);
  if (o) return { venue: `Online (${o[1]})`, span: [u.s + o.index, u.s + o.index + o[0].length], why: `"${o[1]}" means it is online.`, zoom: /zoom/i.test(o[1]) };
  const h = HINDI_PLACE.exec(u.text);
  if (h) return { venue: h[1].trim(), span: [u.s + h.index, u.s + h.index + h[1].length], why: `Place word found: "${h[1].trim()}".` };
  // A timetable cell that is only a place ("Room 101", "Lab 2", "Seminar Hall")
  if (!u.block) {
    let pos = 0;
    for (const c of u.text.split(CELL_SPLIT).map((x) => x.trim()).filter(Boolean)) {
      const i = u.text.indexOf(c, pos); pos = i + c.length;
      const m = PLACE.exec(` in ${c}`);
      if (m && m[1].length >= c.length - 2) return { venue: cap(c), span: [u.s + i, u.s + i + c.length], why: `Place column: "${c}".` };
    }
  }
  return null;
}

// A timetable row: one line, a date, a time and cells split by " - ", "|" or tabs. The subject cell is the title.
function tableRow(u, ud, ut) {
  if (u.block || !ud.some((d) => d.kind === 'abs') || !ut.length) return null;
  const cells = u.text.split(CELL_SPLIT).map((c) => c.trim()).filter(Boolean);
  if (cells.length < 3) return null;
  let pos = 0;
  for (const c of cells) {
    const i = u.text.indexOf(c, pos); pos = i + c.length;
    const s = u.s + i, e = s + c.length;
    const hasTok = [...ud, ...ut].some((t) => t.s < e && t.e > s);
    if (hasTok || WEEKDAY_WORD.test(c) || PLACE.test(` in ${c}`) || ONLINE.test(c) || /^https?:/.test(c) || !/\p{L}{2,}/u.test(c) || /^(?:sr|sl|s)\.?\s*no\.?$/i.test(c)) continue;
    return { title: c, span: [s, e] };
  }
  return null;
}

// Copy-paste noise that would change the reading: invisible characters ("1​3 Nov" read as 3 Nov) and the
// "[05/10/26, 9:14 AM] Rahul: " prefix WhatsApp puts on copied messages (its time became an event of its own).
const INVISIBLE = /[\u0000­​-‏‪-‮⁠-⁤﻿]/g;
const WA_PREFIX = /^(?:\[\d{1,2}[/.-]\d{1,2}[/.-]\d{2,4},? \d{1,2}[:.]\d{2}(?:[:.]\d{2})?(?:\s?[ap]\.?m\.?)?\]|\d{1,2}[/.-]\d{1,2}[/.-]\d{2,4}, \d{1,2}[:.]\d{2}(?:\s?[ap]\.?m\.?)? -) ?[^:\n]{1,40}: /gim;
export const cleanNotice = (text) => text.replace(INVISIBLE, '').replace(WA_PREFIX, '');

// `source`: 'ocr' or 'pdf-scan' when the text came out of a photo. Every dated event then carries one amber flag,
// because OCR errors are silent (a 3 read as 8): the student confirms each event once before anything is exported.
// result.text is the cleaned notice that every source offset points into.
export function parseNotice(text, { pastedAt = new Date(), source = 'text' } = {}) {
  if (typeof text === 'string') text = cleanNotice(text);
  const result = { anchorDate: null, events: [], pending: [], notes: [], warnings: [], text };
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
    if (d.y) { lastYear = d.y; d.why = d.numeric ? `"${d.raw}" read as day/month/year (Indian format).` : d.isoForm ? `"${d.raw}" is a year-month-day date.` : `Date written in the notice: "${d.raw.trim()}".`; }
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
  const saysToday = /\b(today|tonight)\b|आज/i.test(text);
  // "tomorrow" in a notice with a "Date:" line counts from the notice's date, like "today" does.
  const relWords = /\b(tomorrow|next day|day after tomorrow|kal|parso)\b|कल|परसों/i.test(text);
  const dateLine = /^[^\p{L}\p{N}\n]*\s*(?:date|दिनांक|तिथि)\s*[:\-–]/imu.test(text);
  const todayNear = firstAbs && /\b(?:today|tonight)['’s]*[^\n]{0,40}$|आज[^\n]{0,40}$/i.test(text.slice(Math.max(0, firstAbs.s - 60), firstAbs.s));
  const fromNotice = firstAbs && ((saysToday && (dateLine || todayNear)) || (dateLine && relWords));
  result.anchorDate = fromNotice ? firstAbs.date : pasted;
  result.anchorFromNotice = Boolean(fromNotice);
  const anchorWhy = fromNotice ? `the notice's own date (${prettyDate(firstAbs.date)})` : `the day you pasted it (${prettyDate(pasted)})`;
  for (const d of dates.filter((x) => x.kind === 'rel')) {
    if (d.weekday !== undefined) {
      const dow = weekdayOf(result.anchorDate);
      const ahead = (d.weekday - dow + 7) % 7 || (d.thisWeek ? 0 : 7);
      d.date = addDays(result.anchorDate, ahead);
      d.why = `"${d.raw}" = ${prettyDate(d.date)}, the next one after ${anchorWhy}.`;
      d.weekdayGuess = true;
      continue;
    }
    d.date = addDays(result.anchorDate, d.offset);
    d.why = d.offset === 0 ? `"${d.raw}" = ${anchorWhy}.` : `"${d.raw}" = ${d.offset} day${d.offset > 1 ? 's' : ''} after ${anchorWhy}.`;
  }

  // "Wednesday  VENUE  TIMING / 28 October 2026": a weekday just before a written date of that same weekday is the
  // date's name (posters, letters), not a day of its own. A sentence end or a time in between keeps them apart.
  for (let i = dates.length - 1; i >= 0; i--) {
    const d = dates[i];
    if (d.kind !== 'rel' || d.weekday === undefined) continue;
    const next = dates.find((x) => x.kind === 'abs' && x.s >= d.e);
    const gap = next ? text.slice(d.e, next.s) : '';
    if (next && gap.length <= 40 && !/[.!?]/.test(gap) && (gap.match(/\n/g) || []).length <= 1
      && !times.some((t) => t.s >= d.e && t.e <= next.s) && weekdayOf(next.date) === d.weekday) dates.splice(i, 1);
  }

  // 3. One candidate event per unit that has a date or time and something to call it.
  const us = splitCompound(units(text), text, times);
  const inside = (toks, u) => toks.filter((t) => t.s >= u.s && t.e <= u.e);
  const candidates = [];
  const durationsByFam = [];
  let ctxDate = null;
  let header = null; // the last event word seen on a short line with no date or time ("Exam schedule:"), for timetable rows
  let id = 0;

  for (const u of us) {
    let ud = inside(dates, u), ut = inside(times, u);
    const udur = inside(durations, u);
    const k = keyword(u.text) || (u.inherit && keyword(u.inherit));
    // "POSTPONED to 20 Nov at 11 AM": the date and time after the change are the real ones.
    const rev = REVISED.exec(u.text);
    let oldWhen = null;
    if (rev) {
      const cut = u.s + rev.index + rev[0].length;
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

    // "No classes on 14 Nov. Classes resume on 16 Nov." says what is not happening; there is nothing to add.
    if (NO_SESSION.test(u.text)) {
      result.warnings.push({ level: 'info', span: [u.s, u.e], msg: `Not added to your calendar, because it says nothing is scheduled: "${u.text.slice(0, 90).trim()}"` });
      continue;
    }
    // Cancelled items are reported, never added.
    if ((k || CLASS_WORD.test(u.text)) && CANCEL.test(u.text)) {
      result.warnings.push({ level: 'warn', span: [u.s, u.e], msg: `This part cancels something, so it is not added to your calendar: "${u.text.slice(0, 90).trim()}"` });
      continue;
    }
    // A time line with no event word ("Timings will be 9:30 AM to 12:30 PM daily") belongs to the event just above it.
    const prevEv = candidates[candidates.length - 1];
    const gap = prevEv ? us.indexOf(u) - us.indexOf(prevEv.unit) : 99;
    if (!k && !ud.length && ut.length && !u.block && prevEv && gap <= 2) {
      if (/\breport(?:ing)?\b/i.test(u.text) && prevEv.start) {
        prevEv.reportAt = ut[0].start;
        prevEv.flags.push({ field: 'start', level: 'info', msg: `Report by ${fmt12(ut[0].start)}; it starts at ${fmt12(prevEv.start)}.` });
        continue;
      }
      if (!prevEv.start && gap === 1) { setTime(prevEv, ut, u, text); continue; }
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
      if (k && !u.block && u.text.length <= 60) header = { k, unit: u };
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
    // Timetable rows: the subject cell names the event, the header line above the table gives its kind.
    const row = tableRow(u, ud, ut);
    if (row && (!kw || GENERIC.has(norm(kw.kw)) || header)) {
      const hk = kw || (header && header.k);
      const label = hk ? labelFor(hk) : null;
      const title = label && !kw && !new RegExp(`\\b${label}\\b`, 'i').test(row.title) ? `${row.title} ${label.toLowerCase()}` : row.title;
      titleInfo = { title: cap(title), why: header && !kw ? `Timetable row under "${header.unit.text.trim()}".` : 'Timetable row: the subject column names it.', span: row.span };
      if (!kw && hk) { kw = hk; titleInfo.kwSpan = [header.unit.s + hk.i, header.unit.s + hk.i + hk.kw.length]; }
    }
    if (!kw && !ut.length) continue; // a bare date with nothing happening on it
    if (!titleInfo && u.inherit && kw) {
      const subject = SUBJECT_ON.exec(u.text)[0];
      const [prefix] = titleFor(u.inherit, kw).title.split(': ');
      titleInfo = { title: `${prefix}: ${subject}`, why: `Same kind as the part before it ("${prefix}"); "${subject}" names the subject.`, span: [u.s, u.s + subject.length] };
    }
    if (!titleInfo && u.head && kw) {
      // "Internal tests: Maths on 12 Nov, Physics on 13 Nov": the first item's subject sits after the colon.
      const c = u.text.indexOf(':'), lead = c > 0 && SUBJECT_ON.exec(u.text.slice(c + 1).trimStart());
      if (lead) titleInfo = { title: `${cap(u.text.slice(0, c).trim())}: ${lead[0]}`, why: `"${lead[0]}" names the subject after "${u.text.slice(0, c).trim()}".`, span: [u.s + u.text.indexOf(lead[0], c), u.s + u.text.indexOf(lead[0], c) + lead[0].length] };
    }
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
    const wk = weeklyOf(u.text);
    if (wk) {
      weeklyDate(ev, wk, ud, result.anchorDate, u.s);
    } else if (d) {
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
      // "Thursday, 13 Nov 2026" when 13 Nov 2026 is a Friday: the notice contradicts itself.
      const named = firstDate && firstDate.kind === 'abs' && ud.find((x) => x.kind === 'rel' && x.weekday !== undefined);
      if (named && named.weekday !== weekdayOf(d.date)) {
        ev.flags.push({ field: 'date', level: 'warn', msg: `The notice says "${named.raw}" but ${prettyDate(d.date)} is a ${WEEKDAY_NAMES[weekdayOf(d.date)]}. Check which one is right.` });
      }
      if (firstDate) dayChecks(ev, d.date);
      if (d.nameFix && firstDate) ev.flags.push({ field: 'date', level: 'info', msg: `Read "${d.nameFix.from}" as ${d.nameFix.to}.` });
    } else {
      ev.flags.push({ field: 'date', level: 'warn', msg: 'No date found in this part of the notice. Pick the date.' });
    }

    // "Reporting time: 8:30 AM" beside "Time: 10:00 AM": the event starts at 10, reporting is a note.
    let utMain = ut;
    if (u.block) {
      const rl = u.lines.find((l) => /^[^\p{L}]*reporting\s*time/iu.test(l.t));
      const rep = rl && ut.find((t) => t.s >= rl.s && t.e <= rl.e);
      if (rep && ut.some((t) => t !== rep)) { utMain = ut.filter((t) => t !== rep); ev.reportAt = rep.start; }
    }
    setTime(ev, utMain, u, text);
    if (ev.reportAt) ev.flags.push({ field: 'start', level: 'info', msg: `Report by ${fmt12(ev.reportAt)}; it starts at ${fmt12(ev.start)}.` });
    if (udur.length) ev.durationMin = udur[0].minutes;
    const v = venueFor(u);
    if (v) { ev.venue = v.venue; ev.sources.venue = v.span; ev.why.venue = v.why; if (v.zoom) ev.zoom = true; }
    candidates.push(ev);
  }

  // 4. Merge mentions of the same thing, catch contradictions, attach links and durations.
  const events = [];
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
    // Two mentions of the same test merge; "Maths test" and "Physics test" at the same hour are two events, and a clash.
    const same = events.find((x) => x.family === ev.family && x.date && ev.date && sameThing(x.title, ev.title) && compatible(x, ev));
    if (same) { mergeInto(same, ev); continue; }
    const clash = events.find((x) => x.family === ev.family && x.date && ev.date && x.date !== ev.date && norm(x.title) === norm(ev.title) && x.family !== 'test' && !GENERIC.has(norm(x.title)));
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

  const subject = subjectOf(text);
  for (const ev of events) {
    // An event with no event word at all (a poster's date line) is named the same way as one called "Event".
    const full = upgradeTitle(ev.title, text, ev.family, /^Taken from|^No event word/.test(ev.why.title));
    if (full !== ev.title) { ev.why.title = `"${ev.title}" is called "${full}" elsewhere in the notice.`; ev.title = full; }
    if (subject && ev.type === 'deadline' && /^(registration|submission|application|payment|upload|form) deadline$/i.test(ev.title)) { ev.title = `${ev.title}: ${subject}`; ev.why.title += ` Named after the notice subject "${subject}".`; }
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
    if (source !== 'text' && source !== 'docx' && ev.date) ev.flags.push({ field: 'date', level: 'warn', msg: 'Read from a photo: check the date and time against the picture.' });
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

// Sunday and gazetted holidays: colleges do hold placement drives on them, so the app asks, it never moves anything.
function dayChecks(ev, date) {
  const holiday = holidayOn(date);
  if (holiday) ev.flags.push({ field: 'date', level: 'warn', msg: `${prettyDate(date)} is ${holiday}, a gazetted holiday. Confirm the college is open that day.` });
  else if (weekdayOf(date) === 0) ev.flags.push({ field: 'date', level: 'info', msg: `${prettyDate(date)} is a Sunday.` });
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
    // "starts at 10 AM and ends by 1 PM", "10 AM till 1 PM" across words: the second time is the end.
    const second = ut.find((x) => x !== t && !x.end && x.s > t.e);
    if (second && END_CUE.test(text.slice(t.e, second.s)) && toMin(second.start) > toMin(t.start)) {
      ev.end = second.start;
      ev.sources.end = second.spanStart;
      ev.why.end = `"${text.slice(t.e, second.e).trim()}" gives the end.`;
    }
  }
  if (t.military) ev.why.start = `"${t.raw.trim()}" is 24-hour time = ${fmt12(t.start)}.`;
  if (t.eod) ev.flags.push({ field: 'start', level: 'warn', msg: `"${t.raw}" read as ${fmt12(t.start)} (end of the working day). If your college means midnight, change it.` });
  else if (t.guessed) ev.flags.push({ field: 'start', level: 'warn', msg: t.session ? `${t.raw} session times differ by college; check ${fmt12(t.start)} - ${fmt12(t.end)}.` : `No AM/PM written; assumed ${fmt12(t.start)}.` });
  if (t.hinglish) ev.why.start = `Hinglish time "${t.raw}" = ${fmt12(t.start)}.`;
}

// "Every Monday and Wednesday 4-5 PM, starting 9 Nov till 20 Dec": one weekly event. `every` is the RRULE BYDAY list,
// `repeat` the number of times it happens (a notice with no end date gets four weeks, and says so).
const DAY_WORD = String.raw`(?:sun|mon|tues?|wed(?:nes)?|thu(?:rs)?|fri|sat(?:ur)?)(?:day)?\b`;
const WEEKLY = new RegExp(String.raw`\b(?:every|each|weekly on)\s+(${DAY_WORD}(?:\s*(?:,|and|&|aur)\s*${DAY_WORD})*)`, 'i');
const WEEKLY_WEEKS = 4;

function weeklyOf(str) {
  const m = WEEKLY.exec(str);
  if (!m) return null;
  const days = [...new Set(m[1].match(/sun|mon|tue|wed|thu|fri|sat/gi).map((w) => ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'].indexOf(w.toLowerCase())))].sort();
  return { days, span: [m.index, m.index + m[0].length], raw: m[0] };
}

function weeklyDate(ev, wk, ud, anchor, base) {
  const abs = ud.filter((x) => x.kind === 'abs');
  let first = abs.length ? abs[0].date : addDays(anchor, 1);
  while (!wk.days.includes(weekdayOf(first))) first = addDays(first, 1);
  const until = abs.length > 1 ? abs[abs.length - 1].date : null;
  const dates = [];
  for (let day = first; dates.length < 60 && (until ? day <= until : dates.length < wk.days.length * WEEKLY_WEEKS); day = addDays(day, 1)) {
    if (wk.days.includes(weekdayOf(day))) dates.push(day);
  }
  const names = wk.days.map((n) => WEEKDAY_NAMES[n].slice(0, 3)).join(' and ');
  ev.date = first;
  ev.every = wk.days.map((n) => DAY_CODES[n]).join(',');
  ev.repeat = dates.length;
  ev.sources.date = abs.length ? [abs[0].s, abs[0].e] : [base + wk.span[0], base + wk.span[1]];
  ev.why.date = `"${wk.raw}" repeats weekly; the first one is ${prettyDate(first)}${abs.length ? '' : ' (the next one after the notice)'}.`;
  if (until) ev.flags.push({ field: 'date', level: 'info', msg: `Every ${names} from ${prettyDate(first)} to ${prettyDate(until)} (${dates.length} times). The calendar file repeats it.` });
  else ev.flags.push({ field: 'date', level: 'warn', msg: `Every ${names}, but the notice gives no end date. Added for ${WEEKLY_WEEKS} weeks (${dates.length} times) from ${prettyDate(first)}; extend it if the course runs longer.` });
}

// Several dates in one sentence: "16 and 17 Oct" or "25 Oct to 30 Oct" is one event on every day;
// anything else is a question for the student, so it is flagged amber.
function dateSpread(ev, ud, text) {
  const abs = ud.filter((x) => x.kind === 'abs');
  if (abs.length < 2) return;
  const joins = abs.slice(1).map((x, i) => text.slice(abs[i].e, x.s));
  const joined = joins.every((j) => RANGE_JOIN.test(j));
  const days = daysBetween(abs[0].date, abs[abs.length - 1].date) + 1;
  // "16 and 17 Oct" is a run of days; "5th and 7th Nov" (a gap, joined by "and") is two separate days.
  const listed = joins.some((j) => /^\s*(?:,|and|&|aur|और|व)\s*$/i.test(j)) && days !== abs.length;
  if (listed) {
    ev.flags.push({ field: 'date', level: 'warn', msg: `This part names separate days (${abs.map((x) => prettyDate(x.date)).join(', ')}). This card is the first; add the other day with "+ Add event" if it is a separate event.` });
    return;
  }
  if (joined && days >= 2 && days <= 14) {
    ev.repeat = days; // clash.js checks every day of the run
    ev.flags.push({ field: 'date', level: 'info', msg: `Runs every day from ${prettyDate(abs[0].date)} to ${prettyDate(abs[abs.length - 1].date)} (${days} days). The calendar file repeats it.` });
  } else {
    ev.flags.push({ field: 'date', level: 'warn', msg: `This part mentions more than one date (${abs.map((x) => prettyDate(x.date)).join(', ')}). We used the first; check it.` });
  }
}

// "Notice for IKTARA Data Sciences Private Limited Placement Drive" -> "IKTARA Data Sciences Placement Drive".
function subjectOf(text) {
  const m = /^[ \t]*(?:notice|circular)\s+(?:for|regarding|about|on)\s+(.{6,100}?)[ \t]*$/im.exec(text);
  if (!m) return null;
  const s = m[1].replace(/\b(?:private limited|pvt\.?\s*ltd\.?|limited|ltd\.?)\b/gi, ' ').replace(/\s+/g, ' ').trim();
  return s.length >= 6 ? s.slice(0, 60) : null;
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
  keep.every = keep.every || other.every;
  keep.reportAt = keep.reportAt || other.reportAt;
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
