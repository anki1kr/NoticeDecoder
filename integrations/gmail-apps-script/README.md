# Notice Decoder for Gmail (college email -> your calendar, automatically)

Runs inside your own Google account with Apps Script. Free. Nothing leaves your account: the same rules engine as
the web app runs in the script, reads new college notices every 15 minutes and writes the events into your Google
Calendar. Events the rules are sure of are added at once. A notice with an uncertain field (amber in the web app) is
**not** added; you get one email with a one-tap link to check it.

## Setup (about 5 minutes)

1. In the repo run `node tools/bundle-engine.mjs`. It writes `dist/notice-engine.js`.
2. Open https://script.google.com -> **New project**. Name it "Notice Decoder".
3. In the editor: **Project settings** (gear) -> tick *Show "appsscript.json" manifest file in editor*.
4. Replace the three files:
   - `Code.gs`: paste this folder's `Code.gs`.
   - `appsscript.json`: paste this folder's `appsscript.json` (sets the Asia/Kolkata time zone and the scopes).
   - **+** -> Script -> name it `notice-engine` -> paste `dist/notice-engine.js`.
5. Edit `CONFIG.query` at the top of `Code.gs`: put your college's mail domain in `from:(@college.edu)`, or skip the
   domain and just label notices with a Gmail label called **notices**.
6. Pick `install` in the function dropdown -> **Run**. Accept the permissions (Gmail, Calendar, send mail as you).
   That creates the labels `nd-done` / `nd-check` and the 15-minute trigger.

Test it now: pick `testWithSample` -> Run. Three events from the PS-02 sample appear in your calendar (Internal Test
2, the 12:00 deadline as the 30 minutes before it, the guest lecture). Run it again: still three, because events
carry their UID as a tag and are updated, never duplicated.

## What it does with each mail

| Case | Result |
|---|---|
| Every field certain | Event(s) created with a reminder by type (test 1 day, deadline 3 h, lecture 30 min). Label `nd-done`. |
| Any amber field (no AM/PM, 04/05 date, "Thursday" that is a Friday, holiday...) | Not added. Label `nd-check` + one email with the fields to check and an *Open, check, add in one tap* link into the web app. |
| Same notice revised later (same title) | The existing event is moved/updated (UID tag), not duplicated. |
| No date or time in the mail | Nothing happens; label `nd-done` so it is not re-read. |

`uninstall` removes the trigger; events already in the calendar stay.

## Limits, honestly

- Plain-text body only. A notice that is only a PDF or an image attachment is not read (yet).
- Gmail search runs at most every 15 minutes (Apps Script trigger floor is 1 minute, but 15 keeps quota far away).
- Free Apps Script quota: 100 emails/day sent to yourself, 90 minutes of script time/day. A class never gets near it.
- The first run processes mails from the last 3 days (`newer_than:3d`); older notices are ignored on purpose.

## Testing without Google

`node integrations/gmail-apps-script/test/run.mjs` loads `Code.gs` and the bundle into a fake Apps Script
(GmailApp, CalendarApp, MailApp stubs) and checks: a clean notice creates 3 events, a second run updates instead of
duplicating, an amber notice sends one email with a working `#s=` link and creates nothing.
