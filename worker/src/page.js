// The subscribe page a student opens from the class group: one tap to subscribe, what is coming up, what changed.
// Server-rendered (works with no JS); the only script draws the QR code for a projector and turns times into "2 h ago".
import { prettyDate, fmt12, addDays, weekdayOf, WEEKDAY_NAMES } from '../../app/engine/dates.js';
import { emojiOf } from '../../app/engine/ics.js';

export const QR_LIB = 'https://cdn.jsdelivr.net/npm/qrcode-generator@1.4.4/qrcode.js';
export const QR_SRI = 'sha384-8FWZA6BGMXhsfO+BLtrJK0We6gg5o1JyO8xQm6peWDEUs17ACA5ziE/NIAkl9z2k';

export const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

const whenText = (e) => (!e.start ? 'All day' : e.type === 'deadline' || e.point ? `by ${fmt12(e.start)}` : e.end ? `${fmt12(e.start)} – ${fmt12(e.end)}` : fmt12(e.start));
function dayLabel(date, today) {
  if (date === today) return 'Today';
  if (date === addDays(today, 1)) return 'Tomorrow';
  return `${WEEKDAY_NAMES[weekdayOf(date)]}, ${prettyDate(date)}`;
}
const CHANGE_WORDS = { added: 'New', moved: 'Moved', updated: 'Updated', cancelled: 'Cancelled', restored: 'Back on' };

function eventRow(e) {
  return `<li class="ev t-${esc(e.type)}"><span class="when">${esc(whenText(e))}</span><span class="what"><b>${esc(emojiOf(e))} ${esc(e.title)}</b>`
    + `${e.venue ? `<span class="where">📍 ${esc(e.venue)}</span>` : ''}${e.link ? `<a class="where" href="${esc(e.link)}" rel="noopener nofollow" target="_blank">🔗 Joining link</a>` : ''}</span></li>`;
}

export function subscribePage({ cls, id, origin, appUrl, today, clashes, changes }) {
  const feed = `${origin}/c/${id}.ics`;
  const webcal = feed.replace(/^https?:/, 'webcal:');
  const google = `https://calendar.google.com/calendar/r?cid=${encodeURIComponent(webcal)}`;
  const page = `${origin}/c/${id}`;
  const all = Object.values(cls.events).filter((e) => !e.cancelled).sort((a, b) => `${a.date}${a.start || ''}`.localeCompare(`${b.date}${b.start || ''}`));
  const upcoming = all.filter((e) => e.date >= today);
  const past = all.filter((e) => e.date < today).reverse();
  const groups = [];
  for (const e of upcoming.slice(0, 80)) {
    const g = groups.at(-1);
    if (g && g.date === e.date) g.events.push(e); else groups.push({ date: e.date, events: [e] });
  }
  const app = appUrl ? `${appUrl}#c=${id}` : null;
  const recent = changes.filter((c) => Date.parse(c.at) > Date.now() - 14 * 86400000 && c.kind !== 'added').slice(0, 6);
  const changeLine = (c) => `<li><span class="tag k-${esc(c.kind)}">${esc(CHANGE_WORDS[c.kind] || c.kind)}</span> ${esc(c.title)}: `
    + (c.kind === 'moved' && c.from ? `${esc(prettyDate(c.from.date))}${c.from.start ? ` ${esc(fmt12(c.from.start))}` : ''} → <b>${esc(prettyDate(c.date))}${c.start ? ` ${esc(fmt12(c.start))}` : ''}</b>` : `${esc(prettyDate(c.date))}${c.start ? ` ${esc(fmt12(c.start))}` : ''}`)
    + ` <time data-at="${esc(c.at)}"></time></li>`;
  const desc = `${upcoming.length} upcoming event${upcoming.length === 1 ? '' : 's'}. Subscribe once; it updates by itself when a notice changes.`;
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(cls.name)} · class calendar</title>
<meta name="robots" content="noindex"><meta name="description" content="${esc(desc)}">
<meta property="og:title" content="${esc(cls.name)} · class calendar"><meta property="og:description" content="${esc(desc)}"><meta property="og:url" content="${esc(page)}">
<meta name="theme-color" content="#3d2c8d">
<style>
:root{--bg:#f3f2f7;--card:#fff;--ink:#1d1b26;--muted:#5d5a70;--line:#dddbe6;--brand:#3d2c8d;--brand-ink:#fff;--warn:#a33a1f;--warn-bg:#fdecea;--ok:#1e6b3a}
@media (prefers-color-scheme:dark){:root{--bg:#14131a;--card:#1f1d29;--ink:#eceaf4;--muted:#a8a5bb;--line:#34313f;--brand:#8f7ff0;--brand-ink:#14131a;--warn:#ff9c84;--warn-bg:#3a1f1a;--ok:#7fd59a}}
*{box-sizing:border-box}body{margin:0;font:16px/1.5 system-ui,-apple-system,"Segoe UI",sans-serif;color:var(--ink);background:var(--bg)}
main{max-width:680px;margin:0 auto;padding:20px 16px 40px}h1{font-size:1.6rem;margin:0 0 4px;line-height:1.2}h2{font-size:1.05rem;margin:0 0 10px}
.sub{color:var(--muted);margin:0 0 16px}.card{background:var(--card);border:1px solid var(--line);border-radius:12px;padding:16px;margin:14px 0}
.btns{display:flex;flex-wrap:wrap;gap:8px}a.btn,button.btn{display:inline-flex;align-items:center;gap:6px;min-height:44px;padding:10px 16px;border-radius:8px;border:1px solid var(--line);background:var(--card);color:var(--ink);font:inherit;font-weight:600;text-decoration:none;cursor:pointer}
a.btn.p{background:var(--brand);border-color:var(--brand);color:var(--brand-ink)}small,.muted{color:var(--muted)}code{word-break:break-all;font-size:.85em}
ul{list-style:none;margin:0;padding:0}.day{margin:14px 0 6px;font-weight:700;font-size:.95rem}.day .rel{color:var(--brand)}
li.ev{display:grid;grid-template-columns:7.5em 1fr;gap:8px;padding:10px 0;border-top:1px solid var(--line)}li.ev:first-child{border-top:0}
.when{font-variant-numeric:tabular-nums;color:var(--muted);font-size:.92rem}.what b{display:block}.where{display:block;color:var(--muted);font-size:.92rem}
.clash{background:var(--warn-bg);border-color:var(--warn)}.clash h2{color:var(--warn)}.clash li{margin:6px 0}
.tag{display:inline-block;font-size:.75rem;font-weight:700;padding:1px 8px;border-radius:99px;border:1px solid var(--line);margin-right:4px}.k-cancelled{color:var(--warn);border-color:var(--warn)}.k-moved{color:var(--brand);border-color:var(--brand)}
#qr{display:none;text-align:center}#qr svg{width:min(320px,80vw);height:auto;background:#fff;padding:10px;border-radius:8px}details summary{cursor:pointer;font-weight:600}
@media (max-width:420px){li.ev{grid-template-columns:1fr}}
</style></head><body><main>
<h1>${esc(cls.name)}</h1>
<p class="sub">One calendar for the whole class. Subscribe once; when the class representative publishes a new or changed notice, your calendar updates by itself.</p>
<section class="card" aria-label="Subscribe">
<div class="btns"><a class="btn p" href="${esc(google)}">Add to Google Calendar</a><a class="btn" href="${esc(webcal)}">Apple / Outlook</a>${app ? `<a class="btn" href="${esc(app)}">Open in Notice Decoder</a>` : ''}<button class="btn" type="button" id="qr-btn" hidden>Show QR code</button></div>
<div id="qr" aria-label="QR code of this page"></div>
<p><small>Google refreshes subscribed calendars every 12 to 24 hours; Apple and Outlook about every hour; the Notice Decoder app shows changes at once. Feed: <code>${esc(feed)}</code></small></p>
</section>
${clashes.length ? `<section class="card clash" aria-label="Clashes"><h2>⚠️ ${clashes.length} clash${clashes.length === 1 ? '' : 'es'} coming up</h2><ul>${clashes.slice(0, 8).map((c) => `<li><b>${esc(prettyDate(c.date))}</b>: ${esc(c.a)} × ${esc(c.b)}. ${esc(String(c.msg).replace(/^Clash\.\s*/, ''))}</li>`).join('')}</ul></section>` : ''}
${recent.length ? `<section class="card" aria-label="Recent changes"><h2>What changed</h2><ul>${recent.map(changeLine).join('')}</ul></section>` : ''}
<section class="card" aria-label="Upcoming events"><h2>${upcoming.length} upcoming event${upcoming.length === 1 ? '' : 's'}</h2>
${groups.length ? groups.map((g) => `<p class="day">${g.date === today || g.date === addDays(today, 1) ? `<span class="rel">${esc(dayLabel(g.date, today))}</span> · ${esc(prettyDate(g.date))}` : esc(dayLabel(g.date, today))}</p><ul>${g.events.map(eventRow).join('')}</ul>`).join('') : '<p class="muted">Nothing coming up. New notices appear here as soon as they are published.</p>'}
</section>
${past.length ? `<details class="card"><summary>${past.length} past event${past.length === 1 ? '' : 's'}</summary><ul>${past.slice(0, 50).map((e) => eventRow(e).replace('<span class="when">', `<span class="when">${esc(prettyDate(e.date))} · `)).join('')}</ul></details>` : ''}
<p><small>Last published <time data-at="${esc(cls.updatedAt)}">${esc(prettyDate(cls.updatedAt.slice(0, 10)))}</time>. Published with Notice Decoder; check the original notice when in doubt.</small></p>
</main>
<script src="${QR_LIB}" integrity="${QR_SRI}" crossorigin="anonymous" defer></script>
<script>
(function(){var rtf=window.Intl&&Intl.RelativeTimeFormat?new Intl.RelativeTimeFormat('en',{numeric:'auto'}):null;
document.querySelectorAll('time[data-at]').forEach(function(t){var d=(Date.parse(t.dataset.at)-Date.now())/1000;if(!rtf||isNaN(d))return;var a=Math.abs(d);
t.textContent=a<3600?rtf.format(Math.round(d/60),'minute'):a<86400?rtf.format(Math.round(d/3600),'hour'):rtf.format(Math.round(d/86400),'day');t.title=new Date(t.dataset.at).toLocaleString();});
window.addEventListener('load',function(){if(!window.qrcode)return;var b=document.getElementById('qr-btn'),box=document.getElementById('qr');b.hidden=false;
b.addEventListener('click',function(){if(!box.innerHTML){var q=qrcode(0,'M');q.addData(location.href.split('#')[0]);q.make();box.innerHTML=q.createSvgTag(6,2);}
var on=box.style.display!=='block';box.style.display=on?'block':'none';b.textContent=on?'Hide QR code':'Show QR code';});});})();
</script></body></html>`;
}
