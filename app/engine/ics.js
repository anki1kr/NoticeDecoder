// RFC 5545 calendar file: CRLF line endings, lines folded at 75 octets, escaped text,
// times in Asia/Kolkata with a VTIMEZONE so Google, Outlook and Apple read the same clock time.
// `calendarEntries()` is the one place that turns an event into calendar fields (UID, start, end, summary,
// reminder); the .ics file, the Google Calendar API writer (../gcal.js), the class feed Worker and the
// Gmail script all read from it, so the four never disagree on a time or a UID.
import { toMin, fromMin, addDays, fmt12, prettyDate } from './dates.js';
import { findClashes } from './clash.js';

const esc = (s) => String(s).replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\r?\n/g, '\\n');
// Reminder per event type: ICS trigger, minutes before, and the text.
export const REMINDER = {
  test: { trigger: '-P1D', minutes: 1440, text: 'Test tomorrow' },
  deadline: { trigger: '-PT3H', minutes: 180, text: 'Deadline in 3 hours' },
  lecture: { trigger: '-PT30M', minutes: 30, text: 'Starts in 30 minutes' },
  other: { trigger: '-PT30M', minutes: 30, text: 'Starts in 30 minutes' },
};
export const TZ = 'Asia/Kolkata';

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
// FNV-1a: a short, stable, sync hash (Apps Script has no crypto.subtle), so a Hindi title gets its own UID.
const fnv = (s) => { let h = 0x811c9dc5; for (const ch of s) { h ^= ch.codePointAt(0); h = Math.imul(h, 0x01000193) >>> 0; } return h.toString(36); };
// The UID stem of a title. ASCII titles keep their readable slug; a title with other scripts ("गणित की परीक्षा")
// used to collapse to "event", so every Hindi event shared one UID and overwrote the others.
export const slug = (s) => {
  const ascii = s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40);
  return /[^\x00-\x7F]/.test(s.normalize('NFC').replace(/[^\p{L}\p{N}]/gu, '')) ? `${ascii || 'e'}-${fnv(s.trim().toLowerCase())}` : ascii || 'event';
};
const VALID_UID = /^[a-z0-9-]{1,80}@notice-decoder$/;

const titleOf = (e) => (e.title || '').trim() || 'Event';
// Only a plain web link reaches a calendar: a typed "javascript:" or a link with spaces never does.
const webLink = (u) => (typeof u === 'string' && /^https?:\/\/[^\s<>"']+$/i.test(u.trim()) && u.length <= 500 ? u.trim() : null);
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
  [/\b(fest|cultural|competition|hackathon|ideathon|contest|challenge|tournament|sports|match)\b/i, '🏆'],
  [/\b(holiday|vacation)\b/i, '🏖️'],
  [/\b(meeting|orientation)\b/i, '👥'],
];
const EMOJI_BY_TYPE = { test: '📝', deadline: '⏰', lecture: '🎓', other: '📌' };
export const emojiOf = (e) => (EMOJI_BY_WORD.find(([re]) => re.test(e.title || ''))?.[1]) || EMOJI_BY_TYPE[e.type] || EMOJI_BY_TYPE.other;

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
  // A cancelled event (class feed) is still in the file as STATUS:CANCELLED, but it clashes with nothing.
  const live = events.filter((e) => !e.cancelled);
  for (const row of findClashes(live)) {
    if (row.kind === 'none') continue;
    mark(row.a, 'clash', title.get(row.b));
    mark(row.b, 'clash', title.get(row.a));
  }
  const days = new Map();
  for (const e of live) if (e.date && e.start) days.set(e.date, [...(days.get(e.date) || []), e]);
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
    webLink(e.link) ? `🔗 ${webLink(e.link)}` : '',
    rem ? `🔔 ${rem}` : '',
    '',
    'Added with Notice Decoder. Check the original notice for changes.',
  ].filter(Boolean).join('\n');
}

// One entry per dated event. The same title gives the same UID (a second event with the same title gets -2),
// so a revised notice imported later updates the event instead of adding a copy. An event that already carries a UID
// (the class feed assigns them, and a student's copy of a class event keeps it) keeps that UID.
export function calendarEntries(events) {
  const used = new Map();
  const taken = new Set(events.map((e) => e.uid).filter((u) => VALID_UID.test(u || '')));
  const status = statusMap(events);
  return events.filter((x) => x.date).map((e) => {
    const st = status.get(e.id) || { status: 'ok', with: [] };
    let uid = VALID_UID.test(e.uid || '') ? e.uid : null;
    if (!uid) {
      const base = slug(titleOf(e));
      let n = used.get(base) || 0;
      do { n++; uid = `${base}${n > 1 ? '-' + n : ''}@notice-decoder`; } while (taken.has(uid));
      used.set(base, n);
      taken.add(uid);
    }
    const { allDay, start, end } = whenOf(e);
    return {
      uid,
      summary: `${STATUS_MARK[st.status] || ''}${emojiOf(e)} ${summaryOf(e)}`,
      status: st.status,
      colorId: STATUS_COLOR[st.status] || COLOR_BY_TYPE[e.type] || COLOR_BY_TYPE.other,
      allDay, start, end,
      location: e.venue || null,
      description: descriptionOf(e, st),
      category: (e.typeLabel || e.type).toUpperCase(),
      url: webLink(e.link),
      recurrence: e.repeat > 1 ? `RRULE:FREQ=${e.every ? `WEEKLY;BYDAY=${e.every}` : 'DAILY'};COUNT=${e.repeat}` : null,
      reminder: e.start ? (REMINDER[e.type] || REMINDER.other) : null,
      title: titleOf(e),
      type: e.type,
      event: e,
    };
  });
}

// One-tap "Add to Google Calendar" link for a single event; no file to import.
export function gcalUrl(e) {
  if (!e.date) return null;
  const [entry] = calendarEntries([e]);
  const dates = entry.allDay ? `${compact(entry.start)}/${compact(entry.end)}` : `${compact(entry.start)}/${compact(entry.end)}`;
  const q = new URLSearchParams({ action: 'TEMPLATE', text: entry.summary, dates, ctz: TZ });
  if (entry.location) q.set('location', entry.location);
  if (webLink(e.link)) q.set('details', `Link: ${webLink(e.link)}`);
  if (entry.recurrence) q.set('recur', entry.recurrence);
  return `https://calendar.google.com/calendar/render?${q}`;
}

export function toICS(events, { reminders = true, now = new Date(), calName = 'Notice Decoder' } = {}) {
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
