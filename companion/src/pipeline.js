// Pure logic, no React Native imports, so it runs in node (test/pipeline.test.mjs) and on the phone alike.
// notification -> texts to decode -> engine -> { clean entries to write, amber events to ask about }.
import '../engine/notice-engine.js'; // sets globalThis.NoticeEngine

const E = () => globalThis.NoticeEngine;
export const WHATSAPP = ['com.whatsapp', 'com.whatsapp.w4b'];

// FNV-1a: a small stable hash to remember which notifications were already handled.
export function hash(s) {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193); }
  return (h >>> 0).toString(36);
}

// The listener gives one JSON per posted notification: { app, title, text, bigText, subText, time, groupedMessages: [{title, text}] }.
// WhatsApp titles a group chat "Group" with text "Sender: message", or "Sender @ Group" on some versions.
// Returns the messages that belong to a watched group, or [] when the notification is not for us.
export function fromNotification(n, watchedGroups) {
  if (!n || !WHATSAPP.includes(n.app) || !watchedGroups?.length) return [];
  const groupOf = (title) => watchedGroups.find((g) => (title || '').toLowerCase().includes(g.toLowerCase()));
  const strip = (t) => String(t || '').replace(/^[^\n:]{1,40}:\s+/, '').trim(); // "Sender: text" -> "text"
  const out = [];
  const push = (group, text) => {
    const body = strip(text);
    if (body.length < 15 || /^\d+ new messages?$/i.test(body)) return;
    out.push({ group, text: body, hash: hash(`${group}\n${body}`) });
  };
  if (Array.isArray(n.groupedMessages) && n.groupedMessages.length) {
    for (const m of n.groupedMessages) { const g = groupOf(n.title) || groupOf(m.title); if (g) push(g, m.text); }
  } else {
    const g = groupOf(n.title) || groupOf(n.subText);
    if (g) push(g, n.bigText || n.text);
  }
  return out;
}

// One notice -> what to do. Clean = every field certain -> calendar entries; amber = events with a field to check.
export function plan(text, receivedAt = new Date()) {
  const result = E().parseNotice(text, { pastedAt: receivedAt });
  const amber = [], clean = [];
  for (const ev of result.events) {
    if (!ev.date) { amber.push(ev); continue; }
    if ((ev.flags || []).some((f) => f.level === 'warn')) amber.push(ev); else clean.push(ev);
  }
  return { result, amber, clean, entries: E().calendarEntries(clean), clashes: E().findClashes(result.events).filter((c) => c.kind !== 'none') };
}

// "2026-11-13T10:00:00" / "2026-11-13" -> Date in the phone's local time (the engine's times are Asia/Kolkata wall-clock).
export function localDate(s) {
  const m = /^(\d{4})-(\d{2})-(\d{2})(?:T(\d{2}):(\d{2}))?/.exec(s);
  return new Date(+m[1], +m[2] - 1, +m[3], m[4] ? +m[4] : 0, m[5] ? +m[5] : 0, 0);
}

// Same payload the web app's "Share with class" and the Gmail script use (app.js shareUrl, version 1).
export function sharePayload(events) {
  const payload = { v: 1, on: new Date().toISOString().slice(0, 10), e: events.map((ev) => ({ t: ev.title, k: ev.type, d: ev.date, s: ev.start, e: ev.end, v: ev.venue, l: ev.link, m: ev.durationMin, r: ev.repeat, p: ev.point ? 1 : 0, w: ev.window ? 1 : 0 })) };
  const json = JSON.stringify(payload);
  const bytes = typeof TextEncoder !== 'undefined' ? new TextEncoder().encode(json) : Uint8Array.from(unescape(encodeURIComponent(json)), (c) => c.charCodeAt(0));
  let bin = '';
  for (const b of bytes) bin += String.fromCharCode(b);
  const b64 = typeof btoa !== 'undefined' ? btoa(bin) : Buffer.from(bin, 'binary').toString('base64');
  return b64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export const fmt12 = (hm) => E().fmt12(hm);
export const prettyDate = (iso) => E().prettyDate(iso);

export function oneLine(ev) {
  const when = !ev.start ? 'all day' : ev.type === 'deadline' || ev.point ? `by ${fmt12(ev.start)}` : ev.end ? `${fmt12(ev.start)}-${fmt12(ev.end)}` : fmt12(ev.start);
  return `${ev.title}, ${prettyDate(ev.date)} ${when}${ev.venue ? `, ${ev.venue}` : ''}`;
}
