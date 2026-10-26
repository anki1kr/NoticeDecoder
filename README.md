# Notice Decoder

**SETU 2026 · Forge Realm · PS-02.** Paste a messy college notice. Get clear events, catch clashes, add them to your calendar.

| Demo video | Website | Code |
|---|---|---|
| https://youtu.be/joI75POVTr0 | https://noticedecoder.pages.dev/app/ | https://github.com/anki1kr/NoticeDecoder |

The rules run in the browser: the notice is read on your device. Only when the rules are unsure, an optional AI check (Claude Haiku) gets the notice text to fix names; dates always come from the rules. Installs as an app (add to home screen); once installed it opens offline and appears in WhatsApp's **Share** sheet, so a notice goes from the class group to decoded events in two taps.

## 2026-10-26: AI check, class calendar v2, Word files, break-tested

| What | How it works | Code |
|---|---|---|
| **AI check, only when the rules are unsure** | A weak name ("Practical" read out of "practical innovations"), nothing found in a notice that has dates, or text from a photo triggers ONE call to Claude Haiku 5.5 through the class server; a clean notice costs nothing. The model gets the notice (capped at 6,000 characters) plus one line per event and answers a few JSON fields. It never sets a date or a time: a new name is used only if its quote is really in the notice and its words are the notice's words; an event it says the rules missed is dated by our own rules from the words it quotes, and comes in amber. Every AI change is marked, highlighted in the notice and has Undo. Same notice twice = answered from the cache. The key lives only on the server; per-IP limit and a daily cap (300 calls a day, well under $0.10 at Haiku prices) bound the spend. | `app/ai.js`, `worker/src/ai.js` |
| **Class calendar v2** | The CR sees a **preview** ("2 new, 1 moved") before the class does. A second "Quiz" on another date is a new event (v1 silently moved the first one); a specific title on another date, or a notice that says "postponed to", moves it, and the CR can flip either guess with one tap. Console: edit a published event's date/time/venue in place (same UID, so every subscriber's copy moves), cancel and **bring back**, "What changed lately", QR code for the projector, WhatsApp link, rename, a key link for a second phone or co-CR, a new key if that link leaks, forget on this device. Students see what changed when they open the class, and the class is one tap away next time. A "Class representative?" line in the paste card leads a CR to the class calendar, which otherwise sits at the end of the results. The subscribe page groups upcoming events by day (Today / Tomorrow), lists changes and clashes, has a QR code and a dark mode. | `worker/src/feed.js`, `worker/src/page.js`, `app/app.js` |
| **Word files** | `.docx` read on the device with no library (a .docx is a zip; the browser's `DecompressionStream` inflates it); tables come out as `cell \| cell` rows, so an exam timetable in a Word table becomes one event per row. Old `.doc`, damaged, password-protected and zip-bomb files get a plain message. | `app/docx.js` |
| **Break-tested** | 30,000 random notices and 4,000 random event lists through the engine (fuzz), 200 KB pastes, script in notices, tampered share links, 5-digit years, 31 Feb, `javascript:` links, double and triple taps on every button, broken and wrong files, the AI answering late or not at all, the class server down, a leaked class key. Bugs found and fixed are listed in `docs/BREAK-TEST.md`. | `tests/fuzz.test.mjs`, `tools/break-check.mjs` |

## Zero-touch (2026-10-15)

Paste -> fix -> download was three steps too many. Now the notice comes in by itself, the rules run, and the events go
into the calendar by themselves; the student is asked **only** when a field is uncertain (amber). That keeps PS-02's
review rule ("the user can fix every field before anything is exported") and makes the common case one tap or none:

| Where the notice arrives | What happens | Code |
|---|---|---|
| **WhatsApp class group** (Android) | The companion app reads the group's notifications, decodes on the phone, writes the events into the phone calendar, and notifies *Added 3 events (Undo)*. An amber field -> *1 event needs a check* -> the web app opens on that one event. | `companion/` |
| **College email** | A Gmail Apps Script in the student's own Google account runs every 15 min: certain events straight into Google Calendar, amber ones -> one email with a one-tap check link. | `integrations/gmail-apps-script/` |
| **Shared to the web app** (WhatsApp -> Share, or the paste button) | Decodes at once (no Decode click), clean events as one-line rows, amber ones as the only forms. **Add all to Google Calendar** writes them in one tap (sign-in once). With *Add automatically* on and nothing amber, a shared notice adds itself. | `app/app.js`, `app/gcal.js` |
| **A PDF or a photo of the notice board** (upload, drag-drop, paste a screenshot, camera, or WhatsApp → Share a file) | Read on the device: pdf.js for the text layer, Tesseract OCR for photos and scanned pages, then the same rules. OCR mistakes are silent, so every event from a photo asks for one "Looks right". Nothing is uploaded; the reader downloads once (~10 MB) and then works offline. | `app/pdftext.js`, `app/ocr.js`, `app/engine/ocrfix.js` |
| **The class representative publishes** | One click; the class subscribes once to a calendar link that updates itself when a notice is revised, with a term-wide clash report on every publish. The CR console lists everything published and cancels an event for the whole class; feeds answer 304 to pollers and carry refresh hints. | `worker/`, section 6 in `app/app.js` |

Same UIDs everywhere (`app/engine/ics.js::calendarEntries`): adding twice updates, a revised notice moves the event,
nothing duplicates. Offline when auto-adding? The reviewed events wait in the browser and go in when the connection
returns. Multi-day runs ("practicals 25 to 30 Oct") are clash-checked on every day they run. Setup for each piece is
in its folder's README; the owner's four one-time steps are in `docs/DEPLOY.md` (`node tools/configure.mjs` writes the
ids into every file, `node tools/smoke-live.mjs` checks the live site). Still manual: the paste box, as the fallback.

## What it does

1. **Paste** a notice from WhatsApp, a PDF or the notice board (or tap an example).
2. **Events** come out with title, type (test / deadline / lecture / other), date, start and end time, and venue.
3. **Every field shows why** ("`by 12:00 noon` = must happen by 12:00 PM") and **"Show in notice"** highlights the exact words it came from.
4. **Check only what is uncertain.** Fields the rules are sure of say "Nothing to check"; uncertain ones are outlined in amber with the question to answer, and nothing can be exported until each one is fixed or marked "Looks right". Every field is editable and clashes update as you type.
5. **Clashes** on a timeline, in plain words, with a suggested action. Two events clash when each starts before the other ends; a deadline is a point in time and clashes when it falls inside another event. Events you already added from this browser are kept on the device and checked against every new notice ("already in your calendar"); one button clears them.
6. **Add to Google Calendar** with one tap per event, or **download .ics** for all of them (Google, Outlook, Apple) with reminders by event type.
7. **Share with the class.** *Copy summary* gives a plain-text digest for the group. *Share with class* puts the reviewed events inside a link (no server, nothing stored): whoever opens it sees the same cards, the clash check and the one-tap calendar buttons. *Send on WhatsApp* opens the share sheet with both.

On the problem statement's example it gives exactly the PDF's answer: Test x Lecture overlap 11:00-11:30 (30 min), the 12:00 PM record deadline falls inside the lecture, Test x Deadline no clash, and the action "Finish Lab record submission before 10:00 AM".

## Why it is different

The closest tools we found (ScreenToCal, and a notice-to-calendar project from another Indian hackathon in Sep 2026) send the text or photo to an AI model and use what comes back. Notice Decoder uses rules that explain themselves, built from real notices students receive:

| Real notice problem | What Notice Decoder does |
|---|---|
| `04/05/2027`: 4 May or 5 April? | Reads Indian day-first dates and **asks** when both readings are possible |
| "Date: 15 Oct" on one line, "Time: 6:30 PM" on the next | Pairs labelled lines into one event (a plain date library puts 6:30 PM on *today*) |
| "today's placement drive, Date: 05 Oct" | "today" means the **notice's own date**, not the day you paste it |
| "40 questions in 60 min, available 1:30pm-5pm" | Knows 60 min is a **duration** and 1:30-5 is a **window** |
| "GD this week or next week", "joining dates will be confirmed" | Goes to **Not scheduled yet**, never a fake date in your calendar |
| "results by today 9pm" ... "results shared next day" | Flags the **contradiction** inside the notice |
| A notice forwarded 9 days late | "This notice looks old, these events have already passed" |
| An outside group asking you to join a WhatsApp group | **Source warning**: check with your college first |
| "12 noon", "FN/AN", "kal shaam 5 baje" | Indian and Hinglish time words |
| No end time, no AM/PM, no year | Filled with a clearly flagged assumption, never silently |
| Two exams at 10 AM on the same day | Two events and a **clash**, not one merged card (a bug fixed 2026-10-15: same-type events used to merge) |
| "Internal Test at 10 AM in Room 204 and a guest lecture at 11 AM" | One sentence, **two events** |
| "Maths on 12 Nov at 10 AM, Physics on 13 Nov at 10 AM and Chemistry on 14 Nov at 10 AM" | **Three events**, each named by its subject ("Internal tests: Physics") |
| "Deadline extended from 15/11/2026 to 22/11/2026 5 PM" | Takes the **new** date and keeps "It was 15 Nov" as a note |
| "1-2 Nov", "5th & 6th Dec", "8, 9 and 10 Nov", "exams commence 10 Nov and end on 18 Nov" | One multi-day event; the clash check runs on every day |
| "Every Monday and Wednesday 4-5 PM, starting 9 Nov" | A **weekly** event (`RRULE:FREQ=WEEKLY;BYDAY=MO,WE`). With no end date it adds four weeks and asks, never an endless series |
| "Aaj wali class cancel hai", "no classes on 14 Nov" | Reported, **never added** to the calendar |
| "Mr. Sharma sir ka extra class hoga Room 12 me" | An "Extra class" in Room 12: "Mr." does not end the sentence, Hinglish place words are read |
| MST-2, CIE-1, CAT-2 | Exam acronyms are tests and keep their number |
| A timetable: `13 Nov 2026 - DBMS - 10 AM to 1 PM - Room 101` per line | Each row is an exam named by its subject, kind from the header line, room from the cell |
| "Thursday, 13 Nov 2026" when 13 Nov is a Friday | **Asks which one is right** instead of picking silently |
| An exam on Diwali, or on a Sunday | Flags the gazetted holiday (`app/engine/holidays.js`, editable per college); notes the Sunday |
| `75/100 attendance`, `Unit 3/4` | Not read as dates |
| `2026-11-20` (portal format), `0700 hrs`, `by EOD`, "between 9 and 11 AM", "starts at 10 and ends by 1" | Read, with EOD flagged as an assumption |
| "Reporting time 8:30 AM, Time 10:00 AM" | Starts at 10, reporting time kept as a note |
| गणित की परीक्षा 13 नवंबर 2026 को सुबह 10 बजे कमरा 204 में | Hindi months, times, event words and rooms (Devanagari digits too) |
| "13 Nvo", "Thrusday", "Sepetmber" | Typo-tolerant month and weekday names (same length, offsets kept), with a note "read 'Nvo' as Nov" |
| A photo: `1O:OO AM`, `l3 Nov`, `Room2O4`, lines broken at the paper's edge | OCR cleanup before the rules: letter/digit confusions inside numbers, glued AM/PM, dewrapped sentences, table pipes |

None of this needs AI, so results are the same every time, cost nothing to run and can be checked by the student. The optional AI check only names and sorts what the rules found (or points at what they missed); it never sets a date or a time.

## Who pays (sustainability)

- **Students: free, always** (paste, fix, clash check, .ics). Free core tiers are normal for student tools (Notion is free for students; TimeTree's core is free).
- **Departments: yearly plan for "Publish to class"**, proposed at ₹2,999 per department per year, free for a first pilot term. The free version of this already works: the CR decodes once and shares a link that carries the events (no server). The paid plan is the hosted version of that link: one subscription calendar per class that **updates itself** when a revised notice is published, with clash checks across every notice of the term. The CR or a teacher is the daily user; the HOD signs off from the department budget. Today a class representative forwards every notice by hand. APSIT Mumbai moved notices out of WhatsApp groups in Sep 2025 because many students missed them, and Jamia (Sep 2026) now routes academic notices through official CR-run class groups. With the licence, a faculty member or CR decodes a notice once and the whole class subscribes to one calendar link. A full college ERP such as Fedena lists $999-1,699 a year, so a single-purpose add-on can be priced well below that.
- **Student extras (later):** photo/PDF reading, WhatsApp reminders (each message has a cost, so it is a paid feature).
- **Cost to run:** the rules run on the student's phone, so each notice costs us about nothing; hosting fits a free static tier.
- **The pilot is measurable:** the class console shows notices published, events live, events revised, events cancelled and clashes reported before the date, straight from what the class published. The terms are on `app/pilot.html` ("For departments" in the app footer).
- Honest status: no college has paid yet; the next step is a one-department pilot.

Sources: [APSIT e-notice board post, 23 Sep 2025](https://elearn.apsit.edu.in/moodle/mod/forum/discuss.php?d=65) ·
[Jamia class groups, Careers360, 9 Sep 2026](https://news.careers360.com/jamia-asks-students-deans-hod-to-avoid-unofficial-class-groups-jmi-channel) ·
[St Agnes exams in Dasara holidays, PTI via Careers360, 12 Oct 2026](https://news.careers360.com/mangaluru-st-agnes-students-protest-against-administration-for-scheduling-exams-during-dasara-holidays) ·
[Fedena pricing](https://fedena.com/pricing-and-plans).

## Run it

No install, no build. Serve the `app` folder with any static server:

```bash
npx serve app        # or: python -m http.server 8000 --directory app
```

Tests (Node 20+): `node tests/engine.test.mjs` (45 engine tests), `node tests/fuzz.test.mjs` (1,500 random notices + 4,000 random event lists + 200 KB pastes; `FUZZ_N`/`FUZZ_SEED` for more), `node tests/files.test.mjs` (Word reader, broken files, AI-answer guard, 7), `npm ci --prefix worker && node worker/test/feed.test.mjs` (18) `&& node worker/test/ai.test.mjs` (10, a fake Claude, no key), `node tools/bundle-engine.mjs && node integrations/gmail-apps-script/test/run.mjs` (7), `cd companion && npm test` (5).

Browser checks (Playwright; `PLAYWRIGHT_DIR` may point at any project that has it): start the app (`python -m http.server 8771 --bind 127.0.0.1 --directory app`) and the REAL Worker on Node with a fake Claude (`node tools/feed-dev.mjs --port 8787 --fake-ai`, no Cloudflare account needed), then `node tools/ui-check.mjs` (89 checks: the whole page, share link, share target, offline, class feed, the class rep entry) and `node tools/break-check.mjs` (74 ways to break it; 80 with `OCR_CHECKS=1`, which also reads photos, a scanned PDF and a 108-megapixel picture). Test notices live in `examples/`; broken files in `tests/fixtures/` (`python tools/make-file-fixtures.py` rebuilds them).

## Code map

- `app/engine/dates.js`: date, time, duration finders (each keeps its exact position in the text)
- `app/engine/parse.js`: notice-context rules (labelled blocks, anchor date, merge, pending, contradictions, warnings)
- `app/engine/clash.js`: clash rules and suggested actions
- `app/engine/ics.js`: RFC 5545 calendar file (CRLF, 75-octet folding, Asia/Kolkata time zone, reminders)
- `app/engine/holidays.js`: gazetted holidays 2026-27, used only to ask "is the college open?"
- `app/index.html`, `app/app.js`, `app/styles.css`: the page (cards, timeline, export, share link, Undo)
- `app/manifest.webmanifest`, `app/sw.js`, `app/icon-*.png`: installable app, offline shell, WhatsApp share target
- `app/gcal.js`, `app/config.js`: Google Calendar one-tap writer (needs `GOOGLE_CLIENT_ID`), feed base
- `app/pdftext.js`, `app/ocr.js`, `app/engine/ocrfix.js`: PDF text layer, photo OCR (on-device), OCR cleanup + typo-tolerant names
- `tools/configure.mjs`, `tools/smoke-live.mjs`, `docs/DEPLOY.md`: one-command configuration, live checks, the four owner-side setup steps
- `tools/make-fixtures.py` → `examples/07-photo-notice.png`, `examples/08-pdf-timetable.pdf`: the photo and PDF fixtures the browser check uploads
- `worker/`: class feed + AI check (Cloudflare Worker + KV), `worker/test/feed.test.mjs`, `worker/test/ai.test.mjs`
- `integrations/gmail-apps-script/`: Gmail -> calendar, `test/run.mjs` runs it against fake Apps Script services
- `companion/`: Android app (Expo), `test/pipeline.test.mjs`
- `tools/bundle-engine.mjs` -> `dist/notice-engine.js`: the engine as one plain script for Apps Script and the Android app
- `app/ai.js`: when an AI check is worth a call, what is sent, and the guard that applies an answer without trusting it
- `app/docx.js`: Word (.docx) to text on the device, tables as rows, with zip-bomb and damage checks
- `worker/src/feed.js` (publish plan: new / moved / changed, edits, cancels, what changed), `worker/src/page.js` (subscribe page), `worker/src/ai.js` (Claude Haiku call, cache, daily cap)
- `tools/feed-dev.mjs`: the Worker on plain Node with an in-memory KV and a fake Claude, for the browser checks and an offline demo
- `tools/break-check.mjs`, `tests/fuzz.test.mjs`, `tests/files.test.mjs`: break tests; `docs/BREAK-TEST.md`: what they found
