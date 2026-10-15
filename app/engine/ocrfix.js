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
export function normalizeNames(text) {
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
export function fixOcrText(raw) {
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
