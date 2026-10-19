// Phone calendar glue (expo-calendar). One "Class notices" calendar is created on first use unless the user picks
// another. Events are written by UID (kept in the store), so a revised notice updates instead of duplicating.
import * as Calendar from 'expo-calendar';
import { getSettings, setSettings, uidMap, setUid, dropUid } from './store.js';
import { localDate } from './pipeline.js';

const CAL_NAME = 'Class notices';
const COLOR = '#3d2c8d';

export async function ensurePermission() {
  const { status } = await Calendar.requestCalendarPermissionsAsync();
  return status === 'granted';
}

export async function listCalendars() {
  const all = await Calendar.getCalendarsAsync(Calendar.EntityTypes.EVENT);
  return all.filter((c) => c.allowsModifications);
}

export async function targetCalendarId() {
  const s = await getSettings();
  const cals = await listCalendars();
  if (s.calendarId && cals.some((c) => c.id === s.calendarId)) return s.calendarId;
  const mine = cals.find((c) => c.title === CAL_NAME);
  if (mine) { await setSettings({ calendarId: mine.id }); return mine.id; }
  const id = await Calendar.createCalendarAsync({
    title: CAL_NAME, color: COLOR, entityType: Calendar.EntityTypes.EVENT, name: CAL_NAME,
    source: { isLocalAccount: true, name: 'Notice Decoder', type: Calendar.SourceType.LOCAL },
    ownerAccount: 'personal', accessLevel: Calendar.CalendarAccessLevel.OWNER,
  });
  await setSettings({ calendarId: id });
  return id;
}

// expo-calendar numbers the weekdays Sunday = 1 ... Saturday = 7.
const WEEKDAY = { SU: 1, MO: 2, TU: 3, WE: 4, TH: 5, FR: 6, SA: 7 };

function recurrenceOf(rule) {
  const occurrence = Number(/COUNT=(\d+)/.exec(rule)?.[1] || 1);
  const by = /BYDAY=([A-Z,]+)/.exec(rule)?.[1];
  if (!by) return { frequency: Calendar.Frequency.DAILY, occurrence };
  return { frequency: Calendar.Frequency.WEEKLY, daysOfTheWeek: by.split(',').map((c) => ({ dayOfTheWeek: WEEKDAY[c] })), occurrence };
}

function details(entry) {
  return {
    title: entry.summary,
    startDate: localDate(entry.start),
    endDate: localDate(entry.end),
    allDay: entry.allDay,
    location: entry.location || '',
    notes: `${entry.description}\nuid:${entry.uid}`,
    timeZone: 'Asia/Kolkata',
    alarms: entry.reminder ? [{ relativeOffset: -entry.reminder.minutes }] : [],
    ...(entry.recurrence ? { recurrenceRule: recurrenceOf(entry.recurrence) } : {}),
  };
}

// Writes the entries; returns { added, updated }.
export async function upsertAll(entries) {
  const calId = await targetCalendarId();
  const map = await uidMap();
  let added = 0, updated = 0;
  const ids = [];
  for (const entry of entries) {
    const known = map[entry.uid];
    let stillThere = null;
    if (known) { try { stillThere = await Calendar.getEventAsync(known); } catch { stillThere = null; } }
    if (stillThere) {
      await Calendar.updateEventAsync(known, details(entry));
      updated++;
      ids.push(known);
    } else {
      const id = await Calendar.createEventAsync(calId, details(entry));
      await setUid(entry.uid, id);
      added++;
      ids.push(id);
    }
  }
  return { added, updated, ids };
}

export async function removeByUids(uids) {
  const map = await uidMap();
  let n = 0;
  for (const uid of uids) {
    if (!map[uid]) continue;
    try { await Calendar.deleteEventAsync(map[uid]); n++; } catch { /* gone already */ }
    await dropUid(uid);
  }
  return n;
}
