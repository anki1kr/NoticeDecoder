// Notice Decoder UI. Vanilla ES module, no build step.
// Engine contract: ./engine/parse.js, ./engine/clash.js, ./engine/ics.js.
import { parseNotice } from './engine/parse.js';
import { findClashes } from './engine/clash.js';
import { toICS, gcalUrl } from './engine/ics.js';
import { SAMPLES } from './samples.js';
import * as gcal from './gcal.js';
import { FEED_BASE } from './config.js';
import { fixOcrText } from './engine/ocrfix.js';
import * as schedule from './schedule.js';
import * as ai from './ai.js';
// ocr.js, pdftext.js and docx.js are imported on first use (the first two pull a reader library from a CDN once).

const AUTO_ADD_KEY = 'nd-auto-add';
const AI_KEY = 'nd-ai'; // '0' = the student switched the AI check off
const CLASS_KEY = 'nd-class'; // { id, secret, name, feed, page } for the class representative
const FOLLOW_KEY = 'nd-follow'; // { id, name, seen } the class a student opened, so it is one tap next time
const feedBase = () => (window.__ndFeedBase || FEED_BASE || '').replace(/\/+$/, '');
const DECODE_DEBOUNCE_MS = 900;
const MAX_TITLE = 120;
const NET_TIMEOUT_MS = 15000;
const QR_LIB = 'https://cdn.jsdelivr.net/npm/qrcode-generator@1.4.4/qrcode.js';
const QR_SRI = 'sha384-8FWZA6BGMXhsfO+BLtrJK0We6gg5o1JyO8xQm6peWDEUs17ACA5ziE/NIAkl9z2k';
const UID_RE = /^[a-z0-9-]{1,80}@notice-decoder$/;

const TYPE_LABELS = { test: 'Test', deadline: 'Deadline', lecture: 'Lecture', other: 'Other' };
const PALETTE_SIZE = 6; // matches .c0 to .c5 in styles.css
const NULLABLE = new Set(['date', 'start', 'end', 'venue', 'link', 'durationMin']);
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const TIME_RE = /^([01]?\d|2[0-3]):[0-5]\d$/;
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
  upload: $('#upload-btn'),
  camera: $('#camera-btn'),
  fileInput: $('#file-input'),
  cameraInput: $('#camera-input'),
  fileStatus: $('#file-status'),
  hindi: $('#hindi-ocr'),
  inputCard: $('#input-card'),
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
  scheduleNote: $('#schedule-note'),
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
  classConsole: $('#class-console'),
  classRefresh: $('#class-refresh-btn'),
  classConsoleHint: $('#class-console-hint'),
  classConsoleList: $('#class-console-list'),
  classChangesWrap: $('#class-changes-wrap'),
  classChanges: $('#class-changes'),
  classWa: $('#class-wa-btn'),
  classQr: $('#class-qr-btn'),
  classQrBox: $('#class-qr'),
  classPreview: $('#class-preview'),
  classPreviewHint: $('#class-preview-hint'),
  classPreviewList: $('#class-preview-list'),
  classConfirm: $('#class-confirm-btn'),
  classPreviewCancel: $('#class-preview-cancel'),
  classManage: $('#class-manage'),
  classRename: $('#class-rename-btn'),
  classBackup: $('#class-backup-btn'),
  classRotate: $('#class-rotate-btn'),
  classForget: $('#class-forget-btn'),
  followRow: $('#follow-row'),
  followText: $('#follow-text'),
  followOpen: $('#follow-open-btn'),
  sharedChanges: $('#shared-changes'),
  aiRow: $('#ai-row'),
  aiToggle: $('#ai-toggle'),
  aiBtn: $('#ai-btn'),
  aiStatus: $('#ai-status'),
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
  seq: 0,           // bumps on every decode: an answer (AI, file) for an older notice is dropped, never applied
  aiBusy: false,
  aiServer: null,   // null = not asked yet, true/false = the class server has an AI key
  aiUndo: null,     // the events as they were before the AI check, for Undo
  aiNote: null,     // { kind, text } the AI status line
  fileJob: 0,       // bumps on every file: a slow OCR of an older file never overwrites a newer one
  classBusy: false, // a class-feed call is in flight (double taps do nothing)
  pending: null,    // { events, intents, plan, skipped } a publish the CR is looking at before it goes out
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

// A date the calendar can hold: a real day, year 2000-2100 (a date picker happily takes "20260-10-28").
const realDate = (v) => {
  if (!DATE_RE.test(v || '')) return false;
  const [y, m, d] = v.split('-').map(Number);
  const t = new Date(Date.UTC(y, m - 1, d));
  return y >= 2000 && y <= 2100 && t.getUTCMonth() === m - 1 && t.getUTCDate() === d;
};

const safeDate = (v) => (typeof v === 'string' && realDate(v) ? v : null);
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
    uid: UID_RE.test(raw.uid || '') ? raw.uid : undefined, // a class event keeps the feed's UID, so re-adding updates it
    title: String(raw.title ?? '').slice(0, MAX_TITLE),
    type: TYPE_LABELS[raw.type] ? raw.type : 'other',
    typeLabel: raw.typeLabel || TYPE_LABELS[raw.type] || 'Other',
    date: safeDate(raw.date),
    start: safeTime(raw.start),
    end: safeTime(raw.end),
    venue: raw.venue || null,
    durationMin: Number.isFinite(raw.durationMin) && raw.durationMin > 0 ? raw.durationMin : null,
    link: safeUrl(raw.link),
    repeat: Number.isFinite(raw.repeat) ? raw.repeat : null,
    every: /^(?:(?:SU|MO|TU|WE|TH|FR|SA)(?:,|$))+$/.test(raw.every) ? raw.every : null,
    point: Boolean(raw.point),
    window: Boolean(raw.window),
    reportAt: safeTime(raw.reportAt),
    // "postponed to 20 Nov": the class feed moves the published event instead of adding a second one
    moved: Boolean(raw.revisedBy || raw.moved || (raw.flags || []).some((f) => /^Revised/.test(f.msg || ''))) || undefined,
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
function decode(text, { auto = false, source = 'text' } = {}) {
  if (!text.trim()) {
    showInputError(EMPTY_INPUT_MSG);
    return;
  }
  clearInputError();
  let result;
  try {
    result = parseNotice(text, { pastedAt: new Date(), source });
  } catch (err) {
    console.error('parseNotice failed', err);
    showInputError(PARSE_ERROR_MSG);
    return;
  }
  state.seq++;
  state.lastInput = text; // the raw text: the typing timer compares against this, not the cleaned text
  state.decodedText = result.text ?? text; // the cleaned text: highlights point into it
  state.source = source;
  state.result = result;
  state.events = (result.events || []).map((raw, i) => workingCopy(raw, i));
  state.exportNote = null;
  state.shared = null;
  state.lastRemoved = null;
  state.gcalLast = null;
  state.aiUndo = null;
  state.aiNote = null;
  state.pending = null;
  if (source === 'text') fileStatus('');
  els.results.hidden = false;
  renderAll();
  els.noticeText.classList.add('draw'); // highlighter strokes draw in once per decode, not on every edit
  setTimeout(() => els.noticeText.classList.remove('draw'), 3000);
  // Keyboard and screen-reader users land on the first field that needs them; otherwise on the summary.
  const firstAmber = els.eventList.querySelector('.needs-check input, .needs-check select');
  if (firstAmber) firstAmber.focus({ preventScroll: false }); else els.results.focus();
  // The AI check runs only when the rules are unsure; an auto-add waits for it, so it adds the AI-checked names.
  if (!maybeAi({ auto }) && auto) maybeAutoAdd();
}

// ---------- AI check (Claude Haiku via the class server; app/ai.js decides what is worth a call and guards the answer) ----------

const aiOn = () => { try { return localStorage.getItem(AI_KEY) !== '0'; } catch { return true; } };
const aiAvailable = () => Boolean(feedBase()) && state.aiServer === true;
const cloneEvent = (e) => ({ ...e, sources: { ...(e.sources || {}) }, why: { ...(e.why || {}) }, flags: [...(e.flags || [])] });

function maybeAi({ auto = false } = {}) {
  if (!aiAvailable() || !aiOn() || !navigator.onLine || !state.decodedText || !state.result) return false;
  if (!ai.needsAi(state.result, state.events, state.source)) return false;
  runAi({ auto });
  return true;
}

async function runAi({ auto = false } = {}) {
  if (state.aiBusy || !state.decodedText) return;
  const seq = state.seq;
  const { ids, body } = ai.buildRequest(state.decodedText, state.events);
  state.aiBusy = true;
  state.aiNote = { kind: 'busy', text: 'Checking the names with AI…' };
  renderAi();
  try {
    const res = await timedFetch(`${feedBase()}${ai.AI_PATH}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }, 30000);
    const data = await res.json().catch(() => ({}));
    if (seq !== state.seq) return; // a newer notice was decoded meanwhile: this answer is about the old one
    if (!res.ok) {
      if (res.status === 503) state.aiServer = false;
      throw new Error(data.error || `The AI check failed (${res.status}).`);
    }
    const before = state.events.map(cloneEvent);
    const r = ai.applyAnswer(state.events, data, ids, {
      text: state.decodedText, pastedAt: new Date(), anchorDate: state.result?.anchorFromNotice ? state.result.anchorDate : null,
      makeEvent: (raw, i) => workingCopy(raw, i),
    });
    const changed = r.renamed + r.retyped + r.added + r.doubted;
    state.aiUndo = changed ? before : null;
    state.aiNote = { kind: changed ? 'ok' : '', text: ai.summaryLine(r, { cached: data.cached }) };
    if (changed) { state.exportNote = null; keepFocus(renderAll); } // nothing changed: no re-render under the student's cursor
    if (auto) maybeAutoAdd();
  } catch (err) {
    if (seq !== state.seq) return;
    state.aiNote = { kind: 'error', text: `${err.name === 'AbortError' ? 'The AI check took too long.' : friendlyNet(err)} The rules result stands.` };
  } finally {
    state.aiBusy = false;
    if (seq === state.seq) renderAi();
  }
}

// An answer that lands while the student is typing in a field re-renders the cards: put the cursor back where it was.
function keepFocus(render) {
  const a = document.activeElement;
  const id = a?.closest?.('.ev')?.dataset.id, field = a?.closest?.('[data-field]')?.dataset.field;
  let pos = null;
  try { pos = a?.selectionStart ?? null; } catch { /* date/time inputs have no selection */ }
  render();
  const again = id && field ? cards.get(id)?.querySelector(`[data-field="${field}"] input, [data-field="${field}"] select`) : null;
  if (!again) return;
  again.focus({ preventScroll: true });
  try { if (pos !== null) again.setSelectionRange(pos, pos); } catch { /* not a text input */ }
}

function undoAi() {
  if (!state.aiUndo) return;
  state.events = state.aiUndo;
  state.aiUndo = null;
  state.aiNote = { kind: '', text: 'AI changes undone: these are the rules\' results again.' };
  renderAll();
}

function renderAi() {
  const can = aiAvailable() && Boolean(state.decodedText);
  els.aiRow.hidden = !aiAvailable();
  els.aiBtn.hidden = !can;
  els.aiBtn.disabled = state.aiBusy || !navigator.onLine;
  els.aiBtn.textContent = state.aiBusy ? 'Checking…' : 'Check names with AI';
  const note = state.aiNote;
  els.aiStatus.hidden = !note;
  els.aiStatus.dataset.kind = note?.kind || '';
  els.aiStatus.replaceChildren(note?.text || '', state.aiUndo ? el('button', { type: 'button', class: 'link', onclick: undoAi }, 'Undo AI changes') : '');
}

// The class server says once per page load whether it has an AI key; with none, no AI control is shown at all.
async function askAiServer() {
  if (!feedBase()) return;
  try {
    const res = await timedFetch(`${feedBase()}/health`, {}, 8000);
    state.aiServer = Boolean((await res.json()).ai);
  } catch { state.aiServer = false; }
  renderAi();
}

// ---------- network helpers ----------

async function timedFetch(url, init = {}, ms = NET_TIMEOUT_MS) {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), ms);
  try { return await fetch(url, { ...init, signal: ctl.signal }); } finally { clearTimeout(t); }
}

function friendlyNet(err) {
  const msg = String(err?.message || err || '');
  if (!navigator.onLine) return 'You are offline. Connect to the internet and try again.';
  if (err?.name === 'AbortError') return 'The server took too long to answer. Try again.';
  if (/Failed to fetch|NetworkError|Load failed|network/i.test(msg)) return 'Could not reach the server. Check your internet and try again.';
  return msg;
}

function clearAll() {
  els.input.value = '';
  clearInputError();
  state.seq++; // an AI answer or a file still being read for the old notice is dropped
  state.fileJob++;
  state.decodedText = '';
  state.result = null;
  state.events = [];
  state.exportNote = null;
  state.shared = null;
  state.lastRemoved = null;
  state.source = 'text';
  state.aiUndo = null;
  state.aiNote = null;
  state.pending = null;
  els.classPreview.hidden = true;
  fileStatus('');
  renderAi();
  cards.clear();
  els.eventList.replaceChildren(); // stale cards must not survive under the hidden results block
  els.warnings.replaceChildren();
  els.results.hidden = true;
  renderClass();
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
  // What changed in the class lately ("Moved: Internal Test 2 to 16 Nov, 2:00 PM"): the reason a student opens it.
  const changes = (state.shared?.changes || []).filter((c) => c.kind !== 'added').slice(0, 5);
  els.sharedChanges.hidden = !changes.length;
  els.sharedChanges.replaceChildren(...changes.map((c) => el('li', {}, el('strong', {}, `${CHANGE_WORDS[c.kind] || c.kind}: `),
    `${c.title}, ${c.kind === 'moved' && c.from ? `${shortDate(c.from.date)}${c.from.start ? ` ${fmt12(c.from.start)}` : ''} → ` : ''}${shortDate(c.date)}${c.start ? ` ${fmt12(c.start)}` : ''}`)));
  renderWarnings();
  renderNotice();
  renderEvents();
  renderClashes();
  renderLists();
  renderExport();
  renderAi();
  renderClass();
}
const CHANGE_WORDS = { added: 'New', moved: 'Moved', updated: 'Updated', cancelled: 'Cancelled', restored: 'Back on' };

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

// What `repeat` and `every` mean, in words: "every Mon and Wed, 8 times" or "2 days in a row".
function repeatText(ev) {
  if (!(ev.repeat > 1)) return '';
  if (!ev.every) return `${ev.repeat} days in a row`;
  const names = ev.every.split(',').map((c) => ({ SU: 'Sun', MO: 'Mon', TU: 'Tue', WE: 'Wed', TH: 'Thu', FR: 'Fri', SA: 'Sat' }[c]));
  return `every ${names.join(' and ')}, ${ev.repeat} times`;
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
    el('span', { class: 'row-when' }, `${shortDate(ev.date)} · ${whenText(ev)}${ev.repeat > 1 ? ` · ${repeatText(ev)}` : ''}`),
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
  const link = safeUrl(ev.link); // never a javascript: or data: link, even one the student typed
  open.hidden = !link;
  if (link) open.href = link; else open.removeAttribute('href');
}

function buildCard(ev) {
  const card = el('article', { class: `card ev c${ev.color}`, dataset: { id: ev.id } });
  cards.set(ev.id, card);
  card.append(
    el('div', { class: 'card-head' },
      el('span', { class: 'badge' }, ev.typeLabel),
      ev.repeat > 1 ? el('span', { class: 'badge' }, repeatText(ev)) : null,
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
    : el('input', {
      type: spec.type, value: ev[spec.key] ?? '', min: spec.type === 'number' ? '5' : spec.type === 'date' ? '2000-01-01' : null,
      max: spec.type === 'number' ? '1440' : spec.type === 'date' ? '2100-12-31' : null, step: spec.type === 'number' ? '5' : null,
      inputmode: spec.type === 'number' ? 'numeric' : null, placeholder: spec.key === 'link' ? 'https://' : null,
      maxlength: { title: MAX_TITLE, venue: 120, link: 500 }[spec.key] || null,
    });
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
  let problem = null;
  if (field === 'durationMin') value = raw === '' ? null : Math.min(1440, Math.max(0, Math.round(Number(raw)))) || null;
  else if (field === 'link') {
    value = raw.trim() === '' ? null : raw.trim().slice(0, 500);
    if (value && !safeUrl(value)) problem = 'This is not a web link. It must start with https:// (or leave it empty).';
  } else if (field === 'title') value = raw.slice(0, MAX_TITLE);
  else if (field === 'venue') value = raw.trim() === '' ? null : raw.slice(0, 120);
  else if (raw === '' && NULLABLE.has(field)) value = null;
  if (field === 'date' && value && !realDate(value)) { value = null; problem = 'Pick a real date (day, month and a year like 2026).'; }
  if ((field === 'start' || field === 'end') && value && !TIME_RE.test(value)) value = null;
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
  if (problem) ev.flags.push({ field, level: 'warn', msg: problem });
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

const todayISO = () => new Date().toLocaleDateString('en-CA');

// Events already in the student's calendar from earlier notices. They only show up where they meet this notice.
function savedEvents() {
  return schedule.upcoming(todayISO(), state.events)
    .map((e, i) => ({ ...e, id: `saved-${i}`, saved: true, color: 'saved', title: `${e.title} (already in your calendar)`, flags: [] }));
}

function currentClashes() {
  try {
    const all = findClashes([...state.events, ...savedEvents()]) || [];
    return all.filter((c) => !(c.a.startsWith('saved-') && c.b.startsWith('saved-')) && (c.kind !== 'none' || !(c.a.startsWith('saved-') || c.b.startsWith('saved-'))));
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
  const mine = savedEvents();
  const byId = new Map([...state.events, ...mine].map((ev) => [ev.id, ev]));
  const days = groupByDate([...state.events, ...mine]).filter(([, evs]) => evs.length >= 2 && evs.some((ev) => !ev.saved));
  els.clashDays.replaceChildren(...days.map(([iso, evs]) => renderDay(iso, evs, clashes)).filter(Boolean));
  const rows = clashes.map((c) => clashRow(c, byId)).filter(Boolean);
  els.clashRows.replaceChildren(...rows);
  els.clashWrap.hidden = rows.length === 0;
  els.clashHint.textContent = days.length
    ? 'Each day with two or more events is checked below. Red means the times collide.'
    : 'No two events share a date, so there is nothing to check yet.';
  const kept = schedule.count(todayISO());
  els.scheduleNote.hidden = kept === 0;
  els.scheduleNote.replaceChildren(`${kept} event${kept === 1 ? '' : 's'} you added from earlier notices ${kept === 1 ? 'is' : 'are'} kept on this device, so every new notice is checked against ${kept === 1 ? 'it' : 'them'}. `,
    el('button', { type: 'button', class: 'btn small', onclick: () => { schedule.clear(); renderAll(); } }, 'Clear them'));
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
  for (const b of [els.exportBtn, els.copyBtn, els.shareBtn, els.waBtn]) b.disabled = Boolean(blocked);
  els.classPublish.disabled = Boolean(blocked) || state.classBusy;
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
    const events = state.events.map(({ title, type, typeLabel, date, start, end, venue, link, durationMin, repeat, every, point, window: w, reportAt }) =>
      ({ title, type, typeLabel, date, start, end, venue, link, durationMin, repeat, every, point, window: w, reportAt }));
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
    if (result.added.length || result.updated.length) schedule.remember(state.events, todayISO());
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
    // No network: keep the reviewed events and add them when the connection returns (see retryQueued in init).
    if (!navigator.onLine || /Failed to fetch|NetworkError|Load failed/i.test(String(err.message))) {
      queueForLater(silent);
      state.exportNote = { kind: '', text: 'You are offline. These events will be added to Google Calendar when you are back online.' };
    } else {
      state.exportNote = { kind: 'error', text: String(err.message || err) };
    }
  } finally {
    state.busy = false;
    renderExport();
  }
}

const QUEUE_KEY = 'nd-gcal-queue';
function queueForLater(silent) {
  try {
    const q = JSON.parse(localStorage.getItem(QUEUE_KEY) || '[]');
    q.push({ at: Date.now(), reminders: els.reminders.checked, silent, events: state.events.map((ev) => ({ ...ev, sources: {}, why: {}, flags: [] })) });
    localStorage.setItem(QUEUE_KEY, JSON.stringify(q.slice(-10)));
  } catch { /* storage full or blocked: the status line still tells the user */ }
}

async function retryQueued() {
  let q = [];
  try { q = JSON.parse(localStorage.getItem(QUEUE_KEY) || '[]'); } catch { return; }
  if (!q.length || !navigator.onLine || !gcal.signedIn()) return;
  const rest = [];
  let added = 0;
  for (const item of q) {
    try {
      const r = await gcal.addAll(item.events, { reminders: item.reminders, silent: true }, window.__ndGcalDeps || {});
      if (r) added += r.added.length + r.updated.length; else rest.push(item);
    } catch { rest.push(item); }
  }
  try { localStorage.setItem(QUEUE_KEY, JSON.stringify(rest)); } catch { /* ignore */ }
  if (added) { state.exportNote = { kind: 'ok', text: `Back online: ${added} queued event${added === 1 ? '' : 's'} added to Google Calendar.` }; renderExport(); }
}

async function undoGoogle() {
  const last = state.gcalLast;
  if (!last?.added?.length) return;
  state.gcalLast = null;
  try {
    const n = await gcal.removeAll(last.added, window.__ndGcalDeps || {});
    schedule.forget(state.events);
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
    schedule.remember(state.events, todayISO());
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
      m: ev.durationMin, r: ev.repeat, y: ev.every || undefined, p: ev.point ? 1 : 0, w: ev.window ? 1 : 0,
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
    durationMin: Number(x.m) || null, repeat: Number(x.r) || null, every: x.y, point: Boolean(x.p), window: Boolean(x.w),
    why: { title: 'from the shared link' }, flags: [],
  }, i));
  if (!events.length) return false;
  state.seq++;
  state.decodedText = '';
  state.result = { warnings: [], pending: [], notes: [] };
  state.events = events;
  state.exportNote = null;
  state.aiUndo = null;
  state.aiNote = null;
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

const myClass = () => { try { const c = JSON.parse(localStorage.getItem(CLASS_KEY) || 'null'); return c && /^[a-z0-9]{6,12}$/.test(c.id) && c.secret ? c : null; } catch { return null; } };
const saveClass = (c) => { try { localStorage.setItem(CLASS_KEY, JSON.stringify(c)); } catch { /* ignore */ } };
const followed = () => { try { const f = JSON.parse(localStorage.getItem(FOLLOW_KEY) || 'null'); return f && /^[a-z0-9]{6,12}$/.test(f.id) ? f : null; } catch { return null; } };
const saveFollow = (f) => { try { if (f) localStorage.setItem(FOLLOW_KEY, JSON.stringify(f)); else localStorage.removeItem(FOLLOW_KEY); } catch { /* ignore */ } };
const appLink = () => `${location.origin}${location.pathname}`;

async function feedCall(method, path, { body, token } = {}) {
  let res;
  try {
    res = await timedFetch(`${feedBase()}${path}`, {
      method,
      headers: { ...(body ? { 'Content-Type': 'application/json' } : {}), ...(token ? { Authorization: `Bearer ${token}` } : {}) },
      body: body ? JSON.stringify(body) : undefined,
    });
  } catch (err) { throw new Error(friendlyNet(err)); }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw Object.assign(new Error(data.error || `The class server said ${res.status}.`), { status: res.status });
  return data;
}

function classSay(msg, kind = '') {
  els.classResult.textContent = msg;
  els.classResult.dataset.kind = kind;
}

// Every class button is off while a call is in flight: a double tap must never create two classes or publish twice.
function setClassBusy(on) {
  state.classBusy = on;
  for (const b of [els.classPublish, els.classConfirm, els.classPreviewCancel, els.classRefresh, els.classRename, els.classBackup, els.classRotate, els.classForget, els.classJoinBtn]) b.disabled = on;
  if (on) return;
  renderExport(); // the publish button stays off while the events are not ready
  if (state.pending?.plan) renderPreview(); // and "Publish" stays off when there is nothing to publish
}

function renderClass() {
  els.classSection.hidden = !feedBase() || (els.results.hidden && !myClass());
  els.classOpenRow.hidden = !feedBase();
  if (!feedBase()) return;
  const c = myClass();
  els.classStatus.replaceChildren(c
    ? el('span', {}, `Your class: ${c.name}. Subscribe page: `, el('a', { href: c.page, target: '_blank', rel: 'noopener' }, c.page))
    : 'No class yet. The first publish creates one and gives you its subscribe link.');
  for (const b of [els.classLink, els.classWa, els.classQr]) b.hidden = !c;
  els.classConsole.hidden = !c;
  if (!c) els.classQrBox.hidden = true;
  els.classPublish.textContent = c ? `Publish to ${c.name}` : 'Publish to class';
  const f = followed();
  els.followRow.hidden = !f || Boolean(c && c.id === f.id);
  if (f) els.followText.textContent = `Your class: ${f.name}${f.fresh ? ` · ${f.fresh} change${f.fresh === 1 ? '' : 's'} since you last opened it` : ''}`;
}

const publishPayload = () => state.events.map(({ title, type, typeLabel, date, start, end, venue, link, durationMin, repeat, every, point, window: w, reportAt, moved }) =>
  ({ title: (title || '').trim(), type, typeLabel, date, start, end, venue, link: safeUrl(link), durationMin, repeat, every, point, window: w, reportAt, moved }));

// Step 1: ask the server what this publish would do (nothing is written), and show it.
async function publishToClass() {
  if (exportBlock() || state.classBusy) return;
  let c = myClass();
  setClassBusy(true);
  try {
    if (!c) {
      const name = (window.prompt('Name of the class (shown on the subscribe page), for example "III CSE A":') || '').replace(/\s+/g, ' ').trim().slice(0, 80);
      if (!name) return;
      c = await feedCall('POST', '/api/class', { body: { name } });
      saveClass(c);
      renderClass();
    }
    classSay('', ''); // the last publish's message does not belong under a new preview
    state.pending = { events: publishPayload(), intents: {} };
    await refreshPreview();
  } catch (err) {
    classSay(err.status === 401 ? `${err.message} If you set this class up on another phone, open its "Use on another phone" link here.` : err.message, 'error');
  } finally {
    setClassBusy(false);
  }
}

async function refreshPreview() {
  const c = myClass();
  if (!c || !state.pending) return;
  const r = await feedCall('POST', `/api/class/${c.id}/publish?dry=1`, { body: { events: state.pending.events, intents: state.pending.intents }, token: c.secret });
  state.pending.plan = r.plan;
  state.pending.skipped = r.skipped;
  renderPreview();
}

const PLAN_WORDS = { add: 'New', update: 'Changes', move: 'Moves', same: 'No change', restore: 'Back on' };
const whenShort = (date, start) => `${shortDate(date)}${start ? `, ${fmt12(start)}` : ''}`;

function renderPreview() {
  const p = state.pending;
  els.classPreview.hidden = !p?.plan;
  if (!p?.plan) return;
  const c = myClass();
  const counts = p.plan.reduce((m, x) => ({ ...m, [x.action]: (m[x.action] || 0) + 1 }), {});
  const real = p.plan.filter((x) => x.action !== 'same').length;
  els.classPreviewHint.textContent = real
    ? `This is what ${c?.name || 'the class'} will see. ${[counts.add && `${counts.add} new`, counts.move && `${counts.move} moved`, counts.update && `${counts.update} changed`, counts.restore && `${counts.restore} back on`].filter(Boolean).join(', ')}.${p.skipped ? ` ${p.skipped} left out (no real date).` : ''}`
    : 'Nothing new: the class calendar already has all of these.';
  els.classPreviewList.replaceChildren(...p.plan.map((x) => {
    const ev = p.events[x.i];
    const detail = x.action === 'move' && x.prev ? `${whenShort(x.prev.date, x.prev.start)} → ${whenShort(x.date, x.start)}`
      : x.action === 'update' && x.prev ? [x.prev.start !== x.start && `${x.prev.start ? fmt12(x.prev.start) : 'all day'} → ${x.start ? fmt12(x.start) : 'all day'}`, (x.prev.venue || '') !== (x.venue || '') && `venue: ${x.venue || 'none'}`].filter(Boolean).join(', ') || 'details changed'
        : whenShort(x.date, x.start);
    const flip = x.alt && el('button', {
      type: 'button', class: 'link',
      onclick: async () => { if (state.classBusy) return; p.intents = { ...p.intents, [x.i]: x.alt.intent }; setClassBusy(true); try { await refreshPreview(); } catch (err) { classSay(err.message, 'error'); } finally { setClassBusy(false); } },
    }, x.alt.action === 'move' ? `It is the ${shortDate(x.alt.date)} one, moved` : 'No, it is a different one');
    return el('li', { class: `plan plan-${x.action}` }, el('span', { class: 'plan-tag' }, PLAN_WORDS[x.action] || x.action), ' ', el('strong', {}, ev.title), ` · ${detail}`, flip ? ' ' : null, flip);
  }));
  els.classConfirm.disabled = !real || state.classBusy;
  els.classConfirm.textContent = real ? `Publish ${real} change${real === 1 ? '' : 's'}` : 'Nothing to publish';
}

// Step 2: the CR said yes.
async function confirmPublish() {
  const c = myClass();
  const p = state.pending;
  if (!c || !p || state.classBusy) return;
  setClassBusy(true);
  try {
    const r = await feedCall('POST', `/api/class/${c.id}/publish`, { body: { events: p.events, intents: p.intents }, token: c.secret });
    state.pending = null;
    els.classPreview.hidden = true;
    const parts = [r.added && `${r.added} new`, r.moved && `${r.moved} moved`, r.updated && `${r.updated} updated`, r.restored && `${r.restored} back on`].filter(Boolean);
    const clashes = r.clashes.length
      ? ` ${r.clashes.length} clash${r.clashes.length > 1 ? 'es' : ''} coming up: ${r.clashes.slice(0, 3).map((x) => `${x.a} × ${x.b} (${shortDate(x.date)})`).join('; ')}.`
      : ' No clashes coming up.';
    classSay(`Published: ${parts.join(', ') || 'no changes'}. ${r.count} event${r.count === 1 ? '' : 's'} in the class calendar.${clashes} Subscribers see it on their next refresh.`, r.clashes.length ? 'warn' : 'ok'); // published fine; the clashes are news, not an error
    await loadConsole();
  } catch (err) {
    classSay(err.message, 'error');
  } finally {
    setClassBusy(false);
  }
}

function cancelPreview() {
  state.pending = null;
  els.classPreview.hidden = true;
  classSay('Not published. Nothing changed for the class.', '');
}

// CR console: everything published (upcoming first), the clash report, what changed, Edit / Cancel / Bring back.
async function loadConsole() {
  const c = myClass();
  if (!c) return;
  els.classConsoleHint.textContent = 'Loading…';
  try {
    const data = await feedCall('GET', `/api/class/${c.id}/events`, { token: c.secret });
    if (data.name && data.name !== c.name) { saveClass({ ...c, name: data.name }); renderClass(); }
    const today = data.today || todayISO();
    const upcoming = data.events.filter((e) => !e.cancelled && e.date >= today);
    const s = data.stats || {};
    els.classConsoleHint.textContent = `${upcoming.length} upcoming event${upcoming.length === 1 ? '' : 's'} in ${data.name}${data.clashes.length ? `, ${data.clashes.length} clash${data.clashes.length > 1 ? 'es' : ''} coming up` : ', no clashes coming up'}.`
      + ` Term so far: ${s.publishes || 0} publish${s.publishes === 1 ? '' : 'es'}, ${s.revised || 0} revised, ${s.cancelled || 0} cancelled, ${s.clashesFound || 0} clash${s.clashesFound === 1 ? '' : 'es'} reported before the date.`;
    const order = [...data.events].sort((a, b) => Number(a.date < today) - Number(b.date < today) || (a.date < today ? b.date.localeCompare(a.date) : `${a.date}${a.start || ''}`.localeCompare(`${b.date}${b.start || ''}`)));
    els.classConsoleList.replaceChildren(
      ...data.clashes.map((x) => el('li', { class: 'console-clash' }, el('strong', {}, 'Clash: '), `${x.a} × ${x.b} (${fmtDate(x.date)}). ${String(x.msg).replace(/^Clash\.\s*/, '')}${x.action ? ` ${x.action}` : ''}`)),
      ...order.slice(0, 120).map((e) => consoleRow(e, today)),
    );
    els.classChanges.replaceChildren(...(data.changes || []).slice(0, 20).map((x) => el('li', {}, el('strong', {}, `${CHANGE_WORDS[x.kind] || x.kind}: `),
      `${x.title}, ${x.kind === 'moved' && x.from ? `${whenShort(x.from.date, x.from.start)} → ` : ''}${whenShort(x.date, x.start)}`, el('span', { class: 'muted' }, ` · ${new Date(x.at).toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' })}`))));
    els.classChangesWrap.hidden = !(data.changes || []).length;
  } catch (err) {
    els.classConsoleHint.textContent = err.status === 404 ? 'This class no longer exists on the server. Use "Forget on this device" and create a new one.' : err.message;
  }
}

function consoleRow(e, today) {
  const li = el('li', { class: `${e.cancelled ? 'console-cancelled' : ''}${e.date < today ? ' console-past' : ''}` },
    el('span', { class: 'console-what' }, `${fmtDate(e.date)} · ${whenText(e)} · ${e.title}${e.venue ? ` · ${e.venue}` : ''}${e.cancelled ? ' (cancelled)' : ''}`),
    e.cancelled
      ? el('button', { type: 'button', class: 'link', 'aria-label': `Bring back ${e.title}`, onclick: () => restorePublished(e.uid, e.title) }, 'Bring back')
      : el('span', {},
        el('button', { type: 'button', class: 'link', 'aria-label': `Edit ${e.title}`, onclick: () => editPublished(li, e) }, 'Edit'),
        el('button', { type: 'button', class: 'link', 'aria-label': `Cancel ${e.title}`, onclick: () => cancelPublished(e.uid, e.title) }, 'Cancel')));
  return li;
}

// Inline edit of one published event: date, times, venue. The UID stays, so every subscriber's copy moves.
function editPublished(li, e) {
  if (li.querySelector('form')) return;
  const input = (name, type, value, label) => el('label', { class: 'mini' }, el('span', { class: 'lbl' }, label), el('input', { name, type, value: value || '', ...(type === 'text' ? { maxlength: '120' } : {}) }));
  const form = el('form', { class: 'console-edit' },
    input('date', 'date', e.date, 'Date'), input('start', 'time', e.start, 'Start'), input('end', 'time', e.end, 'End'), input('venue', 'text', e.venue, 'Venue'),
    el('div', { class: 'actions' }, el('button', { type: 'submit', class: 'btn small primary' }, 'Save for the class'), el('button', { type: 'button', class: 'btn small', onclick: () => form.remove() }, 'Close')));
  form.addEventListener('submit', async (ev) => {
    ev.preventDefault();
    if (state.classBusy) return;
    const f = new FormData(form);
    const patch = { date: f.get('date'), start: f.get('start') || null, end: f.get('end') || null, venue: String(f.get('venue') || '').trim() || null };
    if (!realDate(patch.date)) { classSay('Pick a real date.', 'error'); return; }
    if (patch.start && patch.end && patch.end <= patch.start) { classSay('The end time is before the start.', 'error'); return; }
    const c = myClass();
    setClassBusy(true);
    try {
      await feedCall('PATCH', `/api/class/${c.id}/events/${encodeURIComponent(e.uid)}`, { body: patch, token: c.secret });
      classSay(`Saved: "${e.title}" is now ${whenShort(patch.date, patch.start)}. Subscribers see it on their next refresh.`, 'ok');
      await loadConsole();
    } catch (err) { classSay(err.message, 'error'); } finally { setClassBusy(false); }
  });
  li.append(form);
  form.querySelector('input').focus();
}

async function cancelPublished(uid, title) {
  const c = myClass();
  if (!c || state.classBusy || !window.confirm(`Cancel "${title}" for the whole class? Subscribers' calendars will drop it.`)) return;
  setClassBusy(true);
  try {
    await feedCall('DELETE', `/api/class/${c.id}/events/${encodeURIComponent(uid)}`, { token: c.secret });
    classSay(`Cancelled "${title}". "Bring back" undoes it.`, 'ok');
    await loadConsole();
  } catch (err) { classSay(err.message, 'error'); } finally { setClassBusy(false); }
}

async function restorePublished(uid, title) {
  const c = myClass();
  if (!c || state.classBusy) return;
  setClassBusy(true);
  try {
    await feedCall('POST', `/api/class/${c.id}/events/${encodeURIComponent(uid)}/restore`, { token: c.secret });
    classSay(`"${title}" is back on for the class.`, 'ok');
    await loadConsole();
  } catch (err) { classSay(err.message, 'error'); } finally { setClassBusy(false); }
}

async function copyClassLink() {
  const c = myClass();
  if (!c) return;
  const text = `${c.name}: subscribe once and every notice lands in your calendar. ${c.page}`;
  try { await navigator.clipboard.writeText(text); classSay('Subscribe link copied. Paste it in the class group.', 'ok'); }
  catch { classSay(`Could not copy. The link is: ${c.page}`, 'error'); }
}

function sendClassLink() {
  const c = myClass();
  if (!c) return;
  window.open(`https://wa.me/?text=${encodeURIComponent(`📅 ${c.name} class calendar: subscribe once and every notice lands in your calendar by itself.\n${c.page}`)}`, '_blank', 'noopener');
}

// The QR library comes from the CDN once (pinned, with an integrity hash) and only when a CR asks for a QR.
let qrLoading = null;
function loadQr() {
  if (window.qrcode) return Promise.resolve(window.qrcode);
  qrLoading = qrLoading || new Promise((resolve, reject) => {
    const s = el('script', { src: QR_LIB, integrity: QR_SRI, crossorigin: 'anonymous' });
    s.onload = () => resolve(window.qrcode);
    s.onerror = () => { qrLoading = null; reject(new Error('The QR code needs internet once.')); };
    document.head.append(s);
  });
  return qrLoading;
}

async function toggleQr() {
  const c = myClass();
  if (!c) return;
  if (!els.classQrBox.hidden) { els.classQrBox.hidden = true; els.classQr.textContent = 'Show QR code'; return; }
  try {
    const qrcode = await loadQr();
    const q = qrcode(0, 'M');
    q.addData(c.page);
    q.make();
    els.classQrBox.innerHTML = q.createSvgTag(6, 2); // the library's own SVG of our own URL: no user text inside
    els.classQrBox.append(el('p', { class: 'hint' }, `Scan to open ${c.name}'s calendar. Put it on the projector or the notice board.`));
    els.classQrBox.hidden = false;
    els.classQr.textContent = 'Hide QR code';
  } catch (err) { classSay(err.message, 'error'); }
}

async function renameClass() {
  const c = myClass();
  if (!c || state.classBusy) return;
  const name = (window.prompt('New name for the class:', c.name) || '').replace(/\s+/g, ' ').trim().slice(0, 80);
  if (!name || name === c.name) return;
  setClassBusy(true);
  try {
    await feedCall('PATCH', `/api/class/${c.id}`, { body: { name }, token: c.secret });
    saveClass({ ...c, name });
    renderClass();
    classSay(`Renamed to ${name}.`, 'ok');
  } catch (err) { classSay(err.message, 'error'); } finally { setClassBusy(false); }
}

// The class key lives only in this browser. A second phone (or a co-CR) gets it through a link that carries it in the
// #hash (never sent to any server by the browser).
async function backupClass() {
  const c = myClass();
  if (!c) return;
  if (!window.confirm('This copies a link that lets ANY phone publish to your class. Send it only to yourself or a co-CR, never to the class group. Continue?')) return;
  const link = `${appLink()}#cr=${c.id}.${c.secret}`;
  try { await navigator.clipboard.writeText(link); classSay('Class key link copied. Open it on the other phone. If it leaks, use "New class key".', 'ok'); }
  catch { classSay(`Could not copy. Long-press to copy: ${link}`, 'error'); }
}

async function importClassKey(id, secret) {
  history.replaceState(null, '', location.pathname + location.search);
  if (!/^[a-z0-9]{6,12}$/.test(id) || !/^[a-z0-9]{8,64}$/.test(secret)) return false;
  const cur = myClass();
  if (cur && cur.id === id && cur.secret === secret) { classSay(`This phone already publishes to ${cur.name}.`, 'ok'); return true; }
  try {
    const data = await feedCall('GET', `/api/class/${id}/events`, { token: secret });
    if (!window.confirm(`Use this phone to publish to ${data.name}?${cur ? ` It replaces ${cur.name} on this phone.` : ''}`)) return false;
    saveClass({ id, secret, name: data.name, feed: data.feed, page: data.page });
    renderClass();
    classSay(`This phone now publishes to ${data.name}.`, 'ok');
    loadConsole();
    els.classSection.scrollIntoView({ block: 'start' });
    return true;
  } catch (err) {
    window.alert(err.status === 401 ? 'That class key link is out of date (a new key was made). Ask for a fresh link.' : err.message);
    return false;
  }
}

async function rotateKey() {
  const c = myClass();
  if (!c || state.classBusy || !window.confirm('Make a new class key? Every other phone that publishes to this class stops working until you send it a new "Use on another phone" link. Students are not affected.')) return;
  setClassBusy(true);
  try {
    const r = await feedCall('POST', `/api/class/${c.id}/rotate`, { token: c.secret });
    saveClass({ ...c, secret: r.secret });
    classSay('New class key made. Old key links no longer work.', 'ok');
  } catch (err) { classSay(err.message, 'error'); } finally { setClassBusy(false); }
}

function forgetClass() {
  const c = myClass();
  if (!c || !window.confirm(`Forget ${c.name} on this phone? The class calendar stays online for students. Without a key link you cannot publish to it again from here.`)) return;
  try { localStorage.removeItem(CLASS_KEY); } catch { /* ignore */ }
  state.pending = null;
  els.classPreview.hidden = true;
  els.classConsoleList.replaceChildren();
  els.classChanges.replaceChildren();
  renderClass();
  classSay(`Forgot ${c.name} on this phone.`, '');
}

// A student opens a class: the published events load like a shared link (no notice text, export open).
async function openClass(idOrLink) {
  const id = (/\/c\/([a-z0-9]{6,12})/.exec(idOrLink || '') || [, (idOrLink || '').trim().toLowerCase()])[1];
  const say = (msg, kind) => { for (const n of [els.classOpenResult, els.classResult]) { n.textContent = msg; n.dataset.kind = kind; } };
  if (!/^[a-z0-9]{6,12}$/.test(id)) { say('Paste the class link or its 8-character id.', 'error'); return false; }
  if (state.classBusy) return false;
  setClassBusy(true);
  say('Opening the class...', '');
  try {
    const data = await feedCall('GET', `/c/${id}.json`);
    const events = data.events.filter((e) => !e.cancelled)
      .sort((a, b) => `${a.date}${a.start || ''}`.localeCompare(`${b.date}${b.start || ''}`)) // by date, not by publish order
      .map((e, i) => workingCopy({ ...e, id: `c${i + 1}`, why: { title: `published to ${data.name}` }, flags: [] }, i));
    state.seq++;
    state.decodedText = '';
    state.result = { warnings: [], pending: [], notes: [] };
    state.events = events;
    state.exportNote = null;
    state.aiUndo = null;
    state.aiNote = null;
    state.shared = { from: `the class representative of ${data.name}`, on: safeDate((data.updatedAt || '').slice(0, 10)), changes: data.changes || [] };
    state.lastRemoved = null;
    const mine = myClass();
    if (!mine || mine.id !== id) saveFollow({ id, name: data.name, seen: data.updatedAt });
    els.results.hidden = false;
    renderAll();
    renderClass();
    els.results.focus();
    say(events.length ? `Opened ${data.name}: ${events.length} event${events.length === 1 ? '' : 's'}.` : `Nothing published in ${data.name} yet.`, 'ok');
    return true;
  } catch (err) {
    say(err.status === 404 ? 'No class with that link. Ask your class representative for the current link.' : err.message, 'error');
    return false;
  } finally {
    setClassBusy(false);
  }
}

// The followed class, counted in the background: "2 changes since you last opened it".
async function checkFollowed() {
  const f = followed();
  if (!f || !feedBase() || !navigator.onLine) return;
  try {
    const data = await feedCall('GET', `/c/${f.id}.json`);
    const fresh = (data.changes || []).filter((x) => !f.seen || x.at > f.seen).length;
    saveFollow({ ...f, name: data.name, fresh });
    renderClass();
  } catch (err) { if (err.status === 404) { saveFollow(null); renderClass(); } }
}

// ---------- files: PDF text, photo OCR, drag-drop, pasted images, shared files ----------

function fileStatus(msg, kind = '') {
  els.fileStatus.hidden = !msg;
  els.fileStatus.textContent = msg || '';
  els.fileStatus.dataset.kind = kind;
  els.inputCard.setAttribute('aria-busy', kind === 'busy' ? 'true' : 'false');
}

// One path for every file: a PDF's text layer, or OCR for images and scanned PDF pages. The text lands in the paste
// box (editable) and is decoded with source 'ocr' / 'pdf', which makes every dated event ask for one confirmation.
// What went wrong with a file, in words a student can act on.
function fileError(err, name) {
  const n = err?.name || '', msg = String(err?.message || err || '');
  if (n === 'PasswordException' || /password/i.test(msg)) return `"${name}" is password-protected. Open it, save or print it as a new PDF without the password, then upload that.`;
  if (n === 'InvalidPDFException' || n === 'FormatError' || n === 'UnknownErrorException' || /Invalid PDF|PDF header|bad XRef|Unexpected server response/i.test(msg)) return `"${name}" is not a readable PDF (it may be damaged or only half downloaded). Download it again.`;
  if (/did not load|Failed to fetch dynamically|error loading dynamically|Importing a module script failed|NetworkError/i.test(msg)) return 'The PDF/photo reader could not be downloaded (offline?). Try once with internet; after that it works offline.';
  if (n === 'InvalidStateError' || n === 'EncodingError' || /decode|source image|could not be decoded|not a valid image/i.test(msg)) return `"${name}" could not be opened as a picture. Send a JPG or PNG (a screenshot works).`;
  return msg || `"${name}" could not be read.`;
}

// One path for every file: plain text, a Word file, a PDF's text layer, or OCR for images and scanned PDF pages. The
// text lands in the paste box (editable) and is decoded; a picture's text is decoded with source 'ocr', which makes
// every dated event ask for one confirmation. A second file chosen while the first is still being read wins.
async function handleFile(file, { auto = false } = {}) {
  if (!file) return;
  const job = ++state.fileJob;
  const stale = () => job !== state.fileJob;
  const name = (file.name || 'file').slice(0, 80);
  const isPdf = file.type === 'application/pdf' || /\.pdf$/i.test(name);
  const isDocx = /\.docx$/i.test(name) || file.type === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
  const isOldWord = /\.doc$/i.test(name) || file.type === 'application/msword';
  const isImage = !isPdf && (/^image\//.test(file.type) || /\.(png|jpe?g|webp|gif|bmp|heic|heif|avif)$/i.test(name));
  const isText = /^text\//.test(file.type) || /\.(txt|md|csv)$/i.test(name);
  if (isOldWord && !isDocx) { fileStatus(`"${name}" is an old Word file (.doc). Open it and save it as .docx or PDF, then upload that.`, 'error'); return; }
  if (!isPdf && !isImage && !isText && !isDocx) { fileStatus(`"${name}" is not a PDF, a Word file (.docx), a photo or a text file.`, 'error'); return; }
  if (file.size === 0) { fileStatus(`"${name}" is empty (0 bytes). Download it again and retry.`, 'error'); return; }
  if (file.size > 25 * 1024 * 1024) { fileStatus(`"${name}" is over 25 MB. Take a smaller photo or export fewer pages.`, 'error'); return; }
  if (/\.(heic|heif)$/i.test(name) && !(/Safari/.test(navigator.userAgent) && !/Chrome|Chromium|CriOS|Edg|Android/.test(navigator.userAgent))) { fileStatus(`"${name}" is an iPhone HEIC photo, which this browser cannot open. Send a screenshot or a JPG instead.`, 'error'); return; }
  try {
    if (isText) {
      const text = (await file.text()).slice(0, 200000);
      if (stale()) return;
      els.input.value = text;
      fileStatus('');
      decode(text, { auto });
      return;
    }
    let text = '', source = 'pdf', notes = [];
    if (isDocx) {
      fileStatus(`Reading ${name}…`, 'busy');
      const { docxToText } = await import('./docx.js');
      text = await docxToText(file);
      source = 'docx';
    } else if (isPdf) {
      fileStatus(`Reading ${name}…`, 'busy');
      const { pdfToText } = await import('./pdftext.js');
      const r = await pdfToText(file, { onProgress: ({ page, pages }) => !stale() && fileStatus(`Reading ${name}: page ${page} of ${pages}…`, 'busy') });
      if (stale()) return;
      text = r.text;
      if (r.truncated) notes.push(`Only the first 5 of ${r.pages} pages were read.`);
      if (r.scanned.length) {
        const { ocrImage } = await import('./ocr.js');
        for (const [i, canvas] of r.scanned.entries()) {
          if (stale()) return;
          const o = await ocrImage(canvas, { hindi: els.hindi.checked, onProgress: (p) => !stale() && fileStatus(`Scanned page ${i + 1}: reading the picture… ${Math.round((p.progress || 0) * 100)}%`, 'busy') });
          text += (text ? '\n\n' : '') + o.text;
          source = 'ocr';
          if (o.lowLines.length) notes.push(`${o.lowLines.length} line${o.lowLines.length > 1 ? 's' : ''} read with low confidence.`);
        }
      }
    } else {
      fileStatus('Reading the photo…', 'busy');
      const { ocrImage } = await import('./ocr.js');
      const o = await ocrImage(file, { hindi: els.hindi.checked, onProgress: (p) => !stale() && fileStatus(p.stage === 'read' ? `Reading the photo… ${Math.round(p.progress * 100)}%` : `Preparing the reader (${p.stage})…`, 'busy') });
      text = o.text;
      source = 'ocr';
      if (o.lowLines.length) notes.push(`${o.lowLines.length} line${o.lowLines.length > 1 ? 's' : ''} read with low confidence: ${o.lowLines.slice(0, 3).map((l) => `"${l.text.trim().slice(0, 40)}"`).join(', ')}.`);
    }
    if (stale()) return;
    if (source !== 'docx') text = fixOcrText(text); // PDF lines are wrapped at the page edge, photos garble digits
    if (text.replace(/\s/g, '').length < 15) {
      fileStatus(source === 'ocr' || isImage ? `Nothing readable found in ${name}. Try a sharper, straighter photo with the notice filling the frame.` : `${name} has no text in it to read.`, 'error');
      return;
    }
    els.input.value = text;
    const from = source === 'ocr' ? ' from the picture' : '';
    fileStatus(`Read ${name}${from}. ${notes.join(' ')} ${source === 'ocr' ? 'Check the amber fields against the original.' : ''}`.replace(/\s+/g, ' ').trim(), 'ok');
    // A Word file is typed text (no amber for it); a PDF or a photo is decoded with its source, so it asks first.
    decode(text, { auto: false, source }); // never auto-add from a file: what was read is checked first
  } catch (err) {
    if (stale()) return;
    console.warn('file read failed', err);
    fileStatus(fileError(err, name), 'error');
  }
}

// A file shared from another app lands here via the service worker (manifest share_target, POST).
async function fromSharedFile() {
  if (new URLSearchParams(location.search).get('shared') !== 'file') return false;
  history.replaceState(null, '', location.pathname);
  try {
    const cache = await caches.open('nd-share');
    const res = await cache.match('./shared-file');
    if (!res) return false;
    await cache.delete('./shared-file');
    const blob = await res.blob();
    const name = decodeURIComponent(res.headers.get('x-nd-name') || 'shared');
    await handleFile(new File([blob], name, { type: res.headers.get('content-type') || blob.type }), { auto: true });
    return true;
  } catch { return false; }
}

function setupFiles() {
  // The Android companion posts a shared file in as { type: 'nd-file', name, mime, data (base64) }.
  const fromCompanion = (e) => {
    let msg;
    try { msg = typeof e.data === 'string' ? JSON.parse(e.data) : e.data; } catch { return; }
    if (!msg || msg.type !== 'nd-file' || typeof msg.data !== 'string') return;
    const bytes = Uint8Array.from(atob(msg.data), (c) => c.charCodeAt(0));
    handleFile(new File([bytes], msg.name || 'shared', { type: msg.mime || 'application/octet-stream' }));
  };
  window.addEventListener('message', fromCompanion);
  document.addEventListener('message', fromCompanion); // Android WebView delivers on document
  els.upload.addEventListener('click', () => els.fileInput.click());
  els.fileInput.addEventListener('change', () => { handleFile(els.fileInput.files[0]); els.fileInput.value = ''; });
  if (/Android|iPhone|iPad/i.test(navigator.userAgent)) els.camera.hidden = false;
  els.camera.addEventListener('click', () => els.cameraInput.click());
  els.cameraInput.addEventListener('change', () => { handleFile(els.cameraInput.files[0]); els.cameraInput.value = ''; });
  // Drop a file on the paste card
  for (const type of ['dragenter', 'dragover']) els.inputCard.addEventListener(type, (e) => { e.preventDefault(); els.inputCard.classList.add('drop'); });
  for (const type of ['dragleave', 'drop']) els.inputCard.addEventListener(type, (e) => { e.preventDefault(); els.inputCard.classList.remove('drop'); });
  els.inputCard.addEventListener('drop', (e) => { const f = e.dataTransfer?.files?.[0]; if (f) handleFile(f); });
  // Paste a screenshot (Ctrl+V with an image on the clipboard)
  els.input.addEventListener('paste', (e) => {
    const f = [...(e.clipboardData?.files || [])][0];
    if (f && /^image\//.test(f.type)) { e.preventDefault(); handleFile(f); }
  });
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
  els.input.addEventListener('paste', (e) => {
    if ([...(e.clipboardData?.files || [])].some((f) => /^image\//.test(f.type))) return; // a screenshot: setupFiles reads it
    setTimeout(() => { if (els.input.value !== state.lastInput) decode(els.input.value); }, 0);
  });
  els.input.addEventListener('input', () => {
    if (els.input.value.trim()) clearInputError();
    // Typing while a photo is still being read: the student wins, the photo's text will not overwrite theirs.
    if (els.fileStatus.dataset.kind === 'busy') { state.fileJob++; fileStatus('Stopped reading the file: you are typing the notice yourself.'); }
    clearTimeout(typing);
    typing = setTimeout(() => {
      const text = els.input.value;
      if (text.trim().length >= 15 && text !== state.lastInput) decode(text, { source: state.source || 'text' }); // an edited OCR text stays "from a photo"
    }, DECODE_DEBOUNCE_MS);
  });
  setupFiles();
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
  els.classConfirm.addEventListener('click', confirmPublish);
  els.classPreviewCancel.addEventListener('click', cancelPreview);
  els.classLink.addEventListener('click', copyClassLink);
  els.classWa.addEventListener('click', sendClassLink);
  els.classQr.addEventListener('click', toggleQr);
  els.classRefresh.addEventListener('click', loadConsole);
  els.classRename.addEventListener('click', renameClass);
  els.classBackup.addEventListener('click', backupClass);
  els.classRotate.addEventListener('click', rotateKey);
  els.classForget.addEventListener('click', forgetClass);
  els.classJoinBtn.addEventListener('click', () => openClass(els.classJoin.value));
  els.classJoin.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); openClass(els.classJoin.value); } });
  els.followOpen.addEventListener('click', () => { const f = followed(); if (f) openClass(f.id); });
  els.aiBtn.addEventListener('click', () => runAi());
  els.aiToggle.checked = aiOn();
  els.aiToggle.addEventListener('change', () => { try { localStorage.setItem(AI_KEY, els.aiToggle.checked ? '1' : '0'); } catch { /* ignore */ } });
  renderClass();
  const classInHash = () => { const m = /[#&]c=([a-z0-9]{6,12})\b/.exec(location.hash); return m && feedBase() ? openClass(m[1]) : false; };
  const keyInHash = () => { const m = /[#&]cr=([a-z0-9]{6,12})\.([a-z0-9]{8,64})\b/.exec(location.hash); return m && feedBase() ? (importClassKey(m[1], m[2]), true) : false; };
  window.addEventListener('hashchange', () => { if (!keyInHash() && !loadShared(location.hash) && !classInHash() && state.shared) clearAll(); });
  setupInstall();
  setupOffline();
  window.addEventListener('online', retryQueued);
  window.addEventListener('online', renderAi);
  window.addEventListener('offline', renderAi);
  retryQueued();
  askAiServer();
  checkFollowed();
  (async () => {
    if (await fromSharedFile()) return;
    if (!fromShareTarget() && !loadShared(location.hash) && !keyInHash()) classInHash();
  })();
}

init();
