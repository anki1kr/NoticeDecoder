/* Notice Decoder engine, bundled from app/engine/*.js by tools/bundle-engine.mjs. Do not edit: edit the modules. */
(function (root) {
'use strict';

// ---- ocrfix.js ----
const __ocrfix = (() => {
  // Text repair, no AI, two layers:
  //  1. fixOcrText(text): for text that came out of OCR or a PDF. Fixes the classic confusions (O/0, l/1/I inside numbers,
  //     "1O:OO", "l3 Nov"), spacing and line joins. May change the length: the host shows the fixed text to the user and
  //     parses THAT, so highlight offsets stay right.
  //  2. normalizeNames(text): for ANY text. A misspelt month or weekday ("Nvo", "Thrusday", "Sepetmber") is replaced
  //     in place by the right spelling, SAME length only, so every offset in the notice is unchanged. Returns the fixes
  //     so the engine can say "read 'Nvo' as Nov".
  const MONTHS = ['january', 'february', 'march', 'april', 'may', 'june', 'july', 'august', 'september', 'october', 'november', 'december'];
  const DAYS = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
  const SHORT = ['jan', 'feb', 'mar', 'apr', 'jun', 'jul', 'aug', 'sep', 'sept', 'oct', 'nov', 'dec', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'];
  const NAMES = [...MONTHS, ...DAYS, ...SHORT];
  const EXACT = new Set(NAMES);
  // Ordinary English words one edit away from a name, never "corrected".
  const PROTECT = new Set('many mat may mar map man mad jun jul jan june bar car far jar war oar out oct act dot not nor now new nov sum sun son fun run gun bun sat set sit sot fat hat cat rat sap see sea sew set wet web wed bed fed led fee fri fry dry try thu the thy tue toe tie tea mon moon mop mom aug dug bug hug mug sep step dec deck apr art ape'.split(' '));

  // Damerau-Levenshtein distance 1? (one substitution, insertion, deletion or adjacent transposition)
  function editDistance1(a, b) {
    if (a === b) return false;
    const la = a.length, lb = b.length;
    if (Math.abs(la - lb) > 1) return false;
    if (la === lb) {
      const diff = [];
      for (let i = 0; i < la; i++) if (a[i] !== b[i]) diff.push(i);
      if (diff.length === 1) return true;
      return diff.length === 2 && diff[1] === diff[0] + 1 && a[diff[0]] === b[diff[1]] && a[diff[1]] === b[diff[0]];
    }
    const [s, l] = la < lb ? [a, b] : [b, a];
    let i = 0, j = 0, skipped = false;
    while (i < s.length && j < l.length) {
      if (s[i] === l[j]) { i++; j++; continue; }
      if (skipped) return false;
      skipped = true; j++;
    }
    return true;
  }

  // Same-length correction of month/weekday names. { text, fixes: [{ s, e, from, to }] }
  function normalizeNames(text) {
    const fixes = [];
    const swapped = (a, b) => a.length === b.length && a !== b && [...a].some((_, i) => i < a.length - 1 && a.slice(0, i) + a[i + 1] + a[i] + a.slice(i + 2) === b);
    const out = text.replace(/[A-Za-z]{3,9}/g, (word, index) => {
      const lower = word.toLowerCase();
      if (EXACT.has(lower) || PROTECT.has(lower)) return word;
      // 3-letter short forms only by an adjacent swap ("Nvo", "Ocr" -> no: "Oct" needs a substitution, too risky)
      const hit = NAMES.find((n) => n.length === lower.length && (n.length >= 4 ? editDistance1(lower, n) : swapped(lower, n)));
      if (!hit) return word;
      // Keep the writer's capitalisation pattern (first letter) so the regexes and the highlight look the same.
      const fixed = word[0] === word[0].toUpperCase() ? hit[0].toUpperCase() + hit.slice(1) : hit;
      fixes.push({ s: index, e: index + word.length, from: word, to: fixed });
      return fixed;
    });
    return { text: out, fixes };
  }

  // OCR confusions. Only touches runs that are clearly numeric contexts, never ordinary words.
  function fixOcrText(raw) {
    let t = String(raw || '').replace(/\r\n?/g, '\n');
    // Letters inside digit groups: 1O:OO, l3, 2O26, O9:3O, 1l:30
    const digitish = (s) => s.replace(/[OoDQ]/g, '0').replace(/[lI|!]/g, '1').replace(/[Ss]/g, '5').replace(/[Bb]/g, '8').replace(/[Zz]/g, '2');
    t = t.replace(/\b(?=[\dOolI|!SsBbZz]{1,4}[:.][\dOolI|!SsBbZz]{2}\b)([\dOolI|!SsBbZz]{1,2})([:.])([\dOolI|!SsBbZz]{2})\b/g, (m, h, sep, mm) => `${digitish(h)}:${digitish(mm)}`);
    t = t.replace(/\b([\dOolI|!]{1,2})(st|nd|rd|th)?(?=\s+(?:jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\b)/gi, (m, d, suf) => `${digitish(d)}${suf || ''}`);
    t = t.replace(/\b(?:jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\.?,?\s+([\dOolI|!]{4})\b/gi, (m, y) => m.replace(y, digitish(y)));
    t = t.replace(/\b([\dOolI|!]{1,2})([/.-])([\dOolI|!]{1,2})\2([\dOolI|!]{2,4})\b/g, (m, a, sep, b, y) => `${digitish(a)}${sep}${digitish(b)}${sep}${digitish(y)}`);
    t = t.replace(/\b2[0O][0-9O]{2}\b/g, (m) => digitish(m)); // 2O26
    // AM/PM glued or dotted oddly: "10:00AM", "10:00 A.M", "10:00 am."
    t = t.replace(/(\d)\s*([AaPp])\s*\.?\s*([Mm])\b\.?/g, '$1 $2$3');
    // Comma without a space after a month, "Nov,2026" -> "Nov, 2026"; "Room204" -> "Room 204"
    t = t.replace(/\b(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)([a-z]*),(\d)/gi, '$1$2, $3');
    // "Room2O4", "Lab l2", "Hall B": a room number with a digit in it gets its letters fixed and a space after the word
    t = t.replace(/\b(Room|Hall|Lab|Block|LT|CR|Seminar Hall)\s*(?=[\dOolI|!]*\d)([\dOolI|!]{1,4})([A-Za-z]?)\b/g, (m, w, n, suf) => `${w} ${digitish(n)}${suf}`);
    // Time range dashes read as other marks: "10:00 ~ 11:30", "10:00 _ 11:30", "10:00 — 11:30"
    t = t.replace(/(\d|\b[AaPp]\.?[Mm]\.?)\s*[~_–—‐‑]\s*(\d)/g, '$1 - $2');
    // A line that ends with a hyphenated word break continues on the next line: "submit-\nted" -> "submitted"
    t = t.replace(/([a-z])-\n([a-z])/g, '$1$2');
    // Stray pipes and box-drawing from table edges, bullets read as letters
    t = t.replace(/^[|¦]+\s*|\s*[|¦]+$/gm, '').replace(/\s*[|¦]\s*/g, '  ');
    t = t.replace(/^[•●■□▪·*]+\s*/gm, '- ');
    // Collapse spaces, trim lines, drop runs of blank lines
    t = t.split('\n').map((l) => l.replace(/[ \t]{2,}/g, '  ').trim()).join('\n').replace(/\n{3,}/g, '\n\n').trim();
    // Dewrap: a photo or PDF breaks sentences at the paper's edge. Join a line to the next when it does not end a
    // sentence and the next line is plain prose (not a "Date:" label, a bullet, a heading or a timetable row).
    const lines = t.split('\n');
    const label = /^[^\p{L}\p{N}]*(date|day|time|timings?|venue|place|location|platform|mode|eligibility|duration|reporting time|note)\s*[:\-–]/iu;
    const heading = (l) => l.length <= 40 && l === l.toUpperCase() && /[A-Z]/.test(l);
    const row = (l) => /\s{2}|\s[-|]\s/.test(l) && /\d/.test(l);
    const out = [];
    for (const line of lines) {
      const prev = out[out.length - 1];
      if (prev && prev.trim() && line.trim() && !/[.!?;:]$/.test(prev) && !heading(prev) && !label.test(line) && !/^[-*•]\s/.test(line) && !heading(line) && !row(prev) && !row(line)) {
        out[out.length - 1] = `${prev} ${line}`;
      } else {
        out.push(line);
      }
    }
    return out.join('\n');
  }

  return { normalizeNames, fixOcrText };
})();

// ---- dates.js ----
const __dates = (() => {
  const { normalizeNames } = __ocrfix;
  // Date and time token finders. Every token keeps its [start, end) offset in the original text
  // so the UI can highlight exactly the words a field came from.


  const MONTHS = { jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12 };
  const MONTH_NAMES = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const MON = String.raw`(jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|june?|july?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)`;
  // Hindi month names (Devanagari), common spellings. Keys are the month numbers.
  const HINDI_MONTHS = [
    [1, 'जनवरी'], [2, 'फरवरी'], [2, 'फ़रवरी'], [3, 'मार्च'], [4, 'अप्रैल'], [5, 'मई'], [6, 'जून'], [7, 'जुलाई'], [8, 'अगस्त'],
    [9, 'सितंबर'], [9, 'सितम्बर'], [10, 'अक्टूबर'], [10, 'अक्तूबर'], [11, 'नवंबर'], [11, 'नवम्बर'], [12, 'दिसंबर'], [12, 'दिसम्बर'],
  ];
  const HMON = `(${HINDI_MONTHS.map(([, n]) => n).join('|')})`;
  const WEEKDAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

  const pad = (n) => String(n).padStart(2, '0');
  const iso = (y, m, d) => `${y}-${pad(m)}-${pad(d)}`;

  function addDays(isoDate, n) {
    const [y, m, d] = isoDate.split('-').map(Number);
    return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10);
  }

  function daysBetween(a, b) {
    return Math.round((Date.parse(b) - Date.parse(a)) / 86400000);
  }

  function prettyDate(isoDate) {
    const [y, m, d] = isoDate.split('-').map(Number);
    return `${d} ${MONTH_NAMES[m - 1]} ${y}`;
  }

  function localISO(date) {
    return iso(date.getFullYear(), date.getMonth() + 1, date.getDate());
  }

  // 0 = Sunday ... 6 = Saturday, for an ISO date.
  const weekdayOf = (isoDate) => new Date(`${isoDate}T00:00:00Z`).getUTCDay();
  const DAY_CODES = ['SU', 'MO', 'TU', 'WE', 'TH', 'FR', 'SA'];

  // The dates an event happens on: `repeat` days in a row, or, with `every` ("MO,WE"), `repeat` times on those weekdays.
  function occurrences(e) {
    const n = Math.max(1, Math.min(Number(e.repeat) || 1, 60));
    if (!e.every) return Array.from({ length: Math.min(n, 31) }, (_, k) => addDays(e.date, k));
    const days = e.every.split(',').map((c) => DAY_CODES.indexOf(c));
    const out = [];
    for (let d = e.date; out.length < n && out.length < 366; d = addDays(d, 1)) if (days.includes(weekdayOf(d))) out.push(d);
    return out;
  }

  function validDate(y, m, d) {
    const dt = new Date(Date.UTC(y, m - 1, d));
    return dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d;
  }

  // Devanagari digits -> ASCII, same length, so every offset still points at the same characters.
  const asciiDigits = (text) => text.replace(/[०-९]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0x966 + 48));

  // "7/10 marks", "Unit 3/4", "Round 1/3": a fraction or a part number, not a date.
  const NOT_A_DATE_BEFORE = /\b(?:minimum|min\.?|marks?|scored?|scores?|cgpa|sgpa|attendance|out of|unit|units|round|page|pages|part|phase|step|sem(?:ester)?|module|chapter|lab|section|batch|week|sl\.?\s*no\.?|s\.?\s*no\.?|q(?:uestion)?)\s*[:#-]?\s*$/i;
  const NOT_A_DATE_AFTER = /^\s*(?:marks?|%|percent|points?|cgpa)\b/i;

  // Absolute dates ("13 Nov 2026", "15th October, 2026", "Nov 13", "13/11/2026", "2026-11-13", "13 नवंबर 2026") and relative words.
  // A misspelt month or weekday ("Nvo", "Thrusday") is corrected in place, same length, so offsets never move; the token
  // that covers it carries `nameFix` so the engine can tell the student what it read.
  function findDates(text) {
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
    // "16 and 17 Oct", "1-2 Nov", "5th & 6th Dec", "8, 9 and 10 Nov": each day borrows the month and year of the next.
    const lists = out.filter((x) => x.kind === 'abs' && !x.numeric && !x.isoForm);
    for (let i = 0; i < lists.length; i++) {
      const tok = lists[i];
      const before = /(\d{1,2})((?:st|nd|rd|th)?)\s*(?:and|&|,|aur|व|और|-|–|—|to|till|until)\s*$/i.exec(text.slice(Math.max(0, tok.s - 16), tok.s));
      if (!before) continue;
      const s = tok.s - before[0].length, e = s + before[1].length + before[2].length;
      if (!free(s, e)) continue;
      const day = { kind: 'abs', s, e, d: +before[1], m: tok.m, y: tok.y, raw: before[1] };
      push(day);
      lists.push(day);
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

  function findTimes(text) {
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

  function findDurations(text) {
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

  function fmt12(hm) {
    if (!hm) return '';
    const [h, m] = hm.split(':').map(Number);
    return `${h % 12 || 12}:${pad(m)} ${h < 12 ? 'AM' : 'PM'}`;
  }

  const toMin = (hm) => { const [h, m] = hm.split(':').map(Number); return h * 60 + m; };
  const fromMin = (n) => `${pad(Math.floor(n / 60))}:${pad(n % 60)}`;

  return { WEEKDAY_NAMES, pad, iso, addDays, daysBetween, prettyDate, localISO, weekdayOf, DAY_CODES, occurrences, asciiDigits, findDates, findTimes, findDurations, fmt12, toMin, fromMin };
})();

// ---- holidays.js ----
const __holidays = (() => {
  // Gazetted holidays (Government of India list) for the academic years the app will see.
  // Used only to ASK: an event on one of these days gets an amber "confirm the college is open" flag,
  // it is never moved or dropped. Colleges add state and restricted holidays of their own, so edit this
  // list from the college's academic calendar. Lunar dates can shift by a day; those are marked "approx".
  const HOLIDAYS = {
    '2026-01-26': 'Republic Day',
    '2026-03-04': 'Holi',
    '2026-03-20': 'Eid ul-Fitr (approx.)',
    '2026-03-31': 'Mahavir Jayanti',
    '2026-04-03': 'Good Friday',
    '2026-05-01': 'Buddha Purnima',
    '2026-05-27': 'Eid ul-Adha (approx.)',
    '2026-08-15': 'Independence Day',
    '2026-09-04': 'Janmashtami',
    '2026-09-14': 'Ganesh Chaturthi',
    '2026-10-02': 'Gandhi Jayanti',
    '2026-10-20': 'Dussehra',
    '2026-11-08': 'Diwali',
    '2026-11-24': 'Guru Nanak Jayanti',
    '2026-12-25': 'Christmas',
    '2027-01-26': 'Republic Day',
    '2027-03-22': 'Holi',
    '2027-08-15': 'Independence Day',
    '2027-10-02': 'Gandhi Jayanti',
    '2027-10-09': 'Dussehra',
    '2027-10-29': 'Diwali',
    '2027-12-25': 'Christmas',
  };

  const holidayOn = (isoDate) => HOLIDAYS[isoDate] || null;

  return { HOLIDAYS, holidayOn };
})();

// ---- parse.js ----
const __parse = (() => {
  const { findDates, findTimes, findDurations, iso, addDays, daysBetween, prettyDate, localISO, fmt12, toMin, fromMin, weekdayOf, WEEKDAY_NAMES, DAY_CODES } = __dates;
  const { holidayOn } = __holidays;
  // Notice -> events. Pure rules, no AI: every field records the rule that set it (why) and the
  // exact words it came from (sources), so the UI can explain and highlight each result.


  // Keyword families, checked in this order. type = one of the problem statement's types.
  const FAMILIES = [
    // A deadline phrase wins over the topic it is about: "last date to pay the exam fee" is a deadline, not an exam.
    { fam: 'deadline', type: 'deadline', re: /\b(last date|last day|deadline|due date|(?:submit|register|apply|pay|upload|fill|collect|return|send|mail|complete|deposit)\w*\s+(?:by|before|on or before|latest by)|(?:must|should|have to|has to|need to|needs to|are to|is to)\s+be\s+\w+(?:ed|t)\b[^.\n]{0,40}?\b(?:by|before|latest by|on or before)\b|clos(?:es|ing date))\b/i },
    { fam: 'deadline', type: 'deadline', re: /(अंतिम तिथि|अंतिम दिनांक|जमा करन[ेा]|जमा कर)/u },
    { fam: 'gd', type: 'test', re: /\b(?:[Gg]roup [Dd]iscussions?|GD)\b/ },
    { fam: 'interview', type: 'test', re: /\binterviews?\b/i },
    { fam: 'results', type: 'other', re: /\bresults?\b|परिणाम/i },
    { fam: 'test', type: 'test', re: /\b(practical vivas?|lab vivas?|internal tests?|unit tests?|class tests?|slip tests?|surprise tests?|mock tests?|mid[- ]?(?:terms?|sems?|semesters?)(?: exams?| tests?)?|sessionals?(?: exams?)?|end[- ]?sem(?:ester)?(?: (?:exams?|practicals?))?|semester exams?|model exams?|lab exams?|re-?exams?|supplementary(?: exams?)?|backlog exams?|internal assessments?|examinations?|exams?|tests?|quiz(?:zes)?|viva(?: voce)?|practicals?|assessments?|aptitude|olympiad)\b/i },
    { fam: 'test', type: 'test', re: /(परीक्षा|टेस्ट|क्विज़|क्विज|प्रैक्टिकल|मौखिकी)/u },
    // Exam acronyms are case-sensitive on purpose: "see" and "cat" are ordinary words.
    { fam: 'test', type: 'test', re: /\b(CIE|SEE|CAT[- ]?[12]|FAT|MST|EST)\b/ },
    { fam: 'deadline', type: 'deadline', re: /\b(submissions?|submit(?:ted)?|upload(?:ed|ing)?|deadline|last date|due(?! to)(?: date)?|registrations?|fee payment|fees?|pay(?:ment)?)\b/i },
    { fam: 'lecture', type: 'lecture', re: /\b((?:extra|remedial|make-?up|doubt|revision|bridge|special|additional|compensatory|substitute)\s+(?:class(?:es)?|lectures?|sessions?)|guest lectures?|expert lectures?|lectures?|classes|courses?|tutorials?|seminars?(?!\s+(?:hall|room))|webinars?|workshops?|masterclass(?:es)?|bootcamps?|sessions?|orientation|induction|talks?|trainings?)\b/i },
    { fam: 'lecture', type: 'lecture', re: /(व्याख्यान|कक्षा|सेमिनार|कार्यशाला|वेबिनार|सत्र)/u },
    { fam: 'other', type: 'other', re: /\b(placement drives?|campus drives?|pool campus|drives?|fests?|hackathons?|(?:industrial|field|educational|study)\s+(?:visits?|trips?|tours?)|excursions?|meetings?|ceremony|convocation|competitions?|sports day|annual day|farewell|freshers?(?:['’]s)? party|cultural (?:fest|event|night)|parade|camp|joining(?: dates?)?|(?:project )?reviews?|presentations?|events?)\b/i },
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
  const PLACE = /(?:\b(?:in|at|to|from|inside|near)\s+(?:the\s+)?|\bvenue(?:\s+(?:remains|is|will be))?\s*[:\-–]?\s*|📍\s*|,\s*)((?:[A-Za-z]+\s+){0,2}?(?:(?:room|hall|lab|laboratory|auditorium|office|block|ground|library|classroom|campus|centre|center|building|theatre|theater)(?:\s+[A-H]\b(?:-?\d{1,3})?|\s*(?:no\.?\s*)?[A-Z]?-?(?:\d{1,4}[A-Za-z]?|[IVX]{1,4}))?|(?:LT|CR|SH|LH|TH)[- ]?(?:\d{1,3}|[IVX]{1,4})\b))\b/i;
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
    const named = spoken && best === title && /^(?:event|programme?)$/i.test(title) && /\b(hackathon|fest|competition|contest|tournament|workshop|seminar|webinar|conference|symposium|orientation|convocation)\b/i.exec(text);
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
  const cleanNotice = (text) => text.replace(INVISIBLE, '').replace(WA_PREFIX, '');

  // `source`: 'ocr' or 'pdf-scan' when the text came out of a photo. Every dated event then carries one amber flag,
  // because OCR errors are silent (a 3 read as 8): the student confirms each event once before anything is exported.
  // result.text is the cleaned notice that every source offset points into.
  function parseNotice(text, { pastedAt = new Date(), source = 'text' } = {}) {
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
      const full = upgradeTitle(ev.title, text, ev.family, /^Taken from/.test(ev.why.title));
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
      if (source !== 'text' && ev.date) ev.flags.push({ field: 'date', level: 'warn', msg: 'Read from a photo: check the date and time against the picture.' });
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

  return { cleanNotice, parseNotice };
})();

// ---- clash.js ----
const __clash = (() => {
  const { toMin, fromMin, fmt12, occurrences, prettyDate } = __dates;
  // Clash rules from the problem statement:
  // two events clash when each starts before the other ends; a deadline (or any "by" time) is a point
  // and clashes when it falls inside another event.

  // A deadline or a "by 9 PM" time is a point. Any other event without an end lasts its duration, or 1 hour,
  // the same length the calendar file and the timeline use.
  const isPoint = (e) => e.type === 'deadline' || Boolean(e.point);
  const endOf = (e) => (e.end && toMin(e.end) > toMin(e.start) ? toMin(e.end) : toMin(e.start) + (e.durationMin || 60));
  const span = (e) => (isPoint(e) ? [toMin(e.start), toMin(e.start)] : [toMin(e.start), endOf(e)]);
  const name = (e, other) => (e.typeLabel && other.typeLabel && e.typeLabel !== other.typeLabel ? `the ${e.typeLabel.toLowerCase()}` : `"${e.title}"`);

  function range(a, b) {
    const [fa, fb] = [fmt12(fromMin(a)), fmt12(fromMin(b))];
    return fa.slice(-2) === fb.slice(-2) ? `${fa.slice(0, -3)} to ${fb}` : `${fa} to ${fb}`;
  }

  // Latest moment before `t` that is not inside any timed event of that day.
  function freeBefore(t, sameDay) {
    let edge = t;
    let moved = true;
    while (moved) {
      moved = false;
      for (const e of sameDay) {
        const [s, en] = span(e);
        if (!isPoint(e) && s < edge && en >= edge) { edge = s; moved = true; }
      }
    }
    return edge;
  }

  function findClashes(events) {
    // An end before the start (a typo, or an edit in progress) counts as "no end", exactly as the timeline draws it.
    // A multi-day event (repeat = n days, "practicals 25 to 30 Oct") is checked on every day it runs: a row's `date`
    // says which day the clash is on, so a one-day exam inside a six-day practical run is reported.
    const timed = [];
    for (const e of events) {
      if (!e.date || !e.start) continue;
      occurrences(e).forEach((date, k) => timed.push(k === 0 ? e : { ...e, date, _day: k + 1 }));
    }
    const rows = [];
    for (let i = 0; i < timed.length; i++) {
      for (let j = i + 1; j < timed.length; j++) {
        const [a, b] = [timed[i], timed[j]];
        if (a.date !== b.date || a.id === b.id) continue;
        const row = compare(a, b, timed.filter((e) => e.date === a.date));
        row.date = a.date;
        if (a._day || b._day) row.msg = row.msg.replace(/^(No clash|Clash)\./, `$1 on ${prettyDate(a.date)}.`);
        rows.push(row);
      }
    }
    // Same pair on several days (two multi-day runs): keep one row per pair per verdict, the first day.
    const seen = new Set();
    return rows.filter((r) => { const k = `${r.a}|${r.b}|${r.kind}`; if (seen.has(k)) return false; seen.add(k); return true; });
  }

  function compare(a, b, sameDay) {
    const [as, ae] = span(a), [bs, be] = span(b);
    const base = { a: a.id, b: b.id, overlapMin: 0, action: null };

    // A test you may take any time in a window (1:30-5 PM, 60 minutes) clashes only if no free slot of that length is left.
    for (const [w, o] of [[a, b], [b, a]]) {
      if (!w.window || !w.durationMin || isPoint(w) || !w.end) continue;
      const [ws, we] = span(w), [os, oe] = span(o);
      if (oe <= ws || os >= we) break;
      const slot = os - ws >= w.durationMin ? ws : we - oe >= w.durationMin ? Math.max(oe, ws) : null;
      if (slot !== null) {
        return { ...base, kind: 'none', msg: `No clash. "${w.title}" is open ${range(ws, we)} and takes ${w.durationMin} minutes; take it ${range(slot, slot + w.durationMin)}, outside "${o.title}".` };
      }
    }

    if (isPoint(a) && isPoint(b)) {
      if (as === bs) return { ...base, kind: 'overlap', msg: `Clash. Both are at ${fmt12(a.start)}.`, action: `Ask which one comes first; you cannot do both at ${fmt12(a.start)}.` };
      const [first, second] = as < bs ? [a, b] : [b, a];
      return { ...base, kind: 'none', msg: `No clash. ${cap(name(first, second))} ${/s$/i.test(first.typeLabel || '') ? 'are' : 'is'} at ${fmt12(first.start)}, before ${name(second, first)} at ${fmt12(second.start)}.` };
    }
    if (isPoint(a) || isPoint(b)) {
      const [p, ev] = isPoint(a) ? [a, b] : [b, a];
      const [s, e] = span(ev), t = toMin(p.start);
      const what = p.type === 'deadline' ? `The ${fmt12(p.start)} deadline` : `${cap(name(p, ev))} at ${fmt12(p.start)}`;
      const is = p.type !== 'deadline' && /s$/i.test(p.typeLabel || '') ? 'are' : 'is';
      if ((t > s && t < e) || (p.type !== 'deadline' && t === s)) {
        const free = freeBefore(t, sameDay);
        const busy = sameDay.filter((x) => !isPoint(x) && toMin(x.start) < t && toMin(x.end) > free).map((x) => `"${x.title}"`);
        const action = p.type === 'deadline'
          ? `Finish "${p.title}" before ${fmt12(fromMin(free))}: from ${fmt12(fromMin(free))} to ${fmt12(p.start)} you are in ${busy.join(' and ')}.`
          : `Ask the coordinator whether you can leave ${name(ev, p)} for it.`;
        return { ...base, kind: 'deadline-inside', msg: `Clash. ${what} falls during ${name(ev, p)} (${range(s, e)}).`, action };
      }
      const rel = t <= s ? `before ${name(ev, p)} starts at ${fmt12(ev.start)}` : `after ${name(ev, p)} ends at ${fmt12(fromMin(e))}`;
      return { ...base, kind: 'none', msg: `No clash. ${what} ${is} ${rel}.` };
    }
    const from = Math.max(as, bs), to = Math.min(ae, be);
    if (from < to) {
      const later = as > bs || (as === bs && ae > be) ? a : b;
      return { ...base, kind: 'overlap', overlapMin: to - from, msg: `Clash. They overlap from ${range(from, to)} (${to - from} minutes).`,
        action: `Ask the coordinator about "${later.title}", or decide which one to attend; ${to - from} minutes overlap.` };
    }
    const [first, second] = as < bs ? [a, b] : [b, a];
    return { ...base, kind: 'none', msg: `No clash. ${cap(name(first, second))} ends at ${fmt12(fromMin(endOf(first)))}, before ${name(second, first)} starts at ${fmt12(second.start)}.` };
  }

  const cap = (s) => s.charAt(0).toUpperCase() + s.slice(1);

  return { findClashes };
})();

// ---- ics.js ----
const __ics = (() => {
  const { toMin, fromMin, addDays, fmt12, prettyDate } = __dates;
  const { findClashes } = __clash;
  // RFC 5545 calendar file: CRLF line endings, lines folded at 75 octets, escaped text,
  // times in Asia/Kolkata with a VTIMEZONE so Google, Outlook and Apple read the same clock time.
  // `calendarEntries()` is the one place that turns an event into calendar fields (UID, start, end, summary,
  // reminder); the .ics file, the Google Calendar API writer (../gcal.js), the class feed Worker and the
  // Gmail script all read from it, so the four never disagree on a time or a UID.


  const esc = (s) => String(s).replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\r?\n/g, '\\n');
  // Reminder per event type: ICS trigger, minutes before, and the text.
  const REMINDER = {
    test: { trigger: '-P1D', minutes: 1440, text: 'Test tomorrow' },
    deadline: { trigger: '-PT3H', minutes: 180, text: 'Deadline in 3 hours' },
    lecture: { trigger: '-PT30M', minutes: 30, text: 'Starts in 30 minutes' },
    other: { trigger: '-PT30M', minutes: 30, text: 'Starts in 30 minutes' },
  };
  const TZ = 'Asia/Kolkata';

  // UTF-8 byte length. Apps Script's V8 has no TextEncoder, so fall back to the encodeURIComponent trick there.
  const utf8len = typeof TextEncoder !== 'undefined'
    ? (s) => new TextEncoder().encode(s).length
    : (s) => unescape(encodeURIComponent(s)).length;

  function fold(line) {
    if (utf8len(line) <= 75) return line;
    const parts = [];
    let cur = '', size = 0, limit = 75;
    for (const ch of line) {
      const n = utf8len(ch);
      if (size + n > limit) { parts.push(cur); cur = ''; size = 0; limit = 74; }
      cur += ch; size += n;
    }
    parts.push(cur);
    return parts.join('\r\n ');
  }

  const stamp = (d) => d.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
  const compact = (isoDateTime) => isoDateTime.replace(/[-:]/g, '');
  const slug = (s) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40) || 'event';

  const titleOf = (e) => (e.title || '').trim() || 'Event';
  const summaryOf = (e) => (e.type === 'deadline' ? `${/deadline/i.test(titleOf(e)) ? '' : 'Deadline: '}${titleOf(e)}${e.start ? ` (by ${fmt12(e.start)})` : ''}` : titleOf(e));

  // Start and end. A deadline is a point; it is shown as the 30 minutes leading up to it.
  // Timed: "YYYY-MM-DDTHH:MM:00" in Asia/Kolkata. All-day: "YYYY-MM-DD" with an exclusive end date.
  function whenOf(e) {
    if (!e.start) return { allDay: true, start: e.date, end: addDays(e.date, 1) };
    const s = toMin(e.start);
    const [from, to] = e.type === 'deadline' ? [Math.max(0, s - 30), s] : [s, e.end && toMin(e.end) > s ? toMin(e.end) : s + (e.durationMin || 60)];
    return { allDay: false, start: `${e.date}T${fromMin(from)}:00`, end: `${e.date}T${fromMin(to)}:00` };
  }

  // Emoji by task: the title words decide first (a "Lab record submission" is a deadline, a "Lab viva" is a test), then the type.
  const EMOJI_BY_WORD = [
    [/\b(exam|test|quiz|viva|mid-?sem|end-?sem|assessment|ct\d?)\b/i, '📝'],
    [/\b(submission|submit|deadline|due|assignment|record|report|registration|fees?)\b/i, '⏰'],
    [/\b(placement|drive|interview|gd|recruit|internship|hiring)\b/i, '💼'],
    [/\b(lab|practical|workshop)\b/i, '🔬'],
    [/\b(lecture|class|seminar|webinar|talk|session|guest)\b/i, '🎓'],
    [/\b(fest|cultural|competition|hackathon|contest|sports|match)\b/i, '🏆'],
    [/\b(holiday|vacation)\b/i, '🏖️'],
    [/\b(meeting|orientation)\b/i, '👥'],
  ];
  const EMOJI_BY_TYPE = { test: '📝', deadline: '⏰', lecture: '🎓', other: '📌' };
  const emojiOf = (e) => (EMOJI_BY_WORD.find(([re]) => re.test(e.title || ''))?.[1]) || EMOJI_BY_TYPE[e.type] || EMOJI_BY_TYPE.other;

  // Google Calendar colour ids: clash red (Tomato), tight orange (Tangerine), else by type.
  const COLOR_BY_TYPE = { test: '3', deadline: '5', lecture: '9', other: '2' };
  const STATUS_COLOR = { clash: '11', tight: '6' };
  const STATUS_MARK = { clash: '🔴 ', tight: '🟠 ' };
  const TIGHT_GAP_MIN = 30;
  const BUSY_DAY = 4;

  // Minutes an event occupies on its day: a deadline is a point, otherwise start to end (or duration, or 1 hour).
  function minutesOf(e) {
    const s = toMin(e.start);
    if (e.type === 'deadline' || e.point) return [s, s];
    return [s, e.end && toMin(e.end) > s ? toMin(e.end) : s + (e.durationMin || 60)];
  }

  // Per event: 'clash' (overlaps another, or a deadline falls inside one), 'tight' (less than 30 minutes from the
  // neighbouring event, or a day with 4+ timed events) or 'ok'. `with` names the events it conflicts with or crowds.
  function statusMap(events) {
    const out = new Map(events.map((e) => [e.id, { status: 'ok', with: [] }]));
    const title = new Map(events.map((e) => [e.id, titleOf(e)]));
    const mark = (id, status, other) => {
      const cur = out.get(id);
      if (!cur) return;
      if (status === 'clash') cur.status = 'clash';
      else if (cur.status === 'ok') cur.status = 'tight';
      if (other && !cur.with.includes(other)) cur.with.push(other);
    };
    for (const row of findClashes(events)) {
      if (row.kind === 'none') continue;
      mark(row.a, 'clash', title.get(row.b));
      mark(row.b, 'clash', title.get(row.a));
    }
    const days = new Map();
    for (const e of events) if (e.date && e.start) days.set(e.date, [...(days.get(e.date) || []), e]);
    for (const list of days.values()) {
      const sorted = [...list].sort((a, b) => toMin(a.start) - toMin(b.start));
      for (let i = 0; i + 1 < sorted.length; i++) {
        const [, endA] = minutesOf(sorted[i]);
        const [startB] = minutesOf(sorted[i + 1]);
        const gap = startB - endA;
        if (gap >= 0 && gap < TIGHT_GAP_MIN) {
          mark(sorted[i].id, 'tight', title.get(sorted[i + 1].id));
          mark(sorted[i + 1].id, 'tight', title.get(sorted[i].id));
        }
      }
      if (sorted.length >= BUSY_DAY) for (const e of sorted) mark(e.id, 'tight', null);
    }
    return out;
  }

  const statusLine = (st) => (st.status === 'clash' ? `🔴 Clashes with ${st.with.join(' and ')}` : st.status === 'tight' ? (st.with.length ? `🟠 Tight: right next to ${st.with.join(' and ')}` : '🟠 Busy day: 4 or more events') : '');

  function descriptionOf(e, st) {
    const when = !e.start ? 'All day' : e.type === 'deadline' ? `By ${fmt12(e.start)}` : e.end ? `${fmt12(e.start)} to ${fmt12(e.end)}` : fmt12(e.start);
    const rem = e.start ? (REMINDER[e.type] || REMINDER.other).text : '';
    return [
      `${emojiOf(e)} ${e.typeLabel || e.type}`,
      statusLine(st),
      `📅 ${prettyDate(e.date)}`,
      `🕒 ${when}`,
      e.venue ? `📍 ${e.venue}` : '',
      e.durationMin ? (e.window ? `⏳ Open ${fmt12(e.start)} to ${fmt12(e.end)}; takes ${e.durationMin} minutes once you start` : `⏳ Takes ${e.durationMin} minutes`) : '',
      e.reportAt ? `🚪 Report by ${fmt12(e.reportAt)}` : '',
      e.link ? `🔗 ${e.link}` : '',
      rem ? `🔔 ${rem}` : '',
      '',
      'Added with Notice Decoder. Check the original notice for changes.',
    ].filter(Boolean).join('\n');
  }

  // One entry per dated event. The same title gives the same UID (a second event with the same title gets -2),
  // so a revised notice imported later updates the event instead of adding a copy.
  function calendarEntries(events) {
    const used = new Map();
    const status = statusMap(events);
    return events.filter((x) => x.date).map((e) => {
      const st = status.get(e.id) || { status: 'ok', with: [] };
      const base = slug(titleOf(e));
      const n = (used.get(base) || 0) + 1;
      used.set(base, n);
      const { allDay, start, end } = whenOf(e);
      return {
        uid: `${base}${n > 1 ? '-' + n : ''}@notice-decoder`,
        summary: `${STATUS_MARK[st.status] || ''}${emojiOf(e)} ${summaryOf(e)}`,
        status: st.status,
        colorId: STATUS_COLOR[st.status] || COLOR_BY_TYPE[e.type] || COLOR_BY_TYPE.other,
        allDay, start, end,
        location: e.venue || null,
        description: descriptionOf(e, st),
        category: (e.typeLabel || e.type).toUpperCase(),
        url: e.link || null,
        recurrence: e.repeat > 1 ? `RRULE:FREQ=${e.every ? `WEEKLY;BYDAY=${e.every}` : 'DAILY'};COUNT=${e.repeat}` : null,
        reminder: e.start ? (REMINDER[e.type] || REMINDER.other) : null,
        title: titleOf(e),
        type: e.type,
        event: e,
      };
    });
  }

  // One-tap "Add to Google Calendar" link for a single event; no file to import.
  function gcalUrl(e) {
    if (!e.date) return null;
    const [entry] = calendarEntries([e]);
    const dates = entry.allDay ? `${compact(entry.start)}/${compact(entry.end)}` : `${compact(entry.start)}/${compact(entry.end)}`;
    const q = new URLSearchParams({ action: 'TEMPLATE', text: entry.summary, dates, ctz: TZ });
    if (entry.location) q.set('location', entry.location);
    if (e.link) q.set('details', `Link: ${e.link}`);
    if (entry.recurrence) q.set('recur', entry.recurrence);
    return `https://calendar.google.com/calendar/render?${q}`;
  }

  function toICS(events, { reminders = true, now = new Date(), calName = 'Notice Decoder' } = {}) {
    const lines = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Notice Decoder//SETU 2026//EN', 'CALSCALE:GREGORIAN', 'METHOD:PUBLISH', `X-WR-CALNAME:${esc(calName)}`, `X-WR-TIMEZONE:${TZ}`,
      'BEGIN:VTIMEZONE', `TZID:${TZ}`, 'BEGIN:STANDARD', 'DTSTART:19700101T000000', 'TZOFFSETFROM:+0530', 'TZOFFSETTO:+0530', 'TZNAME:IST', 'END:STANDARD', 'END:VTIMEZONE'];
    for (const x of calendarEntries(events)) {
      lines.push('BEGIN:VEVENT', `UID:${x.uid}`, `DTSTAMP:${stamp(now)}`);
      if (x.allDay) lines.push(`DTSTART;VALUE=DATE:${compact(x.start)}`, `DTEND;VALUE=DATE:${compact(x.end)}`);
      else lines.push(`DTSTART;TZID=${TZ}:${compact(x.start)}`, `DTEND;TZID=${TZ}:${compact(x.end)}`);
      if (x.recurrence) lines.push(x.recurrence);
      lines.push(`SUMMARY:${esc(x.summary)}`);
      if (x.location) lines.push(`LOCATION:${esc(x.location)}`);
      lines.push(`DESCRIPTION:${esc(x.description)}`, `CATEGORIES:${esc(x.category)}`);
      if (x.url) lines.push(`URL:${x.url}`);
      if (x.event.cancelled) lines.push('STATUS:CANCELLED');
      if (reminders && x.reminder) {
        lines.push('BEGIN:VALARM', 'ACTION:DISPLAY', `TRIGGER:${x.reminder.trigger}`, `DESCRIPTION:${esc(`${x.reminder.text}: ${x.title}`)}`, 'END:VALARM');
      }
      lines.push('END:VEVENT');
    }
    lines.push('END:VCALENDAR');
    return lines.map(fold).join('\r\n') + '\r\n';
  }

  return { REMINDER, TZ, emojiOf, calendarEntries, gcalUrl, toICS };
})();

root.NoticeEngine = {
  parseNotice: __parse.parseNotice,
  findClashes: __clash.findClashes,
  toICS: __ics.toICS,
  gcalUrl: __ics.gcalUrl,
  calendarEntries: __ics.calendarEntries,
  REMINDER: __ics.REMINDER,
  TZ: __ics.TZ,
  HOLIDAYS: __holidays.HOLIDAYS,
  holidayOn: __holidays.holidayOn,
  findDates: __dates.findDates,
  findTimes: __dates.findTimes,
  findDurations: __dates.findDurations,
  fmt12: __dates.fmt12,
  prettyDate: __dates.prettyDate,
  fixOcrText: __ocrfix.fixOcrText,
  normalizeNames: __ocrfix.normalizeNames,
  version: "8f9fdf3",
};
})(typeof globalThis !== 'undefined' ? globalThis : this);
