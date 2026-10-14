// RFC 5545 calendar file: CRLF line endings, lines folded at 75 octets, escaped text,
// times in Asia/Kolkata with a VTIMEZONE so Google, Outlook and Apple read the same clock time.
import { toMin, fromMin, addDays, fmt12 } from './dates.js';

const esc = (s) => String(s).replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\r?\n/g, '\\n');
const REMINDER = { test: ['-P1D', 'Test tomorrow'], deadline: ['-PT3H', 'Deadline in 3 hours'], lecture: ['-PT30M', 'Starts in 30 minutes'], other: ['-PT30M', 'Starts in 30 minutes'] };

function fold(line) {
  const bytes = new TextEncoder().encode(line);
  if (bytes.length <= 75) return line;
  const parts = [];
  let cur = '', size = 0, limit = 75;
  for (const ch of line) {
    const n = new TextEncoder().encode(ch).length;
    if (size + n > limit) { parts.push(cur); cur = ''; size = 0; limit = 74; }
    cur += ch; size += n;
  }
  parts.push(cur);
  return parts.join('\r\n ');
}

const stamp = (d) => d.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
const local = (date, hm) => `${date.replace(/-/g, '')}T${hm.replace(':', '')}00`;
const slug = (s) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40) || 'event';

// Start and end as calendar date-times. A deadline is a point; it is shown as the 30 minutes leading up to it.
function when(e) {
  if (!e.start) return [e.date.replace(/-/g, ''), addDays(e.date, 1).replace(/-/g, '')];
  const s = toMin(e.start);
  const [from, to] = e.type === 'deadline' ? [Math.max(0, s - 30), s] : [s, e.end && toMin(e.end) > s ? toMin(e.end) : s + (e.durationMin || 60)];
  return [local(e.date, fromMin(from)), local(e.date, fromMin(to))];
}

const summary = (e) => (e.type === 'deadline' ? `Deadline: ${e.title}${e.start ? ` (by ${fmt12(e.start)})` : ''}` : e.title);

// One-tap "Add to Google Calendar" link for a single event; no file to import.
export function gcalUrl(e) {
  if (!e.date) return null;
  const q = new URLSearchParams({ action: 'TEMPLATE', text: summary(e), dates: when(e).join('/'), ctz: 'Asia/Kolkata' });
  if (e.venue) q.set('location', e.venue);
  if (e.link) q.set('details', `Link: ${e.link}`);
  if (e.repeat > 1) q.set('recur', `RRULE:FREQ=DAILY;COUNT=${e.repeat}`);
  return `https://calendar.google.com/calendar/render?${q}`;
}

export function toICS(events, { reminders = true, now = new Date() } = {}) {
  const lines = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Notice Decoder//SETU 2026//EN', 'CALSCALE:GREGORIAN', 'METHOD:PUBLISH',
    'BEGIN:VTIMEZONE', 'TZID:Asia/Kolkata', 'BEGIN:STANDARD', 'DTSTART:19700101T000000', 'TZOFFSETFROM:+0530', 'TZOFFSETTO:+0530', 'TZNAME:IST', 'END:STANDARD', 'END:VTIMEZONE'];
  const used = new Map();
  for (const e of events.filter((x) => x.date)) {
    // The same title gives the same UID, so importing a revised notice can update the event instead of adding a copy.
    const base = slug(e.title);
    const n = (used.get(base) || 0) + 1;
    used.set(base, n);
    lines.push('BEGIN:VEVENT', `UID:${base}${n > 1 ? '-' + n : ''}@notice-decoder`, `DTSTAMP:${stamp(now)}`);
    const [from, to] = when(e);
    if (!e.start) lines.push(`DTSTART;VALUE=DATE:${from}`, `DTEND;VALUE=DATE:${to}`);
    else lines.push(`DTSTART;TZID=Asia/Kolkata:${from}`, `DTEND;TZID=Asia/Kolkata:${to}`);
    if (e.repeat > 1) lines.push(`RRULE:FREQ=DAILY;COUNT=${e.repeat}`);
    lines.push(`SUMMARY:${esc(summary(e))}`);
    if (e.venue) lines.push(`LOCATION:${esc(e.venue)}`);
    const desc = [`Type: ${e.typeLabel || e.type}`, e.durationMin ? (e.window ? `Open ${fmt12(e.start)} to ${fmt12(e.end)}; takes ${e.durationMin} minutes once you start` : `Takes ${e.durationMin} minutes`) : '', e.link ? `Link: ${e.link}` : '', 'Added with Notice Decoder. Check the original notice for changes.'].filter(Boolean).join('\n');
    lines.push(`DESCRIPTION:${esc(desc)}`, `CATEGORIES:${esc((e.typeLabel || e.type).toUpperCase())}`);
    if (e.link) lines.push(`URL:${e.link}`);
    if (reminders && e.start) {
      const [trigger, text] = REMINDER[e.type] || REMINDER.other;
      lines.push('BEGIN:VALARM', 'ACTION:DISPLAY', `TRIGGER:${trigger}`, `DESCRIPTION:${esc(`${text}: ${e.title}`)}`, 'END:VALARM');
    }
    lines.push('END:VEVENT');
  }
  lines.push('END:VCALENDAR');
  return lines.map(fold).join('\r\n') + '\r\n';
}
