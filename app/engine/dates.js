// Date and time token finders. Every token keeps its [start, end) offset in the original text
// so the UI can highlight exactly the words a field came from.

import { normalizeNames } from './ocrfix.js';

const MONTHS = { jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12 };
const MONTH_NAMES = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const MON = String.raw`(jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|june?|july?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)`;
// Hindi month names (Devanagari), common spellings. Keys are the month numbers.
const HINDI_MONTHS = [
  [1, 'जनवरी'], [2, 'फरवरी'], [2, 'फ़रवरी'], [3, 'मार्च'], [4, 'अप्रैल'], [5, 'मई'], [6, 'जून'], [7, 'जुलाई'], [8, 'अगस्त'],
  [9, 'सितंबर'], [9, 'सितम्बर'], [10, 'अक्टूबर'], [10, 'अक्तूबर'], [11, 'नवंबर'], [11, 'नवम्बर'], [12, 'दिसंबर'], [12, 'दिसम्बर'],
];
const HMON = `(${HINDI_MONTHS.map(([, n]) => n).join('|')})`;
export const WEEKDAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

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

// 0 = Sunday ... 6 = Saturday, for an ISO date.
export const weekdayOf = (isoDate) => new Date(`${isoDate}T00:00:00Z`).getUTCDay();

function validDate(y, m, d) {
  const dt = new Date(Date.UTC(y, m - 1, d));
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d;
}

// Devanagari digits -> ASCII, same length, so every offset still points at the same characters.
export const asciiDigits = (text) => text.replace(/[०-९]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0x966 + 48));

// "7/10 marks", "Unit 3/4", "Round 1/3": a fraction or a part number, not a date.
const NOT_A_DATE_BEFORE = /\b(?:minimum|min\.?|marks?|scored?|scores?|cgpa|sgpa|attendance|out of|unit|units|round|page|pages|part|phase|step|sem(?:ester)?|module|chapter|lab|section|batch|week|sl\.?\s*no\.?|s\.?\s*no\.?|q(?:uestion)?)\s*[:#-]?\s*$/i;
const NOT_A_DATE_AFTER = /^\s*(?:marks?|%|percent|points?|cgpa)\b/i;

// Absolute dates ("13 Nov 2026", "15th October, 2026", "Nov 13", "13/11/2026", "2026-11-13", "13 नवंबर 2026") and relative words.
// A misspelt month or weekday ("Nvo", "Thrusday") is corrected in place, same length, so offsets never move; the token
// that covers it carries `nameFix` so the engine can tell the student what it read.
export function findDates(text) {
  const normalized = normalizeNames(asciiDigits(text));
  text = normalized.text;
  const out = findDatesIn(text);
  for (const tok of out) {
    const fix = normalized.fixes.find((f) => f.s < tok.e && f.e > tok.s);
    if (fix) tok.nameFix = fix;
  }
  // "31 Feb" is not a day: drop it, so the event asks for a date instead of exporting one that does not exist.
  return out.filter((t) => t.kind !== 'abs' || validDate(t.y ?? 2024, t.m, t.d));
}

function findDatesIn(text) {
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
  // Hindi: "13 नवंबर 2026", "१३ नवम्बर"
  const hindiDayMonth = new RegExp(String.raw`(?<!\d)(\d{1,2})\s*${HMON}(?:,?\s*(\d{4})(?!\d))?`, 'gu');
  for (const m of text.matchAll(hindiDayMonth)) {
    const s = m.index, e = s + m[0].length, d = +m[1];
    const mo = HINDI_MONTHS.find(([, n]) => n === m[2])[0];
    if (d >= 1 && d <= 31 && free(s, e)) push({ kind: 'abs', s, e, d, m: mo, y: m[3] ? +m[3] : null, raw: m[0], hindi: true });
  }
  // ISO "2026-11-13" (portals, Google Forms, email headers). Never ambiguous.
  for (const m of text.matchAll(/(?<![\d-])(\d{4})-(\d{2})-(\d{2})(?![\d-])/g)) {
    const s = m.index, e = s + m[0].length, y = +m[1], mo = +m[2], d = +m[3];
    if (free(s, e) && validDate(y, mo, d) && y >= 2000 && y <= 2099) push({ kind: 'abs', s, e, d, m: mo, y, raw: m[0], isoForm: true });
  }
  for (const m of text.matchAll(/\b(\d{1,2})[/.-](\d{1,2})[/.-](\d{4}|\d{2})\b/g)) {
    const s = m.index, e = s + m[0].length;
    const a = +m[1], b = +m[2];
    if (!free(s, e) || a < 1 || a > 31 || b < 1 || b > 12) continue;
    const y = m[3].length === 2 ? 2000 + +m[3] : +m[3];
    // Indian notices write day first. Flag it when the other reading is also a real date.
    push({ kind: 'abs', s, e, d: a, m: b, y, raw: m[0], numeric: true, ambiguous: a <= 12 && a !== b });
  }
  // "19/10" with no year: day first, year filled in later like "13 Nov". "7/10 marks" and "Unit 3/4" are skipped.
  for (const m of text.matchAll(/(?<![\d/.:-])(\d{1,2})\/(\d{1,2})(?![\d/])/g)) {
    const s = m.index, e = s + m[0].length, a = +m[1], b = +m[2];
    if (!free(s, e) || a < 1 || a > 31 || b < 1 || b > 12) continue;
    if (NOT_A_DATE_BEFORE.test(text.slice(Math.max(0, s - 24), s)) || NOT_A_DATE_AFTER.test(text.slice(e, e + 12))) continue;
    push({ kind: 'abs', s, e, d: a, m: b, y: null, raw: m[0], numeric: true, ambiguous: a <= 12 && a !== b });
  }
  // "16 and 17 Oct": the first day borrows the month and year of the second.
  for (const tok of out.filter((x) => x.kind === 'abs' && !x.numeric && !x.isoForm)) {
    const before = /(\d{1,2})(?:st|nd|rd|th)?\s*(?:and|&|,|aur|व|और)\s*$/i.exec(text.slice(Math.max(0, tok.s - 14), tok.s));
    if (!before) continue;
    const s = tok.s - before[0].length, e = s + before[1].length;
    if (free(s, e)) push({ kind: 'abs', s, e, d: +before[1], m: tok.m, y: tok.y, raw: before[1] });
  }
  const WEEKDAYS = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
  for (const m of text.matchAll(/\b(?:(next|this|coming)\s+)?(sunday|monday|tuesday|wednesday|thursday|friday|saturday|sun|mon|tue|tues|wed|thu|thur|thurs|fri|sat)\b/gi)) {
    const s = m.index, e = s + m[0].length;
    const w = m[2].toLowerCase().slice(0, 3);
    const weekday = WEEKDAYS.findIndex((d) => d.startsWith(w));
    // Short forms only count when they stand beside a date or a comma ("Mon 19/10", "Thu, 13 Nov"), not "Sat" in a sentence.
    const short = m[2].length <= 5;
    if (short && !/^[\s,.]*\d/.test(text.slice(e, e + 4)) && !/\d[\s,]*$/.test(text.slice(Math.max(0, s - 3), s))) continue;
    if (free(s, e)) push({ kind: 'rel', s, e, weekday, thisWeek: /this/i.test(m[1] || ''), raw: m[0] });
  }
  const hindiDays = [['रविवार', 0], ['सोमवार', 1], ['मंगलवार', 2], ['बुधवार', 3], ['गुरुवार', 4], ['बृहस्पतिवार', 4], ['शुक्रवार', 5], ['शनिवार', 6]];
  for (const [name, weekday] of hindiDays) {
    for (const m of text.matchAll(new RegExp(name, 'gu'))) {
      const s = m.index, e = s + m[0].length;
      if (free(s, e)) push({ kind: 'rel', s, e, weekday, thisWeek: false, raw: m[0] });
    }
  }
  const rel = /\b(day after tomorrow|today['’]s|today|tonight|tomorrow|next day|parso|kal)\b|(?<![ऀ-ॿ])(आज|कल|परसों)(?![ऀ-ॿ])/gi;
  for (const m of text.matchAll(rel)) {
    const s = m.index, e = s + m[0].length;
    if (!free(s, e)) continue;
    const w = (m[1] || m[2]).toLowerCase().replace(/['’]s$/, '');
    const offset = { today: 0, tonight: 0, tomorrow: 1, kal: 1, 'next day': 1, parso: 2, 'day after tomorrow': 2, 'आज': 0, 'कल': 1, 'परसों': 2 }[w];
    push({ kind: 'rel', s, e, offset, raw: m[0], kal: w === 'kal' || w === 'कल' });
  }
  return out.sort((x, y) => x.s - y.s);
}

const T = String.raw`(\d{1,2})(?:([:.])(\d{2}))?\s*(a\.?m\.?(?![a-z])|p\.?m\.?(?![a-z])|noon|midnight)?`;
const RANGE = new RegExp(String.raw`(?<![\d/:.])${T}\s*(?:to|till|until|upto|up to|se|-|–|—|~)\s*${T}(?![\d/])`, 'gid');
const BETWEEN = new RegExp(String.raw`\b(?:between|b\/w)\s+${T}\s*(?:and|&)\s*${T}(?![\d/])`, 'gid');
const SINGLE = new RegExp(String.raw`(?<![\d/:.])${T}(?![\d/])`, 'gid');
const BAJE = /\b(subah|savere|dopahar|shaam|sham|raat)?\s*(\d{1,2})(?::(\d{2}))?\s*baje\b/gid;
const HINDI_BAJE = /(सुबह|सवेरे|दोपहर|शाम|रात)?\s*(\d{1,2})(?:[:.](\d{2}))?\s*बजे/gu;
// "0700 hrs", "0930 hours", "1400hrs": 24-hour clock written without a colon (NCC, sports, hostel notices).
const MILITARY = /\b([01]\d|2[0-3])([0-5]\d)\s*(?:hrs|hours)\b\.?/gi;
// "by EOD", "end of day", "end of the day": the end of the working day. Flagged, because colleges differ.
const EOD = /\b(?:EOD|COB|end of (?:the )?(?:day|business))\b/gi;

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
  text = asciiDigits(text);
  const out = [];
  const taken = [];
  const free = (s, e) => !taken.some(([a, b]) => s < b && e > a);
  const push = (tok) => { out.push(tok); taken.push([tok.s, tok.e]); };

  for (const re of [RANGE, BETWEEN]) {
    for (const m of text.matchAll(re)) {
      if (!free(m.index, m.index + m[0].length)) continue;
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
  }
  for (const m of text.matchAll(MILITARY)) {
    const s = m.index, e = s + m[0].length;
    if (free(s, e)) push({ s, e, raw: m[0], start: `${m[1]}:${m[2]}`, end: null, spanStart: [s, e], guessed: false, military: true });
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
  for (const m of text.matchAll(EOD)) {
    const s = m.index, e = s + m[0].length;
    if (free(s, e)) push({ s, e, raw: m[0], start: '17:00', end: null, spanStart: [s, e], guessed: true, eod: true });
  }
  for (const m of text.matchAll(BAJE)) {
    const s = m.index + (m[0].length - m[0].trimStart().length), e = m.index + m[0].length;
    if (!free(s, e)) continue;
    const part = (m[1] || '').toLowerCase();
    const mer = part === 'subah' || part === 'savere' ? 'am' : part ? 'pm' : null;
    const a = clock(m[2], ':', m[3] || '00', mer);
    if (a) push({ s, e, raw: m[0].trim(), start: hhmm(a), end: null, spanStart: [s, e], guessed: !mer && a.guessed, hinglish: true });
  }
  for (const m of text.matchAll(HINDI_BAJE)) {
    const s = m.index + (m[0].length - m[0].trimStart().length), e = m.index + m[0].length;
    if (!free(s, e)) continue;
    const part = m[1] || '';
    const mer = part === 'सुबह' || part === 'सवेरे' ? 'am' : part ? 'pm' : null;
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
  text = asciiDigits(text);
  const out = [];
  // "60 min", "2 hours", "1.5 hrs", "2 घंटे", "30 मिनट". Not "10:00 hrs" (a clock time) and not "0700 hrs".
  for (const m of text.matchAll(/(?<![\d:.])(\d{1,3}(?:\.5)?)\s*-?\s*(minutes?|mins?|hours?|hrs?|घंटे|घंटा|मिनट)(?![a-z])/gi)) {
    if (/\b(?:[01]\d|2[0-3])[0-5]\d$/.test(m[1])) continue;
    const n = +m[1];
    const hours = /^h/i.test(m[2]) || /^घं/.test(m[2]);
    out.push({ s: m.index, e: m.index + m[0].length, raw: m[0], minutes: Math.round(hours ? n * 60 : n) });
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
