// Does the live class feed read its own writes? create -> publish -> read -> edit -> cancel -> read, back to back, five
// times, with throwaway classes it deletes again. On plain KV this failed (stale reads); every row should end
// "Probe Lecture(x)@12:00, Probe Test@14:00".   node tools/consistency-probe.mjs [feed base]
import fs from 'node:fs';
const cfg = fs.readFileSync(new URL('../app/config.js', import.meta.url), 'utf8');
const FEED = (process.argv[2] || (cfg.match(/FEED_BASE = '([^']*)'/) || [])[1] || '').replace(/\/+$/, '');
const j = (r) => r.json().catch(() => ({}));
const day = new Date(Date.now() + 40 * 86400000).toISOString().slice(0, 10);
const results = [];
for (let trial = 1; trial <= 5; trial++) {
  const c = await j(await fetch(`${FEED}/api/class`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ name: `kv probe ${trial}` }) }));
  const auth = { 'content-type': 'application/json', authorization: `Bearer ${c.secret}` };
  const row = { trial };
  const pub = await j(await fetch(`${FEED}/api/class/${c.id}/publish`, { method: 'POST', headers: auth, body: JSON.stringify({ events: [{ title: 'Probe Test', type: 'test', date: day, start: '10:00' }, { title: 'Probe Lecture', type: 'lecture', date: day, start: '12:00' }] }) }));
  row.published = pub.count;
  const read1 = await j(await fetch(`${FEED}/api/class/${c.id}/events`, { headers: auth }));
  row.readAfterPublish = read1.events?.length;
  const edit = await fetch(`${FEED}/api/class/${c.id}/events/${encodeURIComponent('probe-test@notice-decoder')}`, { method: 'PATCH', headers: auth, body: JSON.stringify({ start: '14:00' }) });
  row.edit = edit.status;
  const del = await fetch(`${FEED}/api/class/${c.id}/events/${encodeURIComponent('probe-lecture@notice-decoder')}`, { method: 'DELETE', headers: auth });
  row.cancel = del.status;
  const read2 = await j(await fetch(`${FEED}/api/class/${c.id}/events`, { headers: auth }));
  row.final = (read2.events || []).map((e) => `${e.title}${e.cancelled ? '(x)' : ''}@${e.start}`).join(', ');
  await new Promise((r) => setTimeout(r, 2500));
  const read3 = await j(await fetch(`${FEED}/api/class/${c.id}/events`, { headers: auth }));
  row.after2s = (read3.events || []).map((e) => `${e.title}${e.cancelled ? '(x)' : ''}@${e.start}`).join(', ');
  await fetch(`${FEED}/api/class/${c.id}`, { method: 'DELETE', headers: auth });
  results.push(row);
  console.log(JSON.stringify(row));
}
