// Notice Decoder for Gmail. Runs inside YOUR Google account (Apps Script, free): every 15 minutes it reads new
// college notices, runs the same rules engine as the web app, and puts the events into your Google Calendar.
// Nothing leaves your account. Events the rules are sure of are added straight away; anything with an amber
// (uncertain) field is NOT added: you get one email with a one-tap link to check it in the web app.
//
// Files in this project: Code.gs (this), notice-engine.js (paste dist/notice-engine.js from the repo), appsscript.json.
// Setup: see README.md next to this file (6 steps, about 5 minutes).

const CONFIG = {
  // Which mails are notices. Edit the domain, or label notices yourself with "notices".
  query: 'newer_than:3d -label:nd-done (label:notices OR from:(@college.edu))',
  // '' = your default calendar; or the exact name of a calendar you created, e.g. 'College'.
  calendarName: '',
  // Where the "needs a check" link opens.
  appUrl: 'https://noticedecoder.pages.dev/app/',
  // Email yourself when a notice has an uncertain field (recommended). false = only a label.
  emailOnCheck: true,
  maxThreadsPerRun: 20,
};

const LABEL_DONE = 'nd-done';
const LABEL_CHECK = 'nd-check';
const TAG = 'nd-uid';

// Run once from the editor: creates the labels and the 15-minute trigger.
function install() {
  labelNamed(LABEL_DONE);
  labelNamed(LABEL_CHECK);
  for (const t of ScriptApp.getProjectTriggers()) if (t.getHandlerFunction() === 'processNotices') ScriptApp.deleteTrigger(t);
  ScriptApp.newTrigger('processNotices').timeBased().everyMinutes(15).create();
  Logger.log('Installed: processNotices runs every 15 minutes. Query: ' + CONFIG.query);
}

function uninstall() {
  for (const t of ScriptApp.getProjectTriggers()) if (t.getHandlerFunction() === 'processNotices') ScriptApp.deleteTrigger(t);
  Logger.log('Trigger removed. Events already in the calendar stay.');
}

// The trigger target. Safe to run by hand.
function processNotices() {
  const done = labelNamed(LABEL_DONE), check = labelNamed(LABEL_CHECK);
  const cal = calendar();
  const threads = GmailApp.search(CONFIG.query, 0, CONFIG.maxThreadsPerRun);
  const summary = { threads: threads.length, added: 0, updated: 0, check: 0, none: 0 };
  for (const thread of threads) {
    const messages = thread.getMessages();
    const msg = messages[messages.length - 1];
    const text = (msg.getSubject() || '') + '\n\n' + (msg.getPlainBody() || '');
    const r = handleNotice(text, msg.getDate(), cal);
    summary.added += r.added; summary.updated += r.updated;
    if (r.amber.length) {
      summary.check += r.amber.length;
      thread.addLabel(check);
      if (CONFIG.emailOnCheck) mailCheck(msg, r);
    }
    if (!r.added && !r.updated && !r.amber.length) summary.none++;
    thread.addLabel(done);
  }
  Logger.log(JSON.stringify(summary));
  return summary;
}

// One notice -> calendar. Returns { added, updated, amber: [events], clean: [entries] }.
function handleNotice(text, receivedAt, cal) {
  const result = NoticeEngine.parseNotice(text, { pastedAt: receivedAt || new Date() });
  const amber = [], clean = [];
  for (const ev of result.events) {
    if (!ev.date) continue;
    if ((ev.flags || []).some((f) => f.level === 'warn')) amber.push(ev); else clean.push(ev);
  }
  let added = 0, updated = 0;
  for (const entry of NoticeEngine.calendarEntries(clean)) {
    if (upsertEvent(cal, entry)) updated++; else added++;
  }
  return { added, updated, amber, clean, result };
}

// Create or update by UID (kept as a tag on the event), so a revised notice moves the event instead of adding one.
function upsertEvent(cal, entry) {
  const start = localDate(entry.start), end = localDate(entry.end);
  const title = entry.summary;
  const opts = { description: entry.description, location: entry.location || '' };
  const existing = findByUid(cal, entry.uid, start);
  let ev;
  if (existing) {
    ev = existing;
    if (entry.allDay) ev.setAllDayDate(start); else ev.setTime(start, end);
    ev.setTitle(title);
    ev.setDescription(entry.description);
    ev.setLocation(entry.location || '');
  } else {
    ev = entry.allDay ? cal.createAllDayEvent(title, start, opts) : cal.createEvent(title, start, end, opts);
    ev.setTag(TAG, entry.uid);
  }
  if (entry.reminder) {
    ev.removeAllReminders();
    ev.addPopupReminder(entry.reminder.minutes);
  }
  return Boolean(existing);
}

function findByUid(cal, uid, around) {
  const from = new Date(around.getTime() - 400 * 86400000), to = new Date(around.getTime() + 400 * 86400000);
  for (const ev of cal.getEvents(from, to, { search: '' })) if (ev.getTag(TAG) === uid) return ev;
  return null;
}

// "2026-11-13T10:00:00" or "2026-11-13" -> Date in the script's time zone (appsscript.json sets Asia/Kolkata).
function localDate(s) {
  const m = /^(\d{4})-(\d{2})-(\d{2})(?:T(\d{2}):(\d{2}))?/.exec(s);
  return new Date(+m[1], +m[2] - 1, +m[3], m[4] ? +m[4] : 0, m[5] ? +m[5] : 0, 0);
}

// The email for uncertain fields: what was found, what to check, and the one-tap link into the web app.
function mailCheck(msg, r) {
  const lines = [`"${msg.getSubject()}" has ${r.amber.length} event${r.amber.length === 1 ? '' : 's'} with a field to check. It was NOT added to your calendar yet.`, ''];
  for (const ev of r.amber) {
    lines.push(`- ${ev.title} (${ev.typeLabel || ev.type}), ${ev.date}${ev.start ? ' ' + ev.start : ''}${ev.venue ? ', ' + ev.venue : ''}`);
    for (const f of ev.flags.filter((x) => x.level === 'warn')) lines.push(`    check: ${f.msg}`);
  }
  if (r.clean.length) lines.push('', `Added to your calendar without asking (nothing uncertain): ${r.clean.map((e) => e.title).join(', ')}.`);
  lines.push('', 'Open, check, add in one tap:', shareLink(r.amber), '', 'Notice Decoder runs inside your Google account. Reply STOP to nobody: edit CONFIG in the script to change what it reads.');
  MailApp.sendEmail(Session.getActiveUser().getEmail(), `Check ${r.amber.length} event${r.amber.length === 1 ? '' : 's'} from "${msg.getSubject()}"`, lines.join('\n'));
}

// Same payload the web app's "Share with class" produces (app.js shareUrl, version 1), so loadShared() opens it.
function shareLink(events) {
  const payload = {
    v: 1,
    on: Utilities.formatDate(new Date(), 'Asia/Kolkata', 'yyyy-MM-dd'),
    e: events.map((ev) => ({ t: ev.title, k: ev.type, d: ev.date, s: ev.start, e: ev.end, v: ev.venue, l: ev.link, m: ev.durationMin, r: ev.repeat, y: ev.every, p: ev.point ? 1 : 0, w: ev.window ? 1 : 0 })),
  };
  const b64 = Utilities.base64EncodeWebSafe(Utilities.newBlob(JSON.stringify(payload)).getBytes()).replace(/=+$/, '');
  return CONFIG.appUrl + '#s=' + b64;
}

function calendar() {
  if (!CONFIG.calendarName) return CalendarApp.getDefaultCalendar();
  const found = CalendarApp.getCalendarsByName(CONFIG.calendarName);
  return found.length ? found[0] : CalendarApp.createCalendar(CONFIG.calendarName);
}

function labelNamed(name) {
  return GmailApp.getUserLabelByName(name) || GmailApp.createLabel(name);
}

// Editor test: decodes the PS-02 sample without touching Gmail; adds 3 events to the calendar.
function testWithSample() {
  const text = 'All III-year CSE students: Internal Test 2 will be held on 13 Nov 2026 from 10:00 AM to 11:30 AM in Room 204. Lab records must be submitted to the department office by 12:00 noon on 13 Nov. A guest lecture on "AI in Healthcare" is scheduled on 13 Nov, 11:00 AM to 12:30 PM, Seminar Hall.';
  const r = handleNotice(text, new Date(), calendar());
  Logger.log(`added ${r.added}, updated ${r.updated}, to check ${r.amber.length}`);
  return r;
}
