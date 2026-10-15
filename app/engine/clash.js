// Clash rules from the problem statement:
// two events clash when each starts before the other ends; a deadline (or any "by" time) is a point
// and clashes when it falls inside another event.
import { toMin, fromMin, fmt12 } from './dates.js';

// A deadline or a "by 9 PM" time is a point. Any other event without an end lasts its duration, or 1 hour,
// the same length the calendar file and the timeline use.
const isPoint = (e) => e.type === 'deadline' || Boolean(e.point);
const endOf = (e) => (e.end && toMin(e.end) > toMin(e.start) ? toMin(e.end) : toMin(e.start) + (e.durationMin || 60));
const span = (e) => (isPoint(e) ? [toMin(e.start), toMin(e.start)] : [toMin(e.start), endOf(e)]);
const name = (e, other) => (e.typeLabel && other.typeLabel && e.typeLabel !== other.typeLabel ? `the ${e.typeLabel.toLowerCase()}` : `"${e.title}"`);

function range(a, b) {
  const [fa, fb] = [fmt12(fromMin(a)), fmt12(fromMin(b))];
  return fa.slice(-2) === fb.slice(-2) ? `${fa.slice(0, -3)} to ${fb}` : `${fa} to ${fb}`;
}

// Latest moment before `t` that is not inside any timed event of that day.
function freeBefore(t, sameDay) {
  let edge = t;
  let moved = true;
  while (moved) {
    moved = false;
    for (const e of sameDay) {
      const [s, en] = span(e);
      if (!isPoint(e) && s < edge && en >= edge) { edge = s; moved = true; }
    }
  }
  return edge;
}

export function findClashes(events) {
  // An end before the start (a typo, or an edit in progress) counts as "no end", exactly as the timeline draws it.
  const timed = events.filter((e) => e.date && e.start);
  const rows = [];
  for (let i = 0; i < timed.length; i++) {
    for (let j = i + 1; j < timed.length; j++) {
      const [a, b] = [timed[i], timed[j]];
      if (a.date !== b.date) continue;
      rows.push(compare(a, b, timed.filter((e) => e.date === a.date)));
    }
  }
  return rows;
}

function compare(a, b, sameDay) {
  const [as, ae] = span(a), [bs, be] = span(b);
  const base = { a: a.id, b: b.id, overlapMin: 0, action: null };

  // A test you may take any time in a window (1:30-5 PM, 60 minutes) clashes only if no free slot of that length is left.
  for (const [w, o] of [[a, b], [b, a]]) {
    if (!w.window || !w.durationMin || isPoint(w) || !w.end) continue;
    const [ws, we] = span(w), [os, oe] = span(o);
    if (oe <= ws || os >= we) break;
    const slot = os - ws >= w.durationMin ? ws : we - oe >= w.durationMin ? Math.max(oe, ws) : null;
    if (slot !== null) {
      return { ...base, kind: 'none', msg: `No clash. "${w.title}" is open ${range(ws, we)} and takes ${w.durationMin} minutes; take it ${range(slot, slot + w.durationMin)}, outside "${o.title}".` };
    }
  }

  if (isPoint(a) && isPoint(b)) {
    if (as === bs) return { ...base, kind: 'overlap', msg: `Clash. Both are at ${fmt12(a.start)}.`, action: `Ask which one comes first; you cannot do both at ${fmt12(a.start)}.` };
    const [first, second] = as < bs ? [a, b] : [b, a];
    return { ...base, kind: 'none', msg: `No clash. ${cap(name(first, second))} ${/s$/i.test(first.typeLabel || '') ? 'are' : 'is'} at ${fmt12(first.start)}, before ${name(second, first)} at ${fmt12(second.start)}.` };
  }
  if (isPoint(a) || isPoint(b)) {
    const [p, ev] = isPoint(a) ? [a, b] : [b, a];
    const [s, e] = span(ev), t = toMin(p.start);
    const what = p.type === 'deadline' ? `The ${fmt12(p.start)} deadline` : `${cap(name(p, ev))} at ${fmt12(p.start)}`;
    const is = p.type !== 'deadline' && /s$/i.test(p.typeLabel || '') ? 'are' : 'is';
    if ((t > s && t < e) || (p.type !== 'deadline' && t === s)) {
      const free = freeBefore(t, sameDay);
      const busy = sameDay.filter((x) => !isPoint(x) && toMin(x.start) < t && toMin(x.end) > free).map((x) => `"${x.title}"`);
      const action = p.type === 'deadline'
        ? `Finish "${p.title}" before ${fmt12(fromMin(free))}: from ${fmt12(fromMin(free))} to ${fmt12(p.start)} you are in ${busy.join(' and ')}.`
        : `Ask the coordinator whether you can leave ${name(ev, p)} for it.`;
      return { ...base, kind: 'deadline-inside', msg: `Clash. ${what} falls during ${name(ev, p)} (${range(s, e)}).`, action };
    }
    const rel = t <= s ? `before ${name(ev, p)} starts at ${fmt12(ev.start)}` : `after ${name(ev, p)} ends at ${fmt12(fromMin(e))}`;
    return { ...base, kind: 'none', msg: `No clash. ${what} ${is} ${rel}.` };
  }
  const from = Math.max(as, bs), to = Math.min(ae, be);
  if (from < to) {
    const later = as > bs || (as === bs && ae > be) ? a : b;
    return { ...base, kind: 'overlap', overlapMin: to - from, msg: `Clash. They overlap from ${range(from, to)} (${to - from} minutes).`,
      action: `Ask the coordinator about "${later.title}", or decide which one to attend; ${to - from} minutes overlap.` };
  }
  const [first, second] = as < bs ? [a, b] : [b, a];
  return { ...base, kind: 'none', msg: `No clash. ${cap(name(first, second))} ends at ${fmt12(fromMin(endOf(first)))}, before ${name(second, first)} starts at ${fmt12(second.start)}.` };
}

const cap = (s) => s.charAt(0).toUpperCase() + s.slice(1);
