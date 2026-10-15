// Notice Decoder UI. Vanilla ES module, no build step.
// Engine contract: ./engine/parse.js, ./engine/clash.js, ./engine/ics.js (see AGENTS.md).
import { parseNotice } from './engine/parse.js';
import { findClashes } from './engine/clash.js';
import { toICS, gcalUrl } from './engine/ics.js';
import { SAMPLES } from './samples.js';
import * as gcal from './gcal.js';
import { FEED_BASE } from './config.js';

const AUTO_ADD_KEY = 'nd-auto-add';
const CLASS_KEY = 'nd-class'; // { id, secret, name, feed, page } for the class representative
const feedBase = () => (FEED_BASE || window.__ndFeedBase || '').replace(/\/+$/, '');
const DECODE_DEBOUNCE_MS = 900;

const TYPE_LABELS = { test: 'Test', deadline: 'Deadline', lecture: 'Lecture', other: 'Other' };
const PALETTE_SIZE = 6; // matches .c0 to .c5 in styles.css
const NULLABLE = new Set(['date', 'start', 'end', 'venue', 'link', 'durationMin']);
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
  { key: 'durationMin', label: 'Takes (minutes)', type: 'number' },
  { key: 'venue', label: 'Venue', type: 'text', wide: true },
  { key: 'link', label: 'Link', type: 'url', wide: true },
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
  paste: $('#paste-btn'),
  samples: $('#sample-list'),
  results: $('#results'),
  warnings: $('#warnings'),
  noticeCard: $('#notice-card'),
  noticeDate: $('#notice-date'),
  noticeText: $('#notice-text'),
  sharedBanner: $('#shared-banner'),
  sharedText: $('#shared-text'),
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
  gcalAll: $('#gcal-all-btn'),
  gcalNote: $('#gcal-note'),
  autoAdd: $('#auto-add'),
  copyBtn: $('#copy-btn'),
  shareBtn: $('#share-btn'),
  waBtn: $('#wa-btn'),
  exportStatus: $('#export-status'),
  classSection: $('#class-section'),
  classStatus: $('#class-status'),
  classPublish: $('#class-publish-btn'),
  classLink: $('#class-link-btn'),
  classJoin: $('#class-join'),
  classJoinBtn: $('#class-join-btn'),
  classOpenRow: $('#class-open-row'),
  classOpenResult: $('#class-open-result'),
  classResult: $('#class-result'),
  install: $('#install-btn'),
  offline: $('#offline-note'),
};

const state = {
  decodedText: '',
  result: null,
  events: [],       // working copies; user edits are applied here, never re-parsed
  manualCount: 0,
  exportNote: null, // { kind: 'ok' | 'error', text }
  shared: null,     // { from, on } when the page was opened from a class link
  lastRemoved: null, // { ev, index } for Undo
  gcalLast: null,   // { added: [...] } from the last "Add all", for Undo
  busy: false,      // an "Add all" is in flight
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
const safeUrl = (v) => (typeof v === 'string' && /^https?:\/\/\S+$/i.test(v.trim()) ? v.trim() : null);
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

function fmt12(hhmm) {
  const min = toMinutes(hhmm);
  if (min === null) return hhmm || '';
  const h = Math.floor(min / 60), m = min % 60;
  return `${h % 12 || 12}:${String(m).padStart(2, '0')} ${h < 12 ? 'AM' : 'PM'}`;
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
    durationMin: Number.isFinite(raw.durationMin) && raw.durationMin > 0 ? raw.durationMin : null,
    link: safeUrl(raw.link),
    repeat: Number.isFinite(raw.repeat) ? raw.repeat : null,
    point: Boolean(raw.point),
    window: Boolean(raw.window),
    reportAt: safeTime(raw.reportAt),
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

// `auto` = the notice arrived on its own (share sheet, clipboard): when nothing needs a check and auto-add is on,
// the events go straight to Google Calendar, with Undo. A pasted or typed notice never auto-adds.
function decode(text, { auto = false } = {}) {
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
  state.shared = null;
  state.lastRemoved = null;
  state.gcalLast = null;
  els.results.hidden = false;
  renderAll();
  els.noticeText.classList.add('draw'); // highlighter strokes draw in once per decode, not on every edit
  setTimeout(() => els.noticeText.classList.remove('draw'), 3000);
  els.results.focus();
  if (auto) maybeAutoAdd();
}

function clearAll() {
  els.input.value = '';
  clearInputError();
  state.decodedText = '';
  state.result = null;
  state.events = [];
  state.exportNote = null;
  state.shared = null;
  state.lastRemoved = null;
  cards.clear();
  els.results.hidden = true;
  if (location.hash) history.replaceState(null, '', location.pathname + location.search);
  els.input.focus();
}

// ---------- render: whole page ----------

function renderAll() {
  const anchor = state.result?.anchorDate;
  els.noticeDate.textContent = state.result?.anchorFromNotice && safeDate(anchor) ? `Notice dated ${fmtDate(anchor)}.` : '';
  els.noticeCard.hidden = !state.decodedText;
  els.sharedBanner.hidden = !state.shared;
  if (state.shared) {
    els.sharedText.textContent = `Shared by ${state.shared.from || 'your class representative'}${state.shared.on ? ` on ${fmtDate(state.shared.on)}` : ''}. Check the events, then add them to your calendar.`;
  }
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

// Only flagged fields need the student's eyes; say how many, so the rest can be trusted at a glance.
const toCheck = (ev) => (ev.flags || []).filter((f) => f.level === 'warn');
// A card (the full form) only for what needs eyes: amber fields, a manual event, or one the student opened.
const needsCard = (ev) => Boolean(ev.manual || ev.expanded || toCheck(ev).length);

// Amber first, then the clean ones as one-line rows. Order inside each group is the notice order.
function renderEvents() {
  cards.clear();
  const amber = state.events.filter(needsCard), clean = state.events.filter((ev) => !needsCard(ev));
  els.eventList.replaceChildren(...amber.map(buildCard), ...clean.map(buildRow));
  els.eventsEmpty.hidden = state.events.length > 0;
  renderEventsHint();
}

function whenText(ev) {
  if (!ev.start) return 'All day';
  if (ev.type === 'deadline' || ev.point) return `by ${fmt12(ev.start)}`;
  return ev.end ? `${fmt12(ev.start)} - ${fmt12(ev.end)}` : fmt12(ev.start);
}

function shortDate(iso) {
  if (!safeDate(iso)) return 'No date';
  const [y, m, d] = iso.split('-').map(Number);
  return new Intl.DateTimeFormat('en-GB', { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'UTC' }).format(new Date(Date.UTC(y, m - 1, d)));
}

// One line per clean event. "Edit" opens the full card.
function buildRow(ev) {
  const open = () => { ev.expanded = true; renderEvents(); cards.get(ev.id)?.querySelector('input')?.focus(); };
  const row = el('div', { class: `row ev c${ev.color}`, dataset: { id: ev.id } },
    el('span', { class: `dot c${ev.color}` }),
    el('span', { class: 'row-when' }, `${shortDate(ev.date)} · ${whenText(ev)}`),
    el('span', { class: 'row-title' }, titleOf(ev), ev.venue ? el('span', { class: 'row-venue' }, ` · ${ev.venue}`) : null),
    el('span', { class: 'badge' }, ev.typeLabel),
    el('span', { class: 'row-actions' },
      el('button', { type: 'button', class: 'link', 'aria-label': `Edit ${titleOf(ev)}`, onclick: open }, 'Edit'),
      el('button', { type: 'button', class: 'link', 'aria-label': `Delete ${titleOf(ev)}`, onclick: () => removeEvent(ev) }, 'Delete')));
  cards.set(ev.id, row);
  return row;
}

function renderEventsHint() {
  const n = state.events.reduce((sum, ev) => sum + toCheck(ev).length, 0);
  const text = !state.events.length ? ''
    : n === 0 ? 'Nothing to check. Every field was read from the notice; edit any of them and the clash check updates.'
      : `${n} field${n > 1 ? 's need' : ' needs'} a check (outlined in amber). The rest came straight from the notice.`;
  const undo = state.lastRemoved ? el('span', { class: 'undo' },
    ` Deleted "${titleOf(state.lastRemoved.ev)}". `,
    el('button', { type: 'button', class: 'link', onclick: undoRemove }, 'Undo')) : null;
  els.eventsHint.replaceChildren(...[text, undo].filter(Boolean));
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
  const url = warn.length || !titleOf(ev) ? null : gcalUrl(ev); // no export before the student has checked it
  const gcal = card.querySelector('.gcal');
  gcal.hidden = !url;
  if (url) gcal.href = url;
  const open = card.querySelector('.open-link');
  open.hidden = !ev.link;
  if (ev.link) open.href = ev.link;
}

function buildCard(ev) {
  const card = el('article', { class: `card ev c${ev.color}`, dataset: { id: ev.id } });
  cards.set(ev.id, card);
  card.append(
    el('div', { class: 'card-head' },
      el('span', { class: 'badge' }, ev.typeLabel),
      el('span', { class: 'head-actions' },
        el('a', { class: 'btn small open-link', target: '_blank', rel: 'noopener', 'aria-label': `Open the link for ${titleOf(ev)}` }, 'Open link'),
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
    : el('input', { type: spec.type, value: ev[spec.key] ?? '', min: spec.type === 'number' ? '5' : null, step: spec.type === 'number' ? '5' : null, inputmode: spec.type === 'number' ? 'numeric' : null, placeholder: spec.key === 'link' ? 'https://' : null });
  control.addEventListener('input', () => onEdit(ev, card, spec.key, control.value));
  return el('div', { class: spec.wide ? 'field wide' : 'field', dataset: { field: spec.key } },
    el('label', {}, el('span', { class: 'lbl' }, spec.label), control),
    buildWhy(ev, spec.key));
}

// The "why" line under a field, with a jump to the highlighted source when one exists.
function buildWhy(ev, field) {
  const reason = ev.why?.[field];
  const hasSource = Array.isArray(ev.sources?.[field]) && state.decodedText;
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
  let value = raw;
  if (field === 'durationMin') value = raw === '' ? null : Math.max(0, Math.round(Number(raw))) || null;
  else if (field === 'link') value = raw.trim() === '' ? null : raw.trim();
  else if (raw === '' && NULLABLE.has(field)) value = null;
  ev[field] = value;
  if (field === 'type') {
    ev.typeLabel = TYPE_LABELS[raw] || ev.typeLabel;
    card.querySelector('.badge').textContent = ev.typeLabel;
  }
  if (field === 'durationMin' && value && ev.start && !ev.end && ev.type !== 'deadline') {
    // Keep the three in step: a duration typed in gives the end the clash check and the file will use.
    const endMin = Math.min(toMinutes(ev.start) + value, 1439);
    ev.end = `${String(Math.floor(endMin / 60)).padStart(2, '0')}:${String(endMin % 60).padStart(2, '0')}`;
    card.querySelector('[data-field="end"] input').value = ev.end;
    ev.why = { ...ev.why, end: `${value} minutes after the start.` };
    card.querySelector('[data-why="end"]').replaceWith(buildWhy(ev, 'end'));
  }
  if (ev.sources) delete ev.sources[field]; // the notice no longer backs this field
  ev.why = { ...ev.why, [field]: 'edited by you' };
  ev.flags = (ev.flags || []).filter((f) => f.field !== field); // the student has now checked it
  if (field === 'end' && ev.end && ev.start && toMinutes(ev.end) <= toMinutes(ev.start)) {
    ev.flags.push({ field: 'end', level: 'warn', msg: 'End time is before the start. Please fix it.' });
  }
  card.querySelector(`[data-why="${field}"]`).replaceWith(buildWhy(ev, field));
  renderCheck(ev, card);
  renderEventsHint();
  state.exportNote = null;
  renderNotice();
  renderClashes();
  renderExport();
}

function removeEvent(ev) {
  const index = state.events.indexOf(ev);
  state.events = state.events.filter((item) => item !== ev);
  state.lastRemoved = { ev, index };
  cards.get(ev.id)?.remove();
  cards.delete(ev.id);
  afterListChange();
}

function undoRemove() {
  const { ev, index } = state.lastRemoved || {};
  if (!ev) return;
  state.lastRemoved = null;
  state.events.splice(Math.min(index, state.events.length), 0, ev);
  renderEvents();
  afterListChange();
  cards.get(ev.id)?.focus();
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

// The one rule of the review gate: nothing leaves the page while a field is unchecked, undated or unnamed.
function exportBlock() {
  const undated = state.events.filter((ev) => !ev.date);
  const unnamed = state.events.filter((ev) => !(ev.title || '').trim());
  if (!state.events.length) return 'Add an event before you download.';
  if (undated.length) return `Add a date to: ${undated.map(titleOf).join(', ')}.`;
  if (unnamed.length) return `Give a title to ${unnamed.length === 1 ? 'the untitled event' : `${unnamed.length} untitled events`}.`;
  const amber = state.events.filter((ev) => toCheck(ev).length);
  if (amber.length) return `Check the amber fields first: ${amber.map(titleOf).join(', ')}.`;
  return null;
}

function renderExport() {
  renderSummary();
  const blocked = exportBlock();
  for (const b of [els.exportBtn, els.copyBtn, els.shareBtn, els.waBtn, els.classPublish]) b.disabled = Boolean(blocked);
  const n = state.events.length;
  if (inCompanion()) {
    els.gcalAll.disabled = Boolean(blocked) || state.busy;
    els.gcalAll.textContent = `Add all to your phone calendar${n > 1 ? ` (${n})` : ''}`;
    els.gcalNote.textContent = 'Goes into the calendar the Notice Decoder app writes to. Adding twice updates, never duplicates.';
  } else {
    els.gcalAll.disabled = Boolean(blocked) || !gcal.configured() || state.busy;
    els.gcalAll.textContent = state.busy ? 'Adding...' : `Add all to Google Calendar${n > 1 ? ` (${n})` : ''}`;
    els.gcalNote.textContent = !gcal.configured()
      ? 'One-tap add is not set up on this copy of the app (GOOGLE_CLIENT_ID in app/config.js). Use the calendar file below.'
      : gcal.signedIn() ? 'Signed in to Google. Adding twice updates the same events; it never duplicates them.'
        : 'Signs you in to Google once, then writes the events straight into your calendar.';
  }
  const shown = blocked ? { kind: 'error', text: blocked } : state.exportNote;
  els.exportStatus.replaceChildren(shown?.text || '', shown?.undo ? el('button', { type: 'button', class: 'link', onclick: shown.undo }, ' Undo') : '');
  els.exportStatus.dataset.kind = shown?.kind || '';
}

// ---------- Google Calendar, one tap ----------

// Inside the Android companion's WebView the same button hands the events to the phone calendar instead.
const inCompanion = () => Boolean(window.ReactNativeWebView);

async function addAllToGoogle({ silent = false } = {}) {
  if (state.busy || exportBlock()) return;
  if (inCompanion()) {
    const events = state.events.map(({ title, type, typeLabel, date, start, end, venue, link, durationMin, repeat, point, window: w, reportAt }) =>
      ({ title, type, typeLabel, date, start, end, venue, link, durationMin, repeat, point, window: w, reportAt }));
    window.ReactNativeWebView.postMessage(JSON.stringify({ type: 'nd-add', events }));
    state.exportNote = { kind: 'ok', text: 'Handed to your phone calendar.' };
    renderExport();
    return;
  }
  state.busy = true;
  renderExport();
  try {
    const result = await gcal.addAll(state.events, { reminders: els.reminders.checked, silent }, window.__ndGcalDeps || {});
    if (!result) { state.exportNote = silent ? { kind: '', text: 'Signed out of Google: tap "Add all" once to sign in; after that shared notices add themselves.' } : null; return; }
    state.gcalLast = result;
    const parts = [];
    if (result.added.length) parts.push(`added ${result.added.length}`);
    if (result.updated.length) parts.push(`updated ${result.updated.length}`);
    if (result.failed.length) parts.push(`${result.failed.length} failed (${result.failed.map((f) => f.error).join('; ')})`);
    state.exportNote = {
      kind: result.failed.length ? 'error' : 'ok',
      text: `Google Calendar: ${parts.join(', ')}.${silent ? ' (added automatically)' : ''}`,
      undo: result.added.length ? undoGoogle : null,
    };
  } catch (err) {
    state.exportNote = { kind: 'error', text: String(err.message || err) };
  } finally {
    state.busy = false;
    renderExport();
  }
}

async function undoGoogle() {
  const last = state.gcalLast;
  if (!last?.added?.length) return;
  state.gcalLast = null;
  try {
    const n = await gcal.removeAll(last.added, window.__ndGcalDeps || {});
    state.exportNote = { kind: 'ok', text: `Removed ${n} event${n === 1 ? '' : 's'} from Google Calendar.` };
  } catch (err) {
    state.exportNote = { kind: 'error', text: String(err.message || err) };
  }
  renderExport();
}

const autoAddOn = () => { try { return localStorage.getItem(AUTO_ADD_KEY) === '1'; } catch { return false; } };

// The zero-touch path: a notice that arrived by itself, nothing amber, auto-add switched on, Google still signed in.
function maybeAutoAdd() {
  if (!autoAddOn() || !gcal.configured() || exportBlock()) return;
  if (!gcal.signedIn()) { state.exportNote = { kind: '', text: 'Nothing to check. Tap "Add all" once to sign in to Google; after that shared notices add themselves.' }; renderExport(); return; }
  addAllToGoogle({ silent: true });
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

// A plain-text digest for the class group: one line per event, clashes at the end.
function summaryText() {
  const lines = [];
  for (const [iso, evs] of groupByDate(state.events)) {
    lines.push(`📅 ${fmtDate(iso)}`);
    for (const ev of [...evs].sort((a, b) => (a.start || '').localeCompare(b.start || ''))) {
      const when = !ev.start ? 'All day' : ev.type === 'deadline' || ev.point ? `by ${fmt12(ev.start)}` : ev.end ? `${fmt12(ev.start)} - ${fmt12(ev.end)}` : fmt12(ev.start);
      lines.push(`• ${when}: ${titleOf(ev)} (${ev.typeLabel})${ev.venue ? `, ${ev.venue}` : ''}${ev.link ? `\n  ${ev.link}` : ''}`);
    }
  }
  const clashes = currentClashes().filter((c) => c.kind !== 'none');
  if (clashes.length) {
    const byId = new Map(state.events.map((ev) => [ev.id, ev]));
    lines.push('', `⚠️ ${clashes.length} clash${clashes.length > 1 ? 'es' : ''}:`);
    for (const c of clashes) lines.push(`• ${titleOf(byId.get(c.a))} x ${titleOf(byId.get(c.b))}: ${String(c.msg).replace(/^clash\.\s*/i, '')}${c.action ? ` ${c.action}` : ''}`);
  }
  lines.push('', 'Decoded with Notice Decoder. Check the original notice for changes.');
  return lines.join('\n');
}

async function copySummary() {
  const text = summaryText();
  try {
    await navigator.clipboard.writeText(text);
    state.exportNote = { kind: 'ok', text: 'Copied. Paste it in the class group.' };
  } catch {
    state.exportNote = { kind: 'error', text: 'Could not copy. Long-press the text below to copy it.' };
    els.exportStatus.after(el('textarea', { class: 'fallback-copy', readonly: true, rows: 6 }, text));
  }
  renderExport();
}

// ---------- share with class: the events travel inside the link, no server ----------

const SHARE_VERSION = 1;
const b64url = (s) => btoa(String.fromCharCode(...new TextEncoder().encode(s))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const unb64url = (s) => new TextDecoder().decode(Uint8Array.from(atob(s.replace(/-/g, '+').replace(/_/g, '/')), (c) => c.charCodeAt(0)));

function shareUrl() {
  const payload = {
    v: SHARE_VERSION,
    on: new Date().toISOString().slice(0, 10),
    e: state.events.map((ev) => ({
      t: ev.title, k: ev.type, d: ev.date, s: ev.start, e: ev.end, v: ev.venue, l: ev.link,
      m: ev.durationMin, r: ev.repeat, p: ev.point ? 1 : 0, w: ev.window ? 1 : 0,
    })),
  };
  const url = new URL(location.href);
  url.search = '';
  url.hash = `s=${b64url(JSON.stringify(payload))}`;
  return url.toString();
}

function loadShared(hash) {
  const m = /(?:^|[#&])s=([A-Za-z0-9_-]+)/.exec(hash);
  if (!m) return false;
  let payload;
  try { payload = JSON.parse(unb64url(m[1])); } catch { return false; }
  if (!payload || payload.v !== SHARE_VERSION || !Array.isArray(payload.e)) return false;
  const events = payload.e.slice(0, 50).map((x, i) => workingCopy({
    id: `s${i + 1}`, title: String(x.t || '').slice(0, 120), type: x.k, typeLabel: TYPE_LABELS[x.k] || 'Other',
    date: x.d, start: x.s, end: x.e, venue: x.v ? String(x.v).slice(0, 120) : null, link: x.l,
    durationMin: Number(x.m) || null, repeat: Number(x.r) || null, point: Boolean(x.p), window: Boolean(x.w),
    why: { title: 'from the shared link' }, flags: [],
  }, i));
  if (!events.length) return false;
  state.decodedText = '';
  state.result = { warnings: [], pending: [], notes: [] };
  state.events = events;
  state.exportNote = null;
  state.shared = { from: null, on: safeDate(payload.on) };
  state.lastRemoved = null;
  els.results.hidden = false;
  renderAll();
  els.results.focus();
  return true;
}

async function shareWithClass() {
  const url = shareUrl();
  // The link is copied first, so it is on the clipboard whatever the share sheet does.
  let copied = false;
  try { await navigator.clipboard.writeText(url); copied = true; } catch { /* no clipboard access */ }
  state.exportNote = copied
    ? { kind: 'ok', text: 'Link copied. Anyone who opens it sees these events and can add them in one tap.' }
    : { kind: 'error', text: `Could not copy. The link is: ${url}` };
  renderExport();
  if (navigator.share) {
    try {
      await navigator.share({ title: 'Class events', text: `${summaryText()}\n\nOpen in Notice Decoder (one tap to add to your calendar): ${url}` });
      state.exportNote = { kind: 'ok', text: 'Shared, and the link is on your clipboard.' };
      renderExport();
    } catch { /* the share sheet was closed or is not allowed here; the clipboard copy stands */ }
  }
}

function openWhatsApp() {
  const text = `${summaryText()}\n\nOpen in Notice Decoder: ${shareUrl()}`;
  window.open(`https://wa.me/?text=${encodeURIComponent(text)}`, '_blank', 'noopener');
}

// ---------- class feed: the CR publishes once, the class subscribes once (worker/) ----------

const myClass = () => { try { return JSON.parse(localStorage.getItem(CLASS_KEY) || 'null'); } catch { return null; } };
const saveClass = (c) => { try { localStorage.setItem(CLASS_KEY, JSON.stringify(c)); } catch { /* ignore */ } };

async function feedCall(method, path, { body, token } = {}) {
  const res = await fetch(`${feedBase()}${path}`, {
    method,
    headers: { ...(body ? { 'Content-Type': 'application/json' } : {}), ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `The class feed said ${res.status}`);
  return data;
}

function renderClass() {
  els.classSection.hidden = !feedBase();
  els.classOpenRow.hidden = !feedBase();
  if (!feedBase()) return;
  const c = myClass();
  els.classStatus.replaceChildren(c
    ? el('span', {}, `Your class: ${c.name}. Subscribe page: `, el('a', { href: c.page, target: '_blank', rel: 'noopener' }, c.page))
    : 'No class yet. The first publish creates one and gives you its subscribe link.');
  els.classLink.hidden = !c;
  els.classPublish.textContent = c ? `Publish to ${c.name}` : 'Publish to class';
}

async function publishToClass() {
  if (exportBlock()) return;
  let c = myClass();
  try {
    if (!c) {
      const name = (window.prompt('Name of the class (shown on the subscribe page), for example "III CSE A":') || '').trim();
      if (!name) return;
      c = await feedCall('POST', '/api/class', { body: { name } });
      saveClass(c);
      renderClass();
    }
    const events = state.events.map(({ title, type, typeLabel, date, start, end, venue, link, durationMin, repeat, point, window: w, reportAt }) =>
      ({ title, type, typeLabel, date, start, end, venue, link, durationMin, repeat, point, window: w, reportAt }));
    const r = await feedCall('POST', `/api/class/${c.id}/publish`, { body: { events }, token: c.secret });
    const clashes = r.clashes.length
      ? ` ${r.clashes.length} clash${r.clashes.length > 1 ? 'es' : ''} across everything published so far: ${r.clashes.map((x) => `${x.a} x ${x.b} (${x.date})`).join('; ')}.`
      : ' No clashes across everything published so far.';
    els.classResult.textContent = `Published: ${r.added} new, ${r.updated} updated, ${r.count} in the class calendar.${clashes} Subscribers see the change on their next refresh.`;
    els.classResult.dataset.kind = r.clashes.length ? 'error' : 'ok';
  } catch (err) {
    els.classResult.textContent = String(err.message || err);
    els.classResult.dataset.kind = 'error';
  }
}

async function copyClassLink() {
  const c = myClass();
  if (!c) return;
  const text = `${c.name}: subscribe once and every notice lands in your calendar. ${c.page}`;
  try { await navigator.clipboard.writeText(text); els.classResult.textContent = 'Subscribe link copied. Paste it in the class group.'; els.classResult.dataset.kind = 'ok'; }
  catch { els.classResult.textContent = `Could not copy. The link is: ${c.page}`; els.classResult.dataset.kind = 'error'; }
}

// A student opens a class: the published events load like a shared link (no notice text, export open).
async function openClass(idOrLink) {
  const id = (/\/c\/([a-z0-9]{6,12})/.exec(idOrLink || '') || [, (idOrLink || '').trim()])[1];
  const say = (msg, kind) => { for (const n of [els.classOpenResult, els.classResult]) { n.textContent = msg; n.dataset.kind = kind; } };
  if (!/^[a-z0-9]{6,12}$/.test(id)) { say('Paste the class link or its 8-character id.', 'error'); return false; }
  say('Opening the class...', '');
  try {
    const data = await feedCall('GET', `/c/${id}.json`);
    const events = data.events.filter((e) => !e.cancelled).map((e, i) => workingCopy({ ...e, id: `c${i + 1}`, why: { title: `published to ${data.name}` }, flags: [] }, i));
    state.decodedText = '';
    state.result = { warnings: [], pending: [], notes: [] };
    state.events = events;
    state.exportNote = null;
    state.shared = { from: `the class representative of ${data.name}`, on: safeDate((data.updatedAt || '').slice(0, 10)) };
    state.lastRemoved = null;
    els.results.hidden = false;
    renderAll();
    els.results.focus();
    say(events.length ? `Opened ${data.name}: ${events.length} event${events.length === 1 ? '' : 's'}.` : `Nothing published in ${data.name} yet.`, 'ok');
    return true;
  } catch (err) {
    say(String(err.message || err), 'error');
    return false;
  }
}

// ---------- paste, share target, install, offline ----------

async function pasteFromClipboard() {
  try {
    const text = await navigator.clipboard.readText();
    if (!text.trim()) { showInputError('The clipboard is empty. Copy the notice first.'); return; }
    els.input.value = text;
    decode(text, { auto: true });
  } catch {
    showInputError('The browser did not allow reading the clipboard. Long-press the box and choose Paste.');
  }
}

// WhatsApp -> Share -> Notice Decoder (installed app): the text arrives as ?text= (manifest share_target).
function fromShareTarget() {
  const q = new URLSearchParams(location.search);
  const text = [q.get('title'), q.get('text'), q.get('url')].filter(Boolean).join('\n').trim();
  if (!text) return false;
  history.replaceState(null, '', location.pathname);
  els.input.value = text;
  decode(text, { auto: true });
  return true;
}

function setupInstall() {
  let deferred = null;
  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    deferred = e;
    els.install.hidden = false;
  });
  els.install.addEventListener('click', async () => {
    if (!deferred) return;
    deferred.prompt();
    await deferred.userChoice;
    deferred = null;
    els.install.hidden = true;
  });
  window.addEventListener('appinstalled', () => { els.install.hidden = true; });
}

function setupOffline() {
  const show = () => { els.offline.hidden = navigator.onLine; };
  window.addEventListener('online', show);
  window.addEventListener('offline', show);
  show();
  if ('serviceWorker' in navigator && location.protocol !== 'file:') {
    navigator.serviceWorker.register('./sw.js').catch((err) => console.warn('Service worker not registered', err));
  }
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
  if (navigator.clipboard && navigator.clipboard.readText) {
    els.paste.hidden = false;
    els.paste.addEventListener('click', pasteFromClipboard);
  }
  els.input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
      e.preventDefault();
      decode(els.input.value);
    }
  });
  // Auto-decode: a paste decodes at once; typing decodes after a pause. The Decode button stays as the fallback.
  let typing = null;
  els.input.addEventListener('paste', () => setTimeout(() => decode(els.input.value), 0));
  els.input.addEventListener('input', () => {
    if (els.input.value.trim()) clearInputError();
    clearTimeout(typing);
    typing = setTimeout(() => {
      const text = els.input.value;
      if (text.trim().length >= 15 && text !== state.decodedText) decode(text);
    }, DECODE_DEBOUNCE_MS);
  });
  els.add.addEventListener('click', addManual);
  els.exportBtn.addEventListener('click', downloadIcs);
  els.gcalAll.addEventListener('click', () => addAllToGoogle());
  try { els.autoAdd.checked = autoAddOn(); } catch { /* ignore */ }
  els.autoAdd.addEventListener('change', () => { try { localStorage.setItem(AUTO_ADD_KEY, els.autoAdd.checked ? '1' : '0'); } catch { /* ignore */ } });
  els.copyBtn.addEventListener('click', copySummary);
  els.shareBtn.addEventListener('click', shareWithClass);
  els.waBtn.addEventListener('click', openWhatsApp);
  for (const type of ['mouseover', 'focusin']) {
    els.noticeText.addEventListener(type, (e) => setHot(e, true));
  }
  for (const type of ['mouseout', 'focusout']) {
    els.noticeText.addEventListener(type, (e) => setHot(e, false));
  }
  els.classPublish.addEventListener('click', publishToClass);
  els.classLink.addEventListener('click', copyClassLink);
  els.classJoinBtn.addEventListener('click', () => openClass(els.classJoin.value));
  els.classJoin.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); openClass(els.classJoin.value); } });
  renderClass();
  const classInHash = () => { const m = /[#&]c=([a-z0-9]{6,12})\b/.exec(location.hash); return m && feedBase() ? openClass(m[1]) : false; };
  window.addEventListener('hashchange', () => { if (!loadShared(location.hash) && !classInHash() && state.shared) clearAll(); });
  setupInstall();
  setupOffline();
  if (!fromShareTarget() && !loadShared(location.hash)) classInHash();
}

init();
