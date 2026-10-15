// Settings and bookkeeping in AsyncStorage. Keys are small JSON blobs; nothing leaves the phone.
import AsyncStorage from '@react-native-async-storage/async-storage';

const KEYS = {
  settings: 'nd.settings',   // { groups: [names], autoAdd: true, calendarId: null, classId: '' , classSecret: '' }
  seen: 'nd.seen',           // [hash, ...] of handled notifications (last 500)
  titles: 'nd.titles',       // WhatsApp conversation titles seen, for the group picker (last 50)
  uids: 'nd.uids',           // { uid: calendarEventId }
  log: 'nd.log',             // [{ at, kind, text }] last 50
  pending: 'nd.pending',     // [{ id, group, text, at, amber: [events], clean: [titles] }] waiting for a check
};

async function read(key, fallback) {
  try { const v = await AsyncStorage.getItem(key); return v ? JSON.parse(v) : fallback; } catch { return fallback; }
}
const write = (key, value) => AsyncStorage.setItem(key, JSON.stringify(value));

export const DEFAULT_SETTINGS = { groups: [], autoAdd: true, calendarId: null, classId: '', classSecret: '' };
export const getSettings = () => read(KEYS.settings, DEFAULT_SETTINGS).then((s) => ({ ...DEFAULT_SETTINGS, ...s }));
export const setSettings = async (patch) => { const s = { ...(await getSettings()), ...patch }; await write(KEYS.settings, s); return s; };

export async function alreadySeen(hash) { return (await read(KEYS.seen, [])).includes(hash); }
export async function markSeen(hash) { const seen = await read(KEYS.seen, []); seen.push(hash); await write(KEYS.seen, seen.slice(-500)); }

export async function rememberTitle(title) {
  if (!title) return;
  const t = (await read(KEYS.titles, [])).filter((x) => x !== title);
  t.unshift(title);
  await write(KEYS.titles, t.slice(0, 50));
}
export const seenTitles = () => read(KEYS.titles, []);

export const uidMap = () => read(KEYS.uids, {});
export async function setUid(uid, eventId) { const m = await uidMap(); m[uid] = eventId; await write(KEYS.uids, m); }
export async function dropUid(uid) { const m = await uidMap(); delete m[uid]; await write(KEYS.uids, m); }

export async function log(kind, text) {
  const l = await read(KEYS.log, []);
  l.unshift({ at: new Date().toISOString(), kind, text });
  await write(KEYS.log, l.slice(0, 50));
}
export const getLog = () => read(KEYS.log, []);

export const getPending = () => read(KEYS.pending, []);
export async function addPending(item) { const p = await getPending(); p.unshift(item); await write(KEYS.pending, p.slice(0, 20)); }
export async function removePending(id) { await write(KEYS.pending, (await getPending()).filter((x) => x.id !== id)); }
