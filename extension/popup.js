// Popup: the same rules engine as the web app (engine.js is dist/notice-engine.js), run on the text in the box.
const APP = 'https://noticedecoder.pages.dev/app/';
const E = globalThis.NoticeEngine;
const $ = (id) => document.getElementById(id);
const el = (tag, cls, text) => { const n = document.createElement(tag); if (cls) n.className = cls; if (text != null) n.textContent = text; return n; };

async function selectedText() {
  const { pending } = await chrome.storage.session.get('pending');
  if (pending) { await chrome.storage.session.remove('pending'); chrome.action.setBadgeText({ text: '' }); return { text: pending, from: 'right-click' }; }
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab || !tab.id || /^(chrome|edge|about|chrome-extension):/.test(tab.url || '')) return { text: '', from: '' };
    const [res] = await chrome.scripting.executeScript({ target: { tabId: tab.id }, func: () => String(window.getSelection() || '') });
    return { text: (res && res.result) || '', from: 'selection' };
  } catch { return { text: '', from: '' }; }
}

function when(e) {
  const parts = [];
  if (e.date) parts.push(E.prettyDate(e.date));
  if (e.start) parts.push(E.fmt12(e.start) + (e.end ? ' to ' + E.fmt12(e.end) : ''));
  if (e.venue) parts.push(e.venue);
  return parts.join(' · ') || 'No date found';
}

function download(name, content, type) {
  const url = URL.createObjectURL(new Blob([content], { type }));
  const a = Object.assign(document.createElement('a'), { href: url, download: name });
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function render(text) {
  const out = $('out'); out.textContent = '';
  const r = E.parseNotice(text);
  for (const w of r.warnings.filter((w) => w.level === 'error')) out.appendChild(el('p', 'err', w.msg));
  if (!r.events.length) { if (!r.warnings.length) out.appendChild(el('p', 'err', 'No event found in this text.')); return; }
  const events = r.events.filter((e) => e.date);

  let anyWarn = false;
  for (const e of r.events) {
    const warns = e.flags.filter((f) => f.level === 'warn');
    if (warns.length) anyWarn = true;
    const card = el('div', 'ev' + (warns.length ? ' amber' : ''));
    const h = el('h3'); h.append(el('span', 'tag', e.typeLabel || e.type), e.title); card.appendChild(h);
    card.appendChild(el('div', 'when', when(e)));
    for (const f of e.flags.filter((f) => f.level !== 'info')) card.appendChild(el('div', 'flag', f.msg));
    const g = E.gcalUrl(e);
    if (g && !warns.length) { const a = el('a', 'gcal', 'Add to Google Calendar'); a.href = g; a.target = '_blank'; a.rel = 'noopener'; card.appendChild(a); }
    out.appendChild(card);
  }

  out.appendChild(el('h4', null, 'Clashes'));
  const real = E.findClashes(events).filter((c) => c.kind !== 'none');
  if (!real.length) out.appendChild(el('p', 'noclash', events.length > 1 ? 'No clashes between these events.' : 'Only one dated event, nothing to clash with.'));
  for (const c of real) { const d = el('div', 'clash'); d.appendChild(el('div', null, c.msg)); if (c.action) d.appendChild(el('div', 'note', c.action)); out.appendChild(d); }

  for (const n of r.notes || []) out.appendChild(el('p', 'note', typeof n === 'string' ? n : n.msg));
  for (const w of r.warnings.filter((w) => w.level !== 'error')) out.appendChild(el('p', 'note', w.msg));

  const actions = el('div', 'actions');
  const ics = el('button', 'primary', 'Download .ics');
  if (anyWarn || !events.length) { ics.disabled = true; ics.title = 'Fix the amber fields in the full app first'; }
  ics.onclick = () => download('notice-events.ics', E.toICS(events), 'text/calendar');
  const open = el('button', null, anyWarn ? 'Fix amber fields in the app' : 'Open in the app');
  open.onclick = () => chrome.tabs.create({ url: APP + '?text=' + encodeURIComponent(text) });
  actions.append(ics, open); out.appendChild(actions);
}

$('decode').onclick = () => render($('text').value);
$('clear').onclick = () => { $('text').value = ''; $('out').textContent = ''; $('src').textContent = ''; };
(async () => {
  const { text, from } = await selectedText();
  if (text.trim()) { $('text').value = text; $('src').textContent = from === 'right-click' ? 'from right-click' : 'from selection'; render(text); }
})();
