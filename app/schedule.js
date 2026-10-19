// The events this browser has already put into a calendar, so the next notice is clash-checked against them too.
// Kept in localStorage on this device only: nothing here is ever sent anywhere.
import { occurrences } from './engine/dates.js';

const KEY = 'nd-schedule';
const MAX = 200;
const FIELDS = ['title', 'type', 'typeLabel', 'date', 'start', 'end', 'venue', 'durationMin', 'repeat', 'every', 'point', 'window'];
const keyOf = (e) => `${String(e.title || '').toLowerCase()}|${e.date}|${e.start || ''}`;
const lastDay = (e) => occurrences(e).at(-1);

function read() {
  try {
    const list = JSON.parse(localStorage.getItem(KEY));
    return Array.isArray(list) ? list.filter((e) => e && /^\d{4}-\d{2}-\d{2}$/.test(e.date)) : [];
  } catch { return []; }
}

function write(list) {
  try { localStorage.setItem(KEY, JSON.stringify(list.slice(-MAX))); } catch { /* private mode or full: the check just starts empty next time */ }
}

// Saved events that are still to come, minus the ones in `current` (the same title, date and start).
export function upcoming(today, current = []) {
  const skip = new Set(current.map(keyOf));
  return read().filter((e) => lastDay(e) >= today && !skip.has(keyOf(e)));
}

export function remember(events, today) {
  const fresh = events.filter((e) => e.date && e.start).map((e) => Object.fromEntries(FIELDS.filter((f) => e[f] != null).map((f) => [f, e[f]])));
  const keys = new Set(fresh.map(keyOf));
  write([...read().filter((e) => lastDay(e) >= today && !keys.has(keyOf(e))), ...fresh]);
}

export function forget(events) {
  const keys = new Set(events.map(keyOf));
  write(read().filter((e) => !keys.has(keyOf(e))));
}

export function clear() {
  try { localStorage.removeItem(KEY); } catch { /* ignore */ }
}

export const count = (today) => upcoming(today).length;
