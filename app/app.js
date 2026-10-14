// Notice Decoder UI. Vanilla ES module, no build step.
// Engine contract: ./engine/parse.js, ./engine/clash.js, ./engine/ics.js (see CLAUDE.md).
import { parseNotice } from './engine/parse.js';
import { findClashes } from './engine/clash.js';
import { toICS, gcalUrl } from './engine/ics.js';
import { SAMPLES } from './samples.js';

const TYPE_LABELS = { test: 'Test', deadline: 'Deadline', lecture: 'Lecture', other: 'Other' };
const PALETTE_SIZE = 6; // matches .c0 to .c5 in styles.css
const NULLABLE = new Set(['date', 'start', 'end', 'venue']);
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const TIME_RE = /^\d{1,2}:\d{2}$/;
const WARN_STYLE = {
  error: { label: 'Error' },
  warn: { label: 'Check' },
  info: { label: 'Note' },
};
const FIELDS = [
  { key: 'title', label: 'Title', type: 'text', wide: true },
  { key: 'type', label: 'Type', type: 'select' },
  { key: 'date', label: 'Date', type: 'date' },
  { key: 'start', label: 'Start', type: 'time' },
  { key: 'end', label: 'End', type: 'time' },
  { key: 'venue', label: 'Venue', type: 'text', wide: true },
];
const EMPTY_INPUT_MSG = 'Paste a notice first. Copy the text from WhatsApp, a PDF or the notice board, then press Decode.';
const PARSE_ERROR_MSG = 'The decoder could not read this notice. Try again with less text, or add the events by hand.';
const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

const $ = (sel) => document.querySelector(sel);
const els = {
  input: $('#notice-input'),
  inputError: $('#input-error'),
  decode: $('#decode-btn'),
  clear: $('#clear-btn'),
  samples: $('#sample-list'),
  results: $('#results'),
  warnings: $('#warnings'),
  noticeDate: $('#notice-date'),
  noticeText: $('#notice-text'),
  eventList: $('#event-list'),
  eventsEmpty: $('#events-empty'),
  eventsHint: $('#events-hint'),
  summary: $('#summary'),
  add: $('#add-btn'),
  clashDays: $('#clash-days'),
  clashHint: $('#clash-hint'),
  clashWrap: $('#clash-table-wrap'),
  clashRows: $('#clash-rows'),
  pending: $('#pending-section'),
  pendingList: $('#pending-list'),
  notes: $('#notes-section'),
  notesList: $('#notes-list'),
  reminders: $('#reminders'),
  exportBtn: $('#export-btn'),
  exportStatus: $('#export-status'),
};

const state = {
  decodedText: '',
  result: null,
  events: [],       // working copies; user edits are applied here, never re-parsed
  manualCount: 0,
  exportNote: null, // { kind: 'ok' | 'error', text }
};
const cards = new Map();       // event id -> card element
let marksByKey = new Map();    // "eventId:field" -> [mark elements] in the notice

// ---------- small helpers ----------

// DOM builder: el('p', { class: 'x', onclick: fn }, 'text', childNode). Text is never parsed as HTML.
function el(tag, props = {}, ...children) {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(props)) {
    if (value === undefined || value === null || value === false) continue;
    if (key === 'class') node.className = value;
    else if (key === 'dataset') Object.assign(node.dataset, value);
    else if (key === 'style') Object.assign(node.style, value);
    else if (key.startsWith('on')) node.addEventListener(key.slice(2), value);
    else node.setAttribute(key, value === true ? '' : String(value));
  }
  node.append(...children.flat().filter((c) => c !== null && c !== undefined && c !== false));
  return node;
}

const safeDate = (v) => (typeof v === 'string' && DATE_RE.test(v) ? v : null);
const safeTime = (v) => (typeof v === 'string' && TIME_RE.test(v) ? v.padStart(5, '0') : null);
const titleOf = (ev) => (ev.title || '').trim() || 'Untitled event';
const keyOf = (eventId, field) => `${eventId}:${field}`;

function toMinutes(hhmm) {
  if (typeof hhmm !== 'string' || !TIME_RE.test(hhmm)) return null;
  const [h, m] = hhmm.split(':').map(Number);
  return h * 60 + m;
}

function fmtDate(iso) {
  if (!safeDate(iso)) return iso || '';
  const [y, m, d] = iso.split('-').map(Number);
  return new Intl.DateTimeFormat('en-GB', {
    weekday: 'short', day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC',
  }).format(new Date(Date.UTC(y, m - 1, d)));
}

function hourLabel(min) {
  const h = Math.floor(min / 60) % 24;
  return `${h % 12 || 12} ${h < 12 ? 'AM' : 'PM'}`;
}

// Copy an engine event into a working copy the UI may edit. Colour is fixed per event.
function workingCopy(raw, index) {
  return {
    id: String(raw.id ?? `e${index + 1}`),
    title: raw.title ?? '',
    type: TYPE_LABELS[raw.type] ? raw.type : 'other',
    typeLabel: raw.typeLabel || TYPE_LABELS[raw.type] || 'Other',
    date: safeDate(raw.date),
    start: safeTime(raw.start),
    end: safeTime(raw.end),
    venue: raw.venue || null,
    durationMin: Number.isFinite(raw.durationMin) ? raw.durationMin : null,
    link: raw.link || null,
    repeat: Number.isFinite(raw.repeat) ? raw.repeat : null,
    point: Boolean(raw.point),
    window: Boolean(raw.window),
    sources: { ...(raw.sources || {}) },
    why: { ...(raw.why || {}) },
    flags: Array.isArray(raw.flags) ? [...raw.flags] : [],
    color: index % PALETTE_SIZE,
  };
}

// ---------- decode ----------

function showInputError(msg) {
  els.inputError.textContent = msg;
  els.inputError.hidden = false;
  els.input.setAttribute('aria-invalid', 'true');
  els.input.focus();
}

function clearInputError() {
  els.inputError.hidden = true;
  els.input.removeAttribute('aria-invalid');
}

function decode(text) {
  if (!text.trim()) {
    showInputError(EMPTY_INPUT_MSG);
    return;
  }
  clearInputError();
  let result;
  try {
    result = parseNotice(text, { pastedAt: new Date() });
  } catch (err) {
    console.error('parseNotice failed', err);
    showInputError(PARSE_ERROR_MSG);
    return;
  }
  state.decodedText = text;
  state.result = result;
  state.events = (result.events || []).map((raw, i) => workingCopy(raw, i));
  state.exportNote = null;
  els.results.hidden = false;
  renderAll();
  els.noticeText.classList.add('draw'); // highlighter strokes draw in once per decode, not on every edit
  setTimeout(() => els.noticeText.classList.remove('draw'), 3000);
  els.results.focus();
}

function clearAll() {
  els.input.value = '';
  clearInputError();
  state.decodedText = '';
  state.result = null;
  state.events = [];
  state.exportNote = null;
  cards.clear();
  els.results.hidden = true;
  els.input.focus();
}

// ---------- render: whole page ----------

function renderAll() {
  const anchor = state.result?.anchorDate;
  els.noticeDate.textContent = state.result?.anchorFromNotice && safeDate(anchor) ? `Notice dated ${fmtDate(anchor)}.` : '';
  renderWarnings();
  renderNotice();
  renderEvents();
  renderClashes();
  renderLists();
  renderExport();
}

function renderWarnings() {
  const items = state.result?.warnings || [];
  els.warnings.replaceChildren(...items.map((w) => {
    const level = WARN_STYLE[w.level] ? w.level : 'info';
    const style = WARN_STYLE[level];
    return el('li', { class: `warn-${level}` },
      el('span', {}, el('strong', {}, `${style.label}. `), String(w.msg || '')));
  }));
  els.warnings.hidden = items.length === 0;
}

// ---------- render: notice with highlights ----------

// Every source range of every event, in event order. Owner = first covering span.
function noticeSpans() {
  const len = state.decodedText.length;
  const spans = [];
  for (const ev of state.events) {
    for (const [field, range] of Object.entries(ev.sources)) {
      const [s, e] = Array.isArray(range) ? range : [];
      if (Number.isInteger(s) && Number.isInteger(e) && s >= 0 && e > s && e <= len) {
        spans.push({ s, e, field, eventId: ev.id, color: ev.color });
      }
    }
  }
  return spans;
}

function renderNotice() {
  const text = state.decodedText;
  const spans = noticeSpans();
  marksByKey = new Map();
  const cuts = new Set([0, text.length]);
  for (const sp of spans) {
    cuts.add(sp.s);
    cuts.add(sp.e);
  }
  const points = [...cuts].sort((a, b) => a - b);
  const nodes = [];
  for (let i = 0; i < points.length - 1; i++) {
    const a = points[i];
    const b = points[i + 1];
    const chunk = text.slice(a, b);
    const covering = spans.filter((sp) => sp.s <= a && sp.e >= b);
    if (!covering.length) {
      nodes.push(chunk);
      continue;
    }
    const owner = covering[0];
    const mark = el('mark', {
      class: `c${owner.color}`,
      tabindex: '0',
      dataset: { owners: JSON.stringify([...new Set(covering.map((sp) => sp.eventId))]) },
    }, chunk);
    mark.style.setProperty('--i', nodes.filter((n) => typeof n !== 'string').length);
    for (const sp of covering) {
      const key = keyOf(sp.eventId, sp.field);
      marksByKey.set(key, [...(marksByKey.get(key) || []), mark]);
    }
    nodes.push(mark);
  }
  els.noticeText.replaceChildren(...nodes);
}

function setHot(event, on) {
  const mark = event.target.closest('mark');
  if (!mark) return;
  for (const id of JSON.parse(mark.dataset.owners)) {
    cards.get(id)?.classList.toggle('hot', on);
  }
}

function pulseSource(eventId, field) {
  const marks = marksByKey.get(keyOf(eventId, field)) || [];
  if (!marks.length) return;
  marks.forEach((m) => m.classList.remove('pulse'));
  void marks[0].offsetWidth; // restart the animation
  marks.forEach((m) => m.classList.add('pulse'));
  marks[0].scrollIntoView({ block: 'center', behavior: reduceMotion ? 'auto' : 'smooth' });
  setTimeout(() => marks.forEach((m) => m.classList.remove('pulse')), 2000);
}

// ---------- render: event cards ----------

function renderEvents() {
  cards.clear();
  els.eventList.replaceChildren(...state.events.map(buildCard));
  els.eventsEmpty.hidden = state.events.length > 0;
  renderEventsHint();
}

// Only flagged fields need the student's eyes; say how many, so the rest can be trusted at a glance.
const toCheck = (ev) => (ev.flags || []).filter((f) => f.level === 'warn');

function renderEventsHint() {
  const n = state.events.reduce((sum, ev) => sum + toCheck(ev).length, 0);
  els.eventsHint.textContent = !state.events.length ? ''
    : n === 0 ? 'Nothing to check. Every field was read from the notice; edit any of them and the clash check updates.'
      : `${n} field${n > 1 ? 's need' : ' needs'} a check (outlined in amber). The rest came straight from the notice.`;
}

// Status line, amber outlines and the Google Calendar link, refreshed after every edit.
function renderCheck(ev, card) {
  const warn = toCheck(ev);
  const line = ev.manual ? 'Added by you: fill in the fields.'
    : warn.length ? `Check: ${warn.map((f) => f.msg).join(' ')}` : 'Nothing to check.';
  card.querySelector('.check-line').replaceChildren(line, warn.length && ev.date ? el('button', {
    type: 'button', class: 'btn small confirm', onclick: () => confirmEvent(ev, card),
  }, 'Looks right') : '');
  card.querySelector('.check-line').classList.toggle('ok', !ev.manual && !warn.length);
  for (const spec of FIELDS) {
    card.querySelector(`[data-field="${spec.key}"]`).classList.toggle('needs-check', warn.some((f) => f.field === spec.key));
  }
  card.querySelector('.flags').replaceChildren(...(ev.flags || []).filter((f) => f.level !== 'warn').map((f) =>
    el('p', { class: 'chip chip-info' }, String(f.msg || ''))));
  const url = warn.length ? null : gcalUrl(ev); // no export before the student has checked it
  const gcal = card.querySelector('.gcal');
  gcal.hidden = !url;
  if (url) gcal.href = url;
}

function buildCard(ev) {
  const card = el('article', { class: `card ev c${ev.color}`, dataset: { id: ev.id } });
  cards.set(ev.id, card);
  card.append(
    el('div', { class: 'card-head' },
      el('span', { class: 'badge' }, ev.typeLabel),
      el('span', { class: 'head-actions' },
        el('a', { class: 'btn small gcal', target: '_blank', rel: 'noopener', 'aria-label': `Add ${titleOf(ev)} to Google Calendar` }, 'Add to Google Calendar'),
        el('button', {
          type: 'button',
          class: 'btn small',
          'aria-label': `Delete ${titleOf(ev)}`,
          onclick: () => removeEvent(ev),
        }, 'Delete'))),
    el('p', { class: 'check-line' }),
    el('div', { class: 'fields' }, ...FIELDS.map((spec) => buildField(ev, card, spec))),
    el('div', { class: 'flags' }),
  );
  renderCheck(ev, card);
  return card;
}

function buildField(ev, card, spec) {
  const control = spec.type === 'select'
    ? el('select', {}, ...Object.entries(TYPE_LABELS).map(([value, label]) =>
      el('option', { value, selected: value === ev.type }, label)))
    : el('input', { type: spec.type, value: ev[spec.key] ?? '' });
  control.addEventListener('input', () => onEdit(ev, card, spec.key, control.value));
  return el('div', { class: spec.wide ? 'field wide' : 'field', dataset: { field: spec.key } },
    el('label', {}, el('span', { class: 'lbl' }, spec.label), control),
    buildWhy(ev, spec.key));
}

// The "why" line under a field, with a jump to the highlighted source when one exists.
function buildWhy(ev, field) {
  const reason = ev.why?.[field];
  const hasSource = Array.isArray(ev.sources?.[field]);
  return el('div', { class: 'why', dataset: { why: field } },
    reason ? `why: ${reason}` : null,
    hasSource ? el('button', {
      type: 'button',
      class: 'link',
      onclick: () => pulseSource(ev.id, field),
    }, 'Show in notice') : null);
}

// The student read the flagged fields and they are correct as they are.
function confirmEvent(ev, card) {
  ev.flags = (ev.flags || []).filter((f) => f.level !== 'warn');
  renderCheck(ev, card);
  renderEventsHint();
  renderExport();
}

function onEdit(ev, card, field, raw) {
  ev[field] = raw === '' && NULLABLE.has(field) ? null : raw;
  if (field === 'type') {
    ev.typeLabel = TYPE_LABELS[raw] || ev.typeLabel;
    card.querySelector('.badge').textContent = ev.typeLabel;
  }
  if (ev.sources) delete ev.sources[field]; // the notice no longer backs this field
  ev.why = { ...ev.why, [field]: 'edited by you' };
  ev.flags = (ev.flags || []).filter((f) => f.field !== field); // the student has now checked it
  card.querySelector(`[data-why="${field}"]`).replaceWith(buildWhy(ev, field));
  renderCheck(ev, card);
  renderEventsHint();
  state.exportNote = null;
  renderNotice();
  renderClashes();
  renderExport();
}

function removeEvent(ev) {
  state.events = state.events.filter((item) => item !== ev);
  cards.get(ev.id)?.remove();
  cards.delete(ev.id);
  afterListChange();
}

function addManual() {
  const n = ++state.manualCount;
  const ev = { ...workingCopy({ id: `manual-${n}` }, state.events.length), manual: true };
  state.events = [...state.events, ev];
  const card = buildCard(ev);
  els.eventList.append(card);
  afterListChange();
  card.querySelector('input').focus();
}

function afterListChange() {
  state.exportNote = null;
  els.eventsEmpty.hidden = state.events.length > 0;
  renderEventsHint();
  renderNotice();
  renderClashes();
  renderExport();
}

// ---------- render: clashes ----------

function currentClashes() {
  try {
    return findClashes(state.events) || [];
  } catch (err) {
    console.error('findClashes failed', err);
    return [];
  }
}

function groupByDate(events) {
  const map = new Map();
  for (const ev of events) {
    if (ev.date) map.set(ev.date, [...(map.get(ev.date) || []), ev]);
  }
  return [...map].sort(([a], [b]) => a.localeCompare(b));
}

function renderClashes() {
  const clashes = currentClashes();
  const byId = new Map(state.events.map((ev) => [ev.id, ev]));
  const days = groupByDate(state.events).filter(([, evs]) => evs.length >= 2);
  els.clashDays.replaceChildren(...days.map(([iso, evs]) => renderDay(iso, evs, clashes)).filter(Boolean));
  const rows = clashes.map((c) => clashRow(c, byId)).filter(Boolean);
  els.clashRows.replaceChildren(...rows);
  els.clashWrap.hidden = rows.length === 0;
  els.clashHint.textContent = days.length
    ? 'Each day with two or more events is checked below. Red means the times collide.'
    : 'No two events share a date, so there is nothing to check yet.';
}

// Start/end in minutes. A deadline with no end is a point in time.
function intervalOf(ev) {
  const s = toMinutes(ev.start);
  if (s === null) return null;
  const e = toMinutes(ev.end);
  if (e === null && (ev.type === 'deadline' || ev.point)) return { s, e: s, point: true, open: false };
  const hasEnd = e !== null && e > s;
  return { s, e: hasEnd ? e : s + (ev.durationMin || 60), point: false, open: !hasEnd };
}

function rangeText(ev, iv) {
  if (iv.point) return `by ${ev.start}`;
  return iv.open ? `${ev.start} (end not given)` : `${ev.start}-${ev.end}`;
}

function renderDay(iso, evs, clashes) {
  const items = evs.map((ev) => ({ ev, iv: intervalOf(ev) })).filter((x) => x.iv);
  if (!items.length) return null;
  const lo = Math.max(0, Math.floor((Math.min(...items.map((x) => x.iv.s)) - 30) / 60) * 60);
  const hi = Math.min(1440, Math.max(lo + 60, Math.ceil((Math.max(...items.map((x) => x.iv.e)) + 30) / 60) * 60));
  const step = hi - lo > 360 ? 120 : 60;
  const pct = (m) => ((m - lo) / (hi - lo)) * 100;
  const span = (from, to) => ({ left: `${pct(from)}%`, width: `${pct(to) - pct(from)}%` });

  const body = el('div', { class: 'tl-body' });
  body.style.setProperty('--ticks', Math.floor((hi - lo) / step) + 1);
  const axis = el('div', { class: 'tl-axis' });
  for (let m = Math.ceil(lo / step) * step; m <= hi; m += step) {
    body.append(el('span', { class: 'tl-grid', style: { left: `${pct(m)}%` } }));
    axis.append(el('span', { class: 'tl-tick', style: { left: `${pct(m)}%` } }, hourLabel(m)));
  }
  body.append(axis);

  const byId = new Map(items.map((x) => [x.ev.id, x.iv]));
  for (const c of clashes) {
    const a = byId.get(c.a);
    const b = byId.get(c.b);
    if (!a || !b || c.kind !== 'overlap') continue;
    const s = Math.max(a.s, b.s);
    const e = Math.min(a.e, b.e);
    if (e > s) {
      body.append(el('div', { class: 'tl-band', style: span(s, e) },
        el('span', { class: 'tl-band-label' }, `${c.overlapMin ?? e - s} MIN OVERLAP`)));
    }
  }
  for (const { iv } of items) {
    if (iv.point) body.append(el('span', { class: 'tl-dash', style: { left: `${pct(iv.s)}%` } }));
  }
  for (const { ev, iv } of items) {
    const mark = iv.point
      ? el('span', { class: 'tl-diamond', style: { left: `${pct(iv.s)}%` } })
      : el('span', { class: `tl-bar c${ev.color}`, style: span(iv.s, iv.e) });
    body.append(el('div', { class: 'tl-row' },
      el('div', { class: 'tl-label' }, el('span', { class: `dot c${ev.color}` }), `${rangeText(ev, iv)} ${titleOf(ev)}`),
      el('div', { class: 'tl-track' }, mark)));
  }
  return el('div', { class: 'tl-day' },
    el('h3', { class: 'tl-day-title' }, fmtDate(iso)),
    el('div', { class: 'tl-scroll' }, body));
}

function clashRow(c, byId) {
  const a = byId.get(c.a);
  const b = byId.get(c.b);
  if (!a || !b) return null;
  const isClash = c.kind !== 'none';
  const msg = String(c.msg || '').replace(/^(no clash|clash)\.\s*/i, '');
  return el('tr', {},
    el('td', {}, `${titleOf(a)} x ${titleOf(b)}`),
    el('td', {},
      el('p', { class: isClash ? 'verdict bad' : 'verdict ok' },
        el('strong', {}, isClash ? 'Clash.' : 'No clash.'), ` ${msg}`),
      c.action ? el('p', { class: 'action' }, String(c.action)) : null));
}

// ---------- render: waiting list, notes ----------

function renderLists() {
  const pending = state.result?.pending || [];
  const notes = state.result?.notes || [];
  els.pendingList.replaceChildren(...pending.map((p) => el('li', {},
    el('strong', {}, p.title || 'Undated item'),
    p.text ? ` ${p.text}` : null,
    p.why ? el('div', { class: 'why' }, `why: ${p.why}`) : null)));
  els.pending.hidden = pending.length === 0;
  els.notesList.replaceChildren(...notes.map((n) => el('li', {}, String(n))));
  els.notes.hidden = notes.length === 0;
}

// ---------- export ----------

function renderSummary() {
  const n = state.events.length;
  if (!n) { els.summary.textContent = ''; return; }
  const clashes = currentClashes().filter((c) => c.kind !== 'none').length;
  const checks = state.events.reduce((sum, ev) => sum + toCheck(ev).length, 0);
  els.summary.replaceChildren(
    `${n} event${n > 1 ? 's' : ''} found. `,
    clashes ? el('a', { href: '#clash-title' }, `${clashes} clash${clashes > 1 ? 'es' : ''}`) : 'No clashes',
    '. ',
    checks ? `${checks} field${checks > 1 ? 's' : ''} to check before you can add them to your calendar.` : 'Nothing to check: ',
    checks ? '' : el('a', { href: '#export-title' }, 'add them to your calendar'),
    checks ? '' : '.');
}

function renderExport() {
  renderSummary();
  const undated = state.events.filter((ev) => !ev.date);
  let blocked = null;
  if (!state.events.length) blocked = 'Add an event before you download.';
  else if (undated.length) blocked = `Add a date to: ${undated.map(titleOf).join(', ')}.`;
  else if (state.events.some((ev) => toCheck(ev).length)) blocked = `Check the amber fields first: ${state.events.filter((ev) => toCheck(ev).length).map(titleOf).join(', ')}.`;
  els.exportBtn.disabled = Boolean(blocked);
  const shown = blocked ? { kind: 'error', text: blocked } : state.exportNote;
  els.exportStatus.textContent = shown?.text || '';
  els.exportStatus.dataset.kind = shown?.kind || '';
}

function downloadIcs() {
  try {
    const ics = toICS(state.events, { reminders: els.reminders.checked });
    const url = URL.createObjectURL(new Blob([ics], { type: 'text/calendar;charset=utf-8' }));
    const link = el('a', { href: url, download: 'notice-events.ics' });
    document.body.append(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    const n = state.events.length;
    state.exportNote = {
      kind: 'ok',
      text: `Saved. Open the file to add ${n} ${n === 1 ? 'event' : 'events'} to Google, Outlook or Apple Calendar.`,
    };
  } catch (err) {
    console.error('Calendar export failed', err);
    state.exportNote = {
      kind: 'error',
      text: 'The calendar file could not be made. Check each event date and time, then try again.',
    };
  }
  renderExport();
}

// ---------- wiring ----------

function renderSamples() {
  els.samples.replaceChildren(...SAMPLES.map((s) => el('button', {
    type: 'button',
    class: 'chip-btn',
    onclick: () => {
      els.input.value = s.text;
      decode(s.text);
    },
  }, s.label)));
}

function init() {
  renderSamples();
  els.decode.addEventListener('click', () => decode(els.input.value));
  els.clear.addEventListener('click', clearAll);
  els.input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
      e.preventDefault();
      decode(els.input.value);
    }
  });
  els.input.addEventListener('input', () => {
    if (els.input.value.trim()) clearInputError();
  });
  els.add.addEventListener('click', addManual);
  els.exportBtn.addEventListener('click', downloadIcs);
  for (const type of ['mouseover', 'focusin']) {
    els.noticeText.addEventListener(type, (e) => setHot(e, true));
  }
  for (const type of ['mouseout', 'focusout']) {
    els.noticeText.addEventListener(type, (e) => setHot(e, false));
  }
}

init();
