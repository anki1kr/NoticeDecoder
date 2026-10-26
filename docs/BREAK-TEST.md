# Break test, 26 October 2026

The question: how would a student or a class representative break Notice Decoder, by accident or on purpose? Every
item below was found by a test (or, where it says "code review", while reading the code for one) and is fixed; the
tests now run on every change. 19 of the rows are bugs in the app as it was; the AI-focus row is a guard for the new
AI check.

| What a user does | What used to happen | Now | Test |
|---|---|---|---|
| Pastes a promo notice ("turn ideas into **practical** innovations ... Date / Time / Venue") | The event was called "Practical", typed as an **exam**, and nothing was amber, so it would auto-add as an exam | "Smart Campus Innovation Challenge", type event. "practical" is a test only as a noun; challenges, contests, symposia, expos are events | `tests/engine.test.mjs` |
| "Nov 13" on one line, "0700 hrs" on the next | The time became the **year 700**: date `700-11-13` | 13 Nov at 7:00 AM. A year must look like one and sit on the same line | engine + fuzz |
| A guest lecture with no end time and a deadline inside its hour | The clash check **crashed**; the app swallowed it and said "No clashes"; the class server would have answered 500 | Reported as a clash with the "finish before" action | engine + fuzz (247 crashes in 4,000 random lists before the fix) |
| Two Hindi events ("गणित की परीक्षा", "भौतिकी की परीक्षा") | Both got the UID `event@`, so the second **overwrote** the first in Google Calendar and in the class feed | Each Hindi title gets its own stable UID | worker feed test |
| CR publishes "Quiz" on 5 Nov, later another "Quiz" on 12 Nov | The 5 Nov quiz **silently moved** to 12 Nov for the whole class | A generic title on another date is a new event; a specific one (or "postponed to") is a move; the CR sees which and can flip it before publishing | worker feed test + break-check |
| Cancelled event in the class feed | Still marked the events around it 🔴 clash | Cancelled events clash with nothing | worker feed test |
| Pastes a notice, then edits a field within a second | The paste was decoded **twice**; the second decode wiped the edit | Decoded once | break-check |
| Pastes a screenshot into an empty box | "Paste a notice first" flashed while the photo was being read | The photo is read, no false error | code review |
| Taps "Publish to class" two or three times | Two prompts, **two classes**, the second overwriting the first key on the phone | One prompt, one class; every class button is off while a call is in flight | break-check |
| Republishes the same events | "Publish" stayed tappable with nothing to publish | "Nothing new", button off | ui-check |
| Opens a share link carrying `2026-02-31` or `25:00` | Accepted; the calendar file would carry a day and an hour that do not exist | Refused: "Add a date", no time | break-check |
| Types `javascript:alert(…)` as the link, then presses "Looks right" | The link went into the .ics `URL:` line and the "Open link" button | Flagged amber; never written to any calendar or offered as a link, even after "Looks right" | break-check |
| Types a year like `20260` in the date picker | Accepted | "Pick a real date" | break-check |
| Uploads a PDF, then a Word file before the PDF finished | The slower PDF overwrote the Word file's text | The last file wins | break-check |
| Uploads an iPhone HEIC photo in Chrome | Tried to OCR it (Chrome's user agent says "Safari" too, so the check never ran) | "Send a screenshot or a JPG" | break-check |
| Uploads a photo on a weak connection (OCR model download fails) | "Preparing the reader…" **forever**, plus an uncaught error; after the network came back, photos kept failing until a reload | Plain message in under a second; the next photo works without a reload | break-check (`OCR_CHECKS=1`) |
| AI answer arrives while the student is typing in a field | (new feature) would re-render under the cursor | No re-render when nothing changed; the cursor is put back when something did | code review |
| CR publishes, then edits, cancels or publishes again within a minute (found on the LIVE Worker) | Cloudflare KV served the class as it was before the publish: a read right after a publish showed 0 events, the edit and the cancel said "No such event", and a write in that minute would have saved the old copy back and wiped the publish. Twenty publishes at once kept 1 | Every class is its own Durable Object: it reads its own writes and runs one request at a time. Live probe 5/5 consistent; twenty at once keep 20; the 17 classes made before the move were carried over on first read | `worker/test/room.test.mjs`, `tools/consistency-probe.mjs` (live) |
| `PATCH /api/class/<id>/anything` with a name | Renamed the class | 404 | worker feed test |
| Class name sent as an object | Stored as "[object Object]" | 400 | worker feed test |

## Also checked and already safe

Empty box, 10-letter notices, emoji-only notices, 200 KB pastes (decode + render about 1 s), 100,000 characters with no
spaces, 20,000 blank lines, script and HTML inside a notice (rendered as text), 5,000-letter titles (cut to 120),
negative durations, end before start, garbage `#s=` / `#c=` / `#cr=` links, a share link with 500 events (50 shown),
truncated / fake / old `.doc` / zip-bomb Word files, empty, corrupt and password-protected PDFs, `.exe` files, a blank
photo, a 108-megapixel photo, a scanned PDF, offline publishing ("You are offline"), a class opened before still
opening offline from the browser cache, a leaked class key made useless by "New class key", the AI server unreachable
("the rules result stands"), the AI switched off (no call at all), a late AI answer after "Clear" (dropped), the class
server refusing junk JSON, wrong keys, oversized bodies and HTML in class names.

## Run it

```bash
node tests/engine.test.mjs && node tests/fuzz.test.mjs && node tests/files.test.mjs
npm ci --prefix worker && node worker/test/feed.test.mjs && node worker/test/room.test.mjs && node worker/test/ai.test.mjs
python -m http.server 8771 --bind 127.0.0.1 --directory app      # terminal 1
node tools/feed-dev.mjs --port 8787 --fake-ai                     # terminal 2
node tools/ui-check.mjs && node tools/break-check.mjs              # OCR_CHECKS=1 for photos too
```

Last run (26 Oct 2026): engine 44, fuzz (30,000 notices over 5 seeds), files 7, worker 18 + rooms 6 + AI 10, Gmail 7, companion 5,
ui-check 84/84, break-check 80/80 with OCR, including the real IIC poster photo (28 Oct, 2:20 PM read from the picture).
