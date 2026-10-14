# Notice Decoder

**SETU 2026 · Forge Realm · PS-02.** Paste a messy college notice. Get clear events, catch clashes, add them to your calendar.

Live demo: _add link after deploy_ · Runs fully in the browser: the notice never leaves your device and the demo works without internet.

## What it does

1. **Paste** a notice from WhatsApp, a PDF or the notice board (or tap an example).
2. **Events** come out with title, type (test / deadline / lecture / other), date, start and end time, and venue.
3. **Every field shows why** ("`by 12:00 noon` = must happen by 12:00 PM") and **"Show in notice"** highlights the exact words it came from.
4. **Check only what is uncertain.** Fields the rules are sure of say "Nothing to check"; uncertain ones are outlined in amber with the question to answer, and nothing can be exported until each one is fixed or marked "Looks right". Every field is editable and clashes update as you type.
5. **Clashes** on a timeline, in plain words, with a suggested action. Two events clash when each starts before the other ends; a deadline is a point in time and clashes when it falls inside another event.
6. **Add to Google Calendar** with one tap per event, or **download .ics** for all of them (Google, Outlook, Apple) with reminders by event type.

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

AI is not needed for any of this, so results are the same every time, cost nothing to run and can be checked by the student.

## Who pays (sustainability)

- **Students: free, always** (paste, fix, clash check, .ics). Free core tiers are normal for student tools (Notion is free for students; TimeTree's core is free).
- **Departments: yearly plan for "Publish to class"** (planned, not built), proposed at ₹2,999 per department per year, free for a first pilot term. The CR or a teacher is the daily user; the HOD signs off from the department budget. Today a class representative forwards every notice by hand. APSIT Mumbai moved notices out of WhatsApp groups in Sep 2025 because many students missed them, and Jamia (Sep 2026) now routes academic notices through official CR-run class groups. With the licence, a faculty member or CR decodes a notice once and the whole class subscribes to one calendar link. A full college ERP such as Fedena lists $999-1,699 a year, so a single-purpose add-on can be priced well below that.
- **Student extras (later):** photo/PDF reading, WhatsApp reminders (each message has a cost, so it is a paid feature).
- **Cost to run:** the rules run on the student's phone, so each notice costs us about nothing; hosting fits a free static tier.
- Honest status: no college has paid yet; the next step is a one-department pilot.

Sources and the full market research: `research/SYNTHESIS.md`.

## Run it

No install, no build. Serve the `app` folder with any static server:

```bash
npx serve app        # or: python -m http.server 8000 --directory app
```

Tests (Node 18+): `node tests/engine.test.mjs`. Test notices with expected results live in `examples/`.

## Code map

- `app/engine/dates.js`: date, time, duration finders (each keeps its exact position in the text)
- `app/engine/parse.js`: notice-context rules (labelled blocks, anchor date, merge, pending, contradictions, warnings)
- `app/engine/clash.js`: clash rules and suggested actions
- `app/engine/ics.js`: RFC 5545 calendar file (CRLF, 75-octet folding, Asia/Kolkata time zone, reminders)
- `app/index.html`, `app/app.js`, `app/styles.css`: the page
