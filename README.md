# Notice Decoder

**SETU 2026 · Forge Realm · PS-02.** Paste a messy college notice. Get clear events, catch clashes, add them to your calendar.

**Live demo: https://anki1kr.me/NoticeDecoder/app/** · Runs fully in the browser: the notice never leaves your device. Installs as an app (add to home screen); once installed it opens offline and appears in WhatsApp's **Share** sheet, so a notice goes from the class group to decoded events in two taps.

## Zero-touch (2026-10-15)

Paste -> fix -> download was three steps too many. Now the notice comes in by itself, the rules run, and the events go
into the calendar by themselves; the student is asked **only** when a field is uncertain (amber). That keeps PS-02's
review rule ("the user can fix every field before anything is exported") and makes the common case one tap or none:

| Where the notice arrives | What happens | Code |
|---|---|---|
| **WhatsApp class group** (Android) | The companion app reads the group's notifications, decodes on the phone, writes the events into the phone calendar, and notifies *Added 3 events (Undo)*. An amber field -> *1 event needs a check* -> the web app opens on that one event. | `companion/` |
| **College email** | A Gmail Apps Script in the student's own Google account runs every 15 min: certain events straight into Google Calendar, amber ones -> one email with a one-tap check link. | `integrations/gmail-apps-script/` |
| **Shared to the web app** (WhatsApp -> Share, or the paste button) | Decodes at once (no Decode click), clean events as one-line rows, amber ones as the only forms. **Add all to Google Calendar** writes them in one tap (sign-in once). With *Add automatically* on and nothing amber, a shared notice adds itself. | `app/app.js`, `app/gcal.js` |
| **The class representative publishes** | One click; the class subscribes once to a calendar link that updates itself when a notice is revised, with a term-wide clash report on every publish. | `worker/` |

Same UIDs everywhere (`app/engine/ics.js::calendarEntries`): adding twice updates, a revised notice moves the event,
nothing duplicates. Setup for each piece is in its folder's README. Still manual: the paste box, as the fallback.

## What it does

1. **Paste** a notice from WhatsApp, a PDF or the notice board (or tap an example).
2. **Events** come out with title, type (test / deadline / lecture / other), date, start and end time, and venue.
3. **Every field shows why** ("`by 12:00 noon` = must happen by 12:00 PM") and **"Show in notice"** highlights the exact words it came from.
4. **Check only what is uncertain.** Fields the rules are sure of say "Nothing to check"; uncertain ones are outlined in amber with the question to answer, and nothing can be exported until each one is fixed or marked "Looks right". Every field is editable and clashes update as you type.
5. **Clashes** on a timeline, in plain words, with a suggested action. Two events clash when each starts before the other ends; a deadline is a point in time and clashes when it falls inside another event.
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
| A timetable: `13 Nov 2026 - DBMS - 10 AM to 1 PM - Room 101` per line | Each row is an exam named by its subject, kind from the header line, room from the cell |
| "Thursday, 13 Nov 2026" when 13 Nov is a Friday | **Asks which one is right** instead of picking silently |
| An exam on Diwali, or on a Sunday | Flags the gazetted holiday (`app/engine/holidays.js`, editable per college); notes the Sunday |
| `75/100 attendance`, `Unit 3/4` | Not read as dates |
| `2026-11-20` (portal format), `0700 hrs`, `by EOD`, "between 9 and 11 AM", "starts at 10 and ends by 1" | Read, with EOD flagged as an assumption |
| "Reporting time 8:30 AM, Time 10:00 AM" | Starts at 10, reporting time kept as a note |
| गणित की परीक्षा 13 नवंबर 2026 को सुबह 10 बजे कमरा 204 में | Hindi months, times, event words and rooms (Devanagari digits too) |

AI is not needed for any of this, so results are the same every time, cost nothing to run and can be checked by the student.

## Who pays (sustainability)

- **Students: free, always** (paste, fix, clash check, .ics). Free core tiers are normal for student tools (Notion is free for students; TimeTree's core is free).
- **Departments: yearly plan for "Publish to class"**, proposed at ₹2,999 per department per year, free for a first pilot term. The free version of this already works: the CR decodes once and shares a link that carries the events (no server). The paid plan is the hosted version of that link: one subscription calendar per class that **updates itself** when a revised notice is published, with clash checks across every notice of the term. The CR or a teacher is the daily user; the HOD signs off from the department budget. Today a class representative forwards every notice by hand. APSIT Mumbai moved notices out of WhatsApp groups in Sep 2025 because many students missed them, and Jamia (Sep 2026) now routes academic notices through official CR-run class groups. With the licence, a faculty member or CR decodes a notice once and the whole class subscribes to one calendar link. A full college ERP such as Fedena lists $999-1,699 a year, so a single-purpose add-on can be priced well below that.
- **Student extras (later):** photo/PDF reading, WhatsApp reminders (each message has a cost, so it is a paid feature).
- **Cost to run:** the rules run on the student's phone, so each notice costs us about nothing; hosting fits a free static tier.
- Honest status: no college has paid yet; the next step is a one-department pilot.

Sources and the full market research: `research/SYNTHESIS.md`.

## Run it

No install, no build. Serve the `app` folder with any static server:

```bash
npx serve app        # or: python -m http.server 8000 --directory app
```

Tests (Node 18+): `node tests/engine.test.mjs` (27 engine tests), `node worker/test/feed.test.mjs` (8), `node tools/bundle-engine.mjs && node integrations/gmail-apps-script/test/run.mjs` (7), `cd companion && npm test` (5). Browser check of the whole page, the share link, the share target and offline mode: start the server, then `node tools/ui-check.mjs` (Playwright, 63 checks; `PLAYWRIGHT_DIR` may point at any project that has Playwright installed). Test notices with expected results live in `examples/` (six, including an exam timetable, two same-hour tests and a Hindi notice).

## Code map

- `app/engine/dates.js`: date, time, duration finders (each keeps its exact position in the text)
- `app/engine/parse.js`: notice-context rules (labelled blocks, anchor date, merge, pending, contradictions, warnings)
- `app/engine/clash.js`: clash rules and suggested actions
- `app/engine/ics.js`: RFC 5545 calendar file (CRLF, 75-octet folding, Asia/Kolkata time zone, reminders)
- `app/engine/holidays.js`: gazetted holidays 2026-27, used only to ask "is the college open?"
- `app/index.html`, `app/app.js`, `app/styles.css`: the page (cards, timeline, export, share link, Undo)
- `app/manifest.webmanifest`, `app/sw.js`, `app/icon-*.png`: installable app, offline shell, WhatsApp share target
- `app/gcal.js`, `app/config.js`: Google Calendar one-tap writer (needs `GOOGLE_CLIENT_ID`), feed base
- `worker/`: class feed (Cloudflare Worker + KV), `worker/test/feed.test.mjs`
- `integrations/gmail-apps-script/`: Gmail -> calendar, `test/run.mjs` runs it against fake Apps Script services
- `companion/`: Android app (Expo), `test/pipeline.test.mjs`
- `tools/bundle-engine.mjs` -> `dist/notice-engine.js`: the engine as one plain script for Apps Script and the Android app
