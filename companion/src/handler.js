// The one path every notice takes, whatever brought it in (WhatsApp notification, the debug button, a shared text):
// plan -> clean entries into the calendar (when auto-add is on) -> amber ones parked for a check -> notifications.
import { plan, fromNotification, hash } from './pipeline.js';
import { getSettings, alreadySeen, markSeen, rememberTitle, log, addPending } from './store.js';
import { upsertAll } from './calendar.js';
import { notifyAdded, notifyCheck, notifyClash } from './notify.js';
import { publishIfCR } from './feed.js';

export async function handleNotice(text, { group = '', receivedAt = new Date(), force = false } = {}) {
  const settings = await getSettings();
  const p = plan(text, receivedAt);
  const out = { added: 0, updated: 0, amber: p.amber.length, clashes: p.clashes.length, events: p.result.events.length };
  if (!p.result.events.length) { await log('skip', `${group || 'text'}: no dated events`); return out; }
  if (p.entries.length && (settings.autoAdd || force)) {
    const r = await upsertAll(p.entries);
    out.added = r.added; out.updated = r.updated;
    await notifyAdded(p.entries, { group });
    await log('added', `${group || 'text'}: ${p.entries.map((e) => e.summary).join(', ')}`);
    publishIfCR(p.clean).catch(() => {});
  } else if (p.entries.length) {
    // auto-add off: the clean ones also wait for a tap
    p.amber.push(...p.clean);
    out.amber = p.amber.length;
  }
  if (p.amber.length) {
    const id = `${Date.now().toString(36)}-${hash(text)}`;
    await addPending({ id, group, text, at: new Date().toISOString(), amber: p.amber, clean: p.clean.map((e) => e.title) });
    await notifyCheck(id, p.amber, group);
    await log('check', `${group || 'text'}: ${p.amber.map((e) => e.title).join(', ')}`);
  }
  if (p.clashes.length) await notifyClash(p.clashes);
  return out;
}

// Headless task target: one raw notification from react-native-android-notification-listener.
export async function handleNotification(raw) {
  let n = raw;
  try { if (typeof raw === 'string') n = JSON.parse(raw); } catch { return; }
  if (!n || !n.app) return;
  if (/whatsapp/.test(n.app)) await rememberTitle(n.title);
  const settings = await getSettings();
  for (const m of fromNotification(n, settings.groups)) {
    if (await alreadySeen(m.hash)) continue;
    await markSeen(m.hash);
    try { await handleNotice(m.text, { group: m.group, receivedAt: n.time ? new Date(Number(n.time)) : new Date() }); }
    catch (err) { await log('error', String(err?.message || err)); }
  }
}
