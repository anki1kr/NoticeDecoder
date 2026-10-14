// Date and time token finders. Every token keeps its [start, end) offset in the original text
// so the UI can highlight exactly the words a field came from.

const MONTHS = { jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12 };
const MONTH_NAMES = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const MON = String.raw`(jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|june?|july?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)`;

export const pad = (n) => String(n).padStart(2, '0');
export const iso = (y, m, d) => `${y}-${pad(m)}-${pad(d)}`;

export function addDays(isoDate, n) {
  const [y, m, d] = isoDate.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10);
}

export function daysBetween(a, b) {
  return Math.round((Date.parse(b) - Date.parse(a)) / 86400000);
}

export function prettyDate(isoDate) {
  const [y, m, d] = isoDate.split('-').map(Number);
  return `${d} ${MONTH_NAMES[m - 1]} ${y}`;
}

export function localISO(date) {
  return iso(date.getFullYear(), date.getMonth() + 1, date.getDate());
}

function validDate(y, m, d) {
  const dt = new Date(Date.UTC(y, m - 1, d));
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d;
}

// Absolute dates ("13 Nov 2026", "15th October, 2026", "Nov 13", "13/11/2026") and relative words.
export function findDates(text) {
  const out = [];
  const taken = [];
  const free = (s, e) => !taken.some(([a, b]) => s < b && e > a);
  const push = (tok) => { out.push(tok); taken.push([tok.s, tok.e]); };

  const dayMonth = new RegExp(String.raw`\b(\d{1,2})(?:st|nd|rd|th)?\s*(?:of\s+)?${MON}\b\.?(?:,?\s*(\d{4})\b)?`, 'gi');
  for (const m of text.matchAll(dayMonth)) {
    const d = +m[1], mo = MONTHS[m[2].slice(0, 3).toLowerCase()];
    if (d >= 1 && d <= 31) push({ kind: 'abs', s: m.index, e: m.index + m[0].length, d, m: mo, y: m[3] ? +m[3] : null, raw: m[0] });
  }
  const monthDay = new RegExp(String.raw`\b${MON}\.?\s+(\d{1,2})(?:st|nd|rd|th)?\b(?:,?\s*(\d{4})\b)?`, 'gi');
  for (const m of text.matchAll(monthDay)) {
    const s = m.index, e = s + m[0].length, d = +m[2];
    if (d >= 1 && d <= 31 && free(s, e)) push({ kind: 'abs', s, e, d, m: MONTHS[m[1].slice(0, 3).toLowerCase()], y: m[3] ? +m[3] : null, raw: m[0] });
  }
  for (const m of text.matchAll(/\b(\d{1,2})[/.-](\d{1,2})[/.-](\d{4}|\d{2})\b/g)) {
    const s = m.index, e = s + m[0].length;
    const a = +m[1], b = +m[2];
    if (!free(s, e) || a < 1 || a > 31 || b < 1 || b > 12) continue;
    const y = m[3].length === 2 ? 2000 + +m[3] : +m[3];
    // Indian notices write day first. Flag it when the other reading is also a real date.
    push({ kind: 'abs', s, e, d: a, m: b, y, raw: m[0], numeric: true, ambiguous: a <= 12 && a !== b });
  }
  // "19/10" with no year: day first, year filled in later like "13 Nov".
  for (const m of text.matchAll(/(?<![\d/.:-])(\d{1,2})\/(\d{1,2})(?![\d/])/g)) {
    const s = m.index, e = s + m[0].length, a = +m[1], b = +m[2];
    if (free(s, e) && a >= 1 && a <= 31 && b >= 1 && b <= 12) push({ kind: 'abs', s, e, d: a, m: b, y: null, raw: m[0], numeric: true, ambiguous: a <= 12 && a !== b });
  }
  // "16 and 17 Oct": the first day borrows the month and year of the second.
  for (const tok of out.filter((x) => x.kind === 'abs' && !x.numeric)) {
    const before = /(\d{1,2})(?:st|nd|rd|th)?\s*(?:and|&|,)\s*$/i.exec(text.slice(Math.max(0, tok.s - 14), tok.s));
    if (!before) continue;
    const s = tok.s - before[0].length, e = s + before[1].length;
    if (free(s, e)) push({ kind: 'abs', s, e, d: +before[1], m: tok.m, y: tok.y, raw: before[1] });
  }
  const WEEKDAYS = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
  for (const m of text.matchAll(/\b(?:(next|this|coming)\s+)?(sunday|monday|tuesday|wednesday|thursday|friday|saturday)\b/gi)) {
    const s = m.index, e = s + m[0].length;
    if (free(s, e)) push({ kind: 'rel', s, e, weekday: WEEKDAYS.indexOf(m[2].toLowerCase()), thisWeek: /this/i.test(m[1] || ''), raw: m[0] });
  }
  const rel = /\b(day after tomorrow|today['’]s|today|tonight|tomorrow|next day|parso|kal)\b/gi;
  for (const m of text.matchAll(rel)) {
    const s = m.index, e = s + m[0].length;
    if (!free(s, e)) continue;
    const w = m[1].toLowerCase().replace(/['’]s$/, '');
    const offset = { today: 0, tonight: 0, tomorrow: 1, kal: 1, 'next day': 1, parso: 2, 'day after tomorrow': 2 }[w];
    push({ kind: 'rel', s, e, offset, raw: m[0], kal: w === 'kal' });
  }
  return out.sort((x, y) => x.s - y.s);
}

const T = String.raw`(\d{1,2})(?:([:.])(\d{2}))?\s*(a\.?m\.?(?![a-z])|p\.?m\.?(?![a-z])|noon|midnight)?`;
const RANGE = new RegExp(String.raw`(?<![\d/:.])${T}\s*(?:to|till|until|upto|up to|-|–|—)\s*${T}(?![\d/])`, 'gid');
const SINGLE = new RegExp(String.raw`(?<![\d/:.])${T}(?![\d/])`, 'gid');
const BAJE = /\b(subah|savere|dopahar|shaam|sham|raat)?\s*(\d{1,2})(?::(\d{2}))?\s*baje\b/gid;

// One clock part -> {h, min, guessed} or null when it does not look like a time.
function clock(h, sep, mm, mer, borrowMer) {
  h = +h;
  const min = mm ? +mm : 0;
  const meridiem = (mer || borrowMer || '').toLowerCase().replace(/[.\s]/g, '');
  const timeLike = sep === ':' || (sep === '.' && mer) || mer;
  if (!timeLike && !borrowMer) return null;
  if (min > 59 || h > 23) return null;
  if (meridiem === 'noon') return { h: 12, min, guessed: false };
  if (meridiem === 'midnight') return { h: 0, min, guessed: false };
  if (meridiem === 'pm') return h > 12 ? null : { h: h === 12 ? 12 : h + 12, min, guessed: false };
  if (meridiem === 'am') return h > 12 ? null : { h: h === 12 ? 0 : h, min, guessed: false };
  // No AM/PM: 13-23 is 24-hour, 8-12 is morning/noon, 1-7 is college afternoon.
  if (h >= 13 || h === 0) return { h, min, guessed: false };
  if (h >= 8) return { h, min, guessed: h !== 12 };
  return { h: h + 12, min, guessed: true };
}

const hhmm = ({ h, min }) => `${pad(h)}:${pad(min)}`;

export function findTimes(text) {
  const out = [];
  const taken = [];
  const free = (s, e) => !taken.some(([a, b]) => s < b && e > a);
  const push = (tok) => { out.push(tok); taken.push([tok.s, tok.e]); };

  for (const m of text.matchAll(RANGE)) {
    const b = clock(m[5], m[6], m[7], m[8]);
    if (!b) continue;
    let a = clock(m[1], m[2], m[3], m[4], m[4] ? null : m[8]);
    if (!a) continue;
    if (!m[4] && m[8] && a.h * 60 + a.min > b.h * 60 + b.min) a = clock(m[1], m[2], m[3], 'am');
    const [s1, e1] = m.indices[1], [, e1b] = m.indices[4] || m.indices[3] || m.indices[1];
    const [s2] = m.indices[5];
    push({ s: m.index, e: m.index + m[0].length, raw: m[0], start: hhmm(a), end: hhmm(b),
      spanStart: [s1, Math.max(e1, e1b)], spanEnd: [s2, m.index + m[0].length], guessed: a.guessed || b.guessed });
  }
  for (const m of text.matchAll(SINGLE)) {
    const s = m.index, e = s + m[0].length;
    if (!free(s, e)) continue;
    const a = clock(m[1], m[2], m[3], m[4]);
    if (a) push({ s, e, raw: m[0], start: hhmm(a), end: null, spanStart: [s, e], guessed: a.guessed });
  }
  for (const m of text.matchAll(/\b(?:12\s*)?(noon|midday)\b/gi)) {
    const s = m.index, e = s + m[0].length;
    if (free(s, e)) push({ s, e, raw: m[0], start: '12:00', end: null, spanStart: [s, e], guessed: false });
  }
  for (const m of text.matchAll(BAJE)) {
    const s = m.index + (m[0].length - m[0].trimStart().length), e = m.index + m[0].length;
    if (!free(s, e)) continue;
    const part = (m[1] || '').toLowerCase();
    const mer = part === 'subah' || part === 'savere' ? 'am' : part ? 'pm' : null;
    const a = clock(m[2], ':', m[3] || '00', mer);
    if (a) push({ s, e, raw: m[0].trim(), start: hhmm(a), end: null, spanStart: [s, e], guessed: !mer && a.guessed, hinglish: true });
  }
  // FN / AN exam sessions (forenoon / afternoon). Times vary by college, so they are flagged as assumptions.
  for (const m of text.matchAll(/\b(FN|AN)\b/g)) {
    const s = m.index, e = s + 2;
    if (!free(s, e)) continue;
    const fn = m[1] === 'FN';
    push({ s, e, raw: m[1], start: fn ? '10:00' : '14:00', end: fn ? '13:00' : '17:00', spanStart: [s, e], spanEnd: [s, e], guessed: true, session: true });
  }
  return out.sort((x, y) => x.s - y.s);
}

export function findDurations(text) {
  const out = [];
  for (const m of text.matchAll(/\b(\d{1,3})\s*-?\s*(minutes?|mins?|hours?|hrs?)\b/gi)) {
    const n = +m[1];
    out.push({ s: m.index, e: m.index + m[0].length, raw: m[0], minutes: /^h/i.test(m[2]) ? n * 60 : n });
  }
  return out;
}

export function fmt12(hm) {
  if (!hm) return '';
  const [h, m] = hm.split(':').map(Number);
  return `${h % 12 || 12}:${pad(m)} ${h < 12 ? 'AM' : 'PM'}`;
}

export const toMin = (hm) => { const [h, m] = hm.split(':').map(Number); return h * 60 + m; };
export const fromMin = (n) => `${pad(Math.floor(n / 60))}:${pad(n % 60)}`;
