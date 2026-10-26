// Class feed logic: what a publish does to the class calendar, decided BEFORE anything is written, so the class
// representative can see "2 new, 1 moved" and fix a wrong guess before the whole class gets it.
//
// The one hard question is "same title, different date". "Internal Test 2" on 13 Nov, then "Internal Test 2" on 14 Nov
// is the test being moved; "Quiz" on 5 Nov, then "Quiz" on 12 Nov is a second quiz. v1 keyed events by title alone, so
// the second quiz silently moved the first one. Now: a specific title (or one the notice marks as revised) moves the
// event, a generic one adds a new event, and every such guess carries the other option for the CR to pick.
import { calendarEntries, slug } from '../../app/engine/ics.js';
import { findClashes } from '../../app/engine/clash.js';

export const MAX_EVENTS = 300;
const MAX_CHANGES = 40;
const MOVE_WINDOW_DAYS = 60;
const EVENT_FIELDS = ['title', 'type', 'typeLabel', 'date', 'start', 'end', 'venue', 'link', 'durationMin', 'repeat', 'every', 'point', 'window', 'reportAt', 'cancelled', 'moved'];
// Titles that name a kind of thing, not one thing: a second "Quiz" is another quiz, not the first one moved.
const GENERIC_TITLE = /^(?:(?:extra|remedial|special|doubt|guest)\s+)?(?:event|events|test|tests|exam|exams|quiz|quizzes|viva|practical|class|classes|lecture|lectures|session|meeting|deadline|submission|registration|seminar|workshop|webinar|holiday|assembly|results?|interview|presentation|review|lab|tutorial|talk)$/i;

export const istToday = (now = Date.now()) => new Date(now + 330 * 60000).toISOString().slice(0, 10);
const days = (a, b) => Math.round((Date.parse(b) - Date.parse(a)) / 86400000);
const keyOf = (title) => slug(String(title || '').trim() || 'Event');
const when = (e) => `${e.date}|${e.start || ''}|${e.end || ''}`;
const compactDate = (d) => d.replace(/-/g, '');

// Only the fields the calendar needs, with the same shape the PWA's workingCopy() produces. Junk is dropped, never stored.
export function cleanEvent(x) {
  if (!x || typeof x !== 'object' || Array.isArray(x)) return null;
  const e = {};
  for (const k of EVENT_FIELDS) if (x[k] !== undefined && x[k] !== null && x[k] !== '') e[k] = x[k];
  if (typeof e.title !== 'string' || !e.title.trim() || !/^\d{4}-\d{2}-\d{2}$/.test(e.date || '') || Number.isNaN(Date.parse(e.date))) return null;
  const [y, m, d] = e.date.split('-').map(Number);
  const real = new Date(Date.UTC(y, m - 1, d));
  if (real.getUTCMonth() !== m - 1 || y < 2000 || y > 2100) return null;
  e.title = e.title.replace(/\s+/g, ' ').trim().slice(0, 120);
  if (!['test', 'deadline', 'lecture', 'other'].includes(e.type)) e.type = 'other';
  if (typeof e.typeLabel !== 'string') delete e.typeLabel; else e.typeLabel = e.typeLabel.slice(0, 30);
  for (const k of ['start', 'end', 'reportAt']) if (e[k] !== undefined && !/^([01]\d|2[0-3]):[0-5]\d$/.test(e[k])) delete e[k];
  if (e.end && e.start && e.end <= e.start) delete e.end;
  if (e.venue !== undefined) e.venue = String(e.venue).replace(/\s+/g, ' ').trim().slice(0, 120) || undefined;
  if (e.link !== undefined && !(typeof e.link === 'string' && /^https?:\/\/[^\s<>"']+$/.test(e.link) && e.link.length <= 500)) delete e.link;
  e.durationMin = Number.isInteger(Number(e.durationMin)) && e.durationMin > 0 && e.durationMin <= 1440 ? Number(e.durationMin) : undefined;
  e.repeat = Number.isInteger(Number(e.repeat)) && e.repeat > 1 && e.repeat <= 60 ? Number(e.repeat) : undefined;
  e.every = typeof e.every === 'string' && /^(?:(?:SU|MO|TU|WE|TH|FR|SA)(?:,|$))+$/.test(e.every) ? e.every : undefined;
  for (const k of ['point', 'window', 'cancelled', 'moved']) if (e[k] !== undefined) e[k] = e[k] === true;
  for (const k of Object.keys(e)) if (e[k] === undefined) delete e[k];
  return e;
}

// A record from v1 (no key, no changes) is upgraded in place the first time it is read.
export function upgrade(cls) {
  cls.events = cls.events && typeof cls.events === 'object' ? cls.events : {};
  for (const e of Object.values(cls.events)) e.key = e.key || keyOf(e.title);
  cls.stats = cls.stats || { publishes: 0, revised: 0, cancelled: 0, clashSeen: [] };
  cls.stats.clashSeen = cls.stats.clashSeen || [];
  cls.changes = Array.isArray(cls.changes) ? cls.changes : [];
  cls.v = 2;
  return cls;
}

function freshUid(cls, key, date, claimed) {
  const taken = (u) => cls.events[u] || claimed.has(u);
  let uid = `${key}@notice-decoder`;
  if (!taken(uid)) return uid;
  uid = `${key}-${compactDate(date)}@notice-decoder`;
  for (let n = 2; taken(uid); n++) uid = `${key}-${compactDate(date)}-${n}@notice-decoder`;
  return uid;
}

// The plan for one publish: per incoming event, what happens to the class calendar. Nothing is written here.
// intents[i]: 'new' (add it, whatever exists) or 'replace:<uid>' (it is that published event, moved or changed).
export function plan(cls, incoming, intents = {}) {
  const claimed = new Set();
  const out = [];
  const entries = calendarEntries(incoming.map((e, i) => ({ ...e, id: `in${i}` })));
  entries.forEach((entry, i) => {
    const ev = incoming[i];
    const key = keyOf(ev.title);
    const all = Object.values(cls.events).filter((x) => x.key === key && !claimed.has(x.uid));
    const intent = typeof intents[i] === 'string' ? intents[i] : 'auto';
    const item = { i, title: ev.title, date: ev.date, start: ev.start || null, end: ev.end || null, venue: ev.venue || null, key, prev: null, alt: null };
    const target = (uid, action) => {
      const p = cls.events[uid];
      Object.assign(item, { uid, action, prev: { date: p.date, start: p.start || null, end: p.end || null, venue: p.venue || null, cancelled: Boolean(p.cancelled) } });
      if (action !== 'move' && p.cancelled) item.action = 'restore';
      else if (action !== 'move' && when(p) === when(ev) && (p.venue || '') === (ev.venue || '') && (p.link || '') === (ev.link || '') && p.title === ev.title && p.type === ev.type) item.action = 'same';
      claimed.add(uid);
    };
    const replace = /^replace:(.+@notice-decoder)$/.exec(intent);
    if (replace && cls.events[replace[1]] && !claimed.has(replace[1])) {
      target(replace[1], cls.events[replace[1]].date === ev.date ? 'update' : 'move');
    } else if (intent === 'new') {
      Object.assign(item, { uid: freshUid(cls, key, ev.date, claimed), action: 'add' });
      claimed.add(item.uid);
    } else {
      const sameDay = all.find((x) => x.date === ev.date);
      const near = all.filter((x) => !x.cancelled && Math.abs(days(x.date, ev.date)) <= MOVE_WINDOW_DAYS);
      if (sameDay) {
        target(sameDay.uid, 'update');
      } else if (near.length === 1 && (ev.moved || !GENERIC_TITLE.test(ev.title))) {
        target(near[0].uid, 'move');
        item.alt = { action: 'add', intent: 'new' };
      } else {
        Object.assign(item, { uid: freshUid(cls, key, ev.date, claimed), action: 'add' });
        claimed.add(item.uid);
        const closest = near.sort((a, b) => Math.abs(days(a.date, ev.date)) - Math.abs(days(b.date, ev.date)))[0];
        if (closest) item.alt = { action: 'move', intent: `replace:${closest.uid}`, date: closest.date, start: closest.start || null };
      }
    }
    item.entryUid = entry.uid;
    out.push(item);
  });
  return out;
}

function log(cls, change) {
  cls.changes.push({ at: new Date().toISOString(), ...change });
  cls.changes = cls.changes.slice(-MAX_CHANGES);
}

// Apply a plan. Returns the counts the CR sees.
export function apply(cls, incoming, items) {
  const counts = { added: 0, updated: 0, moved: 0, restored: 0, unchanged: 0 };
  const now = new Date().toISOString();
  for (const item of items) {
    const ev = incoming[item.i];
    const before = cls.events[item.uid];
    const { moved, ...fields } = ev;
    cls.events[item.uid] = { ...fields, uid: item.uid, key: item.key, publishedAt: item.action === 'same' ? before.publishedAt : now, cancelled: false };
    if (item.action === 'same') { counts.unchanged++; continue; }
    if (item.action === 'add') { counts.added++; log(cls, { kind: 'added', uid: item.uid, title: ev.title, date: ev.date, start: ev.start || null }); continue; }
    if (item.action === 'restore') counts.restored++;
    else if (item.action === 'move') counts.moved++;
    else counts.updated++;
    if (before && when(before) !== when(ev)) cls.stats.revised++;
    log(cls, {
      kind: item.action === 'restore' ? 'restored' : before && when(before) !== when(ev) ? 'moved' : 'updated',
      uid: item.uid, title: ev.title, date: ev.date, start: ev.start || null,
      from: before ? { date: before.date, start: before.start || null } : null,
    });
  }
  // The newest 300 stay; the oldest published events drop off the end.
  const keep = Object.values(cls.events).sort((a, b) => (b.publishedAt || '').localeCompare(a.publishedAt || '')).slice(0, MAX_EVENTS);
  cls.events = Object.fromEntries(keep.map((e) => [e.uid, e]));
  cls.updatedAt = now;
  return counts;
}

// One event edited from the CR console ("the test moved to 2 PM"). The UID stays, so every calendar updates it.
export function edit(cls, uid, patch) {
  const before = cls.events[uid];
  const merged = cleanEvent({ ...before, ...patch, cancelled: before.cancelled });
  if (!merged) return null;
  cls.events[uid] = { ...merged, uid, key: keyOf(merged.title), publishedAt: new Date().toISOString() };
  if (when(before) !== when(merged)) cls.stats.revised++;
  log(cls, { kind: when(before) !== when(merged) ? 'moved' : 'updated', uid, title: merged.title, date: merged.date, start: merged.start || null, from: { date: before.date, start: before.start || null } });
  cls.updatedAt = new Date().toISOString();
  return cls.events[uid];
}

export function setCancelled(cls, uid, cancelled) {
  const e = cls.events[uid];
  if (Boolean(e.cancelled) === cancelled) return false;
  cls.events[uid] = { ...e, cancelled, publishedAt: new Date().toISOString() };
  if (cancelled) cls.stats.cancelled++;
  log(cls, { kind: cancelled ? 'cancelled' : 'restored', uid, title: e.title, date: e.date, start: e.start || null });
  cls.updatedAt = new Date().toISOString();
  return true;
}

export function liveEvents(cls) {
  return Object.values(cls.events).filter((e) => !e.cancelled).map((e) => ({ ...e, id: e.uid }));
}

// Clashes across everything the class has, from today on: a clash last month is not news.
export function clashReport(cls, today = istToday()) {
  const live = liveEvents(cls);
  const byId = new Map(live.map((e) => [e.id, e]));
  return findClashes(live)
    .filter((c) => c.kind !== 'none' && (c.date || byId.get(c.a).date) >= today)
    .map((c) => ({ a: byId.get(c.a).title, b: byId.get(c.b).title, date: c.date || byId.get(c.a).date, msg: c.msg, action: c.action }));
}

export function stats(cls) {
  const s = cls.stats;
  return { publishes: s.publishes || 0, events: liveEvents(cls).length, revised: s.revised || 0, cancelled: s.cancelled || 0, clashesFound: (s.clashSeen || []).length, since: cls.createdAt };
}

// What students may see: the event fields and what changed, never the secret hash or the pilot counters.
export const publicChanges = (cls, n = 15) => cls.changes.slice(-n).reverse().map(({ at, kind, title, date, start, from }) => ({ at, kind, title, date, start, from: from || null }));
