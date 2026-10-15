// Class feed (worker/): students pull the class calendar every 15 minutes; a class representative's phone pushes
// what it auto-added. Both optional: nothing happens until a class id is set.
import Constants from 'expo-constants';
import * as BackgroundTask from 'expo-background-task';
import * as TaskManager from 'expo-task-manager';
import { getSettings, log, uidMap } from './store.js';
import { upsertAll, removeByUids } from './calendar.js';
import { notifyAdded } from './notify.js';

export const FEED_TASK = 'nd-feed-poll';
const base = () => String(Constants.expoConfig?.extra?.feedBase || '').replace(/\/+$/, '');
const E = () => globalThis.NoticeEngine;

export const feedConfigured = () => Boolean(base());

export async function pullClass() {
  const s = await getSettings();
  if (!base() || !s.classId) return { skipped: true };
  const res = await fetch(`${base()}/c/${s.classId}.json`);
  if (!res.ok) throw new Error(`Class feed said ${res.status}`);
  const data = await res.json();
  const live = data.events.filter((e) => !e.cancelled);
  const entries = E().calendarEntries(live);
  const known = await uidMap();
  const fresh = entries.filter((e) => !known[e.uid]);
  const r = await upsertAll(entries);
  const gone = data.events.filter((e) => e.cancelled).map((e) => e.uid);
  const removed = await removeByUids(gone);
  if (fresh.length) await notifyAdded(fresh, { group: data.name });
  await log('feed', `${data.name}: ${r.added} new, ${r.updated} updated, ${removed} removed`);
  return { ...r, removed, name: data.name };
}

// CR mode: push clean events to the class feed (needs the class secret from the web app's "Publish to class").
export async function publishIfCR(events) {
  const s = await getSettings();
  if (!base() || !s.classId || !s.classSecret || !events.length) return null;
  const res = await fetch(`${base()}/api/class/${s.classId}/publish`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${s.classSecret}` },
    body: JSON.stringify({ events }),
  });
  const data = await res.json().catch(() => ({}));
  await log(res.ok ? 'publish' : 'error', res.ok ? `published ${data.added} new, ${data.updated} updated` : (data.error || `publish failed ${res.status}`));
  return data;
}

TaskManager.defineTask(FEED_TASK, async () => {
  try { await pullClass(); return BackgroundTask.BackgroundTaskResult.Success; }
  catch (err) { await log('error', `feed: ${err.message}`); return BackgroundTask.BackgroundTaskResult.Failed; }
});

export async function scheduleFeedPolling() {
  if (!feedConfigured()) return false;
  const status = await BackgroundTask.getStatusAsync();
  if (status !== BackgroundTask.BackgroundTaskStatus.Available) return false;
  if (!(await TaskManager.isTaskRegisteredAsync(FEED_TASK))) await BackgroundTask.registerTaskAsync(FEED_TASK, { minimumInterval: 15 });
  return true;
}
