# AGENTS.md: Notice Decoder (SETU 2026, Forge Realm PS-02)

Team Nova Nexus: Ankit Kumar (leader), Ankit, Ashwani Tanwar.
Paste a messy college notice -> events (title, type, date, start/end, venue) -> the student checks only the uncertain
fields -> clash check -> .ics file or Google Calendar. Plain rules in the browser: no server, no API key, no AI.
Judging: Completeness 35, Monetization 30, Innovation 20, UI/UX 15. The PS text and rubric are in `SETU_2026_PS.pdf`
(owner's Downloads); PS-02 requirements are mapped one by one on deck slide 5.

## Rules

- Never `git commit` or `git push`; the owner commits and pushes.
- Scratch files go in `tmp/` (gitignored), never the repo root.
- Every new real notice goes to `examples/NN-name.txt` with `NN-name.expected.md` (events, clashes, flags).
- No invented numbers in the README, pitch or deck: a stat needs a source in `research/` or comes from a test run.
- Never send a notice to an outside service. "The notice never leaves the phone" is a claim in the pitch.
- Keep the review gate: PS-02 says the student must be able to fix every field **before** anything is exported.
  Export and the Google Calendar button stay locked while any field has a `warn` flag.

## Layout

| Path | What |
|---|---|
| `app/` | the whole website (static, ES modules, no build). `index.html`, `app.js` (UI), `styles.css`, `samples.js` (the 3 example notices) |
| `app/engine/dates.js` | date, time, duration finders; every token keeps its `[start, end)` offset in the notice |
| `app/engine/parse.js` | notice rules: label blocks, anchor date, revisions, cancellations, windows, multi-day, contradictions, pending, notes, warnings |
| `app/engine/clash.js` | overlap / deadline-as-point / test windows, plain-English verdicts and suggested actions |
| `app/engine/ics.js` | RFC 5545 file (CRLF, 75-octet folding, Asia/Kolkata, VALARM, RRULE) and the Google Calendar link |
| `app/engine/holidays.js` | gazetted holidays 2026-27 -> amber "confirm the college is open" flag; Sundays get an info note |
| `app/manifest.webmanifest`, `app/sw.js`, `app/icon-*.png` | PWA: install, offline shell (cache-first, `VERSION` in sw.js), WhatsApp share target (`?text=` -> decode) |
| `app/pdftext.js`, `app/ocr.js`, `app/engine/ocrfix.js` | PDF text (pdf.js, lines rebuilt by y), photo OCR (tesseract.js, canvas pre-processing), OCR cleanup + same-length typo fixes for month/weekday names; `parseNotice(text, {source:'ocr'})` makes every dated event amber once |
| `tools/configure.mjs`, `tools/smoke-live.mjs`, `docs/DEPLOY.md` | write GOOGLE_CLIENT_ID / FEED_BASE / APP_URL / KV id into every file + bump sw VERSION; live checks; the owner's four setup steps |
| `app/gcal.js`, `app/config.js` | Google Calendar one-tap (GIS token flow, `events?iCalUID=` lookup then PATCH or `/import`), `GOOGLE_CLIENT_ID` / `FEED_BASE` |
| `worker/` | class feed Worker + KV: create / publish (merge by UID, term-wide clash report) / `GET events` (CR console, Bearer) / cancel / `.ics` (REFRESH-INTERVAL, X-PUBLISHED-TTL) / `.json` / subscribe page; ETag + 304 on the feeds |
| `integrations/gmail-apps-script/` | `Code.gs` (15-min trigger, upsert by `nd-uid` tag, amber -> email with `#s=` link), `appsscript.json`, `test/run.mjs` (vm + fakes) |
| `companion/` | Expo Android app: notification listener -> `src/handler.js` -> expo-calendar; parked items reviewed in a WebView of the web app |
| `tools/bundle-engine.mjs`, `dist/notice-engine.js` | engine as one IIFE (`globalThis.NoticeEngine`) for Apps Script and the companion (`companion/scripts/sync-engine.mjs` copies it) |
| `tests/engine.test.mjs` | engine tests (node only, no framework) |
| `examples/` | real notices + expected answers |
| `docs/PITCH.md` | demo script, judge Q&A, money |
| `deck/build_deck.py`, `tools/deck-shots.mjs` | builds the 6-slide PPTX (+PDF) in the SETU PS-02 look from app screenshots and live test numbers |
| `research/` | market research; `SYNTHESIS.md` is the summary, `06-public-competitors.md` the code-checked competitor table |

## Commands

```bash
python -m http.server 8771 --bind 127.0.0.1 --directory app   # run the site (or: npx serve app)
node tests/engine.test.mjs                                     # engine tests (30)
python tools/make-fixtures.py                                  # regenerates examples/07-photo-notice.png + 08-pdf-timetable.pdf (PIL + LibreOffice)
OCR_CHECKS=1 node tools/ui-check.mjs                           # + the photo OCR checks (first run downloads ~10 MB from jsDelivr/tessdata)
node tools/smoke-live.mjs                                      # after a deploy: live app files, manifest, config values, class feed end to end
node worker/test/feed.test.mjs                                 # class feed Worker (8), fake KV
node tools/bundle-engine.mjs && node integrations/gmail-apps-script/test/run.mjs   # Gmail script against fake Apps Script (7)
cd companion && npm test                                       # companion pipeline (5); npm run android for a phone
node tools/ui-check.mjs                                          # 42 browser checks: page at 390px, share link round trip, ?text= share target, SW + offline (server on 8771; system Chrome; PLAYWRIGHT_DIR=<project with playwright>)
python tools/make-icons.py                                       # regenerates app/icon-*.png (PIL)
python tmp/test_ui_real.py && python tmp/test_review.py        # browser checks (Playwright, needs the server on 8771)
node tmp/judge1/run-notices.mjs                                # 20 outside messy notices, per-field score
PLAYWRIGHT_DIR=<project with playwright> node tools/deck-shots.mjs && python deck/build_deck.py   # screenshots, then the 6-slide deck (.pptx + .pdf; needs the server on 8771; numbers read from the test runs)
```
PDF of the deck: `powershell -File ~/.claude/skills/sih-deck/scripts/render.ps1 -Deck deck/NoticeDecoder_NovaNexus_PS02.pptx -Pdf <abs path>.pdf`

## Traps

- `app/engine/*.js` use CRLF line endings: a multi-line search-and-replace must match `\r\n` (normalise or use an editor tool).
- `app.js` `workingCopy()` copies engine fields one by one. A new engine field (e.g. `repeat`, `link`, `point`, `window`, `reportAt`)
  must be added there too, or the UI silently drops it from the calendar export. The share link (`shareUrl()` / `loadShared()`,
  `#s=<base64url JSON>`, `v: 1`) carries its own short keys; add the field there as well and bump `SHARE_VERSION` if an old link must stop loading.
- `sw.js` caches the shell cache-first. After changing any file under `app/`, bump `VERSION` in `sw.js` or installed users keep the old build until the next visit after that.
- Merging two mentions of one event (`sameThing()` in parse.js): same family, same date, compatible times AND the titles share a telling word (or one title is contained in the other). "Maths test" and "Physics test" at 10 AM are two events and a clash; this used to merge them and hide the clash (fixed 2026-10-15).
- One sentence can hold two events (`splitCompound()`): cut at "and" / ";" only when both halves have a time AND an event word, so "16 and 17 Oct" and "10 AM to 1 PM" are never cut.
- Timetable rows (`tableRow()`): a line with a date, a time and 3+ cells split by ` - `, `|` or tabs; the first cell that is not a date/time/room/weekday is the title, the header line above ("Exam schedule:") gives the kind. Titles like "Event" never trigger the "two different dates" warning.
- Clash, timeline and .ics must agree on an event's length: no end = `durationMin` or 60 minutes; deadline or `point` = an instant.
- A plain date library is not enough: it attaches a lone "6:30 PM" to today and reads "60 min" as a clock time
  (`research/SYNTHESIS.md` 6b). The notice-context rules in `parse.js` are the product.
- Relative paths only in `app/` (no leading `/`): the site is served from a sub-path on GitHub Pages. The manifest's `start_url`/`scope`/`share_target.action` are `./` for the same reason.
- `holidays.js` is a list, not a calendar library: lunar dates are marked approx. and the flag only asks; never move or drop an event because of it.
- **Review gate, automated.** Zero amber -> auto-add is allowed (Google one-tap, share-target auto-add, Gmail script, companion); any amber field -> that event is never written anywhere until the student acts. Keep that split; it is how the automation stays inside PS-02's "review before export".
- **One mapping.** `calendarEntries()` in `app/engine/ics.js` is the only place an event becomes UID/start/end/summary/reminder. The .ics, `gcal.js`, the Worker feed, the Gmail script and the companion all read it. A change there changes all five; add a test in each suite.
- Files never auto-add: `handleFile()` decodes with `source:'ocr'|'pdf'` and the engine flags every dated event amber ("check against the picture"). `fixOcrText()` may change text length (it runs BEFORE parse and its output is what the textarea shows); `normalizeNames()` never does (it runs INSIDE `findDates`, so highlight offsets stay exact). Keep that split.
- The file share target is a POST handled by `sw.js` (parks the file in the `nd-share` cache, 303 to `./?shared=file`); `fromSharedFile()` in app.js picks it up. A text share stays a GET `?text=`. The OCR/PDF libraries come from jsDelivr/tessdata and are cached by the SW in `nd-libs-v1` (cache-first), so they are not in `SHELL`.
- `clearAll()` must empty `#event-list`: hidden stale cards made a browser check pass for the wrong reason once.
- `findClashes()` expands `repeat` events to each day (`_day` on the copies, `row.date` says which day); the same pair is reported once per verdict. The timeline still draws the first day only.
- Auto-add while offline: `addAllToGoogle()` queues the reviewed events in `localStorage` (`nd-gcal-queue`, last 10) and `retryQueued()` runs on `online` and at start, silently (needs a live Google token).
- `tools/configure.mjs` is the only way deployment ids should enter the repo (it also bumps `sw.js` VERSION). `tools/smoke-live.mjs` is the post-deploy check; it creates a throwaway class in the live feed each run.
- `app/app.js` detects `window.ReactNativeWebView`: inside the companion the "Add all" button posts `{type:'nd-add', events}` to the phone instead of calling Google. `tools/ui-check.mjs` stubs Google (`window.__ndGcalDeps`) and the feed (`window.__ndFeedBase` + a fetch stand-in); real Google and a real Worker are checked by hand.
- `dist/notice-engine.js` and `companion/engine/notice-engine.js` are generated; CI fails if they are stale. `node companion/scripts/sync-engine.mjs` regenerates both.
- Apps Script has no `TextEncoder` and no ES modules: the bundle wraps each module in a function scope; `ics.js` falls back to `unescape(encodeURIComponent())` for byte lengths. Keep engine code free of DOM, `fetch`, `crypto` and `Intl`.

## Deploy

Repo `anki1kr/NoticeDecoder`. GitHub Pages deploys from the `master` branch root (Settings > Pages > Deploy from a branch),
so the README is the landing page and the app is **https://anki1kr.me/NoticeDecoder/app/** (the account's Pages use the custom
domain `anki1kr.me`; `anki1kr.github.io/NoticeDecoder/` redirects there). `.github/workflows/pages.yml` only runs the engine tests.
