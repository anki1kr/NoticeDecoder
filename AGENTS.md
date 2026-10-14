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
| `tests/engine.test.mjs` | engine tests (node only, no framework) |
| `examples/` | real notices + expected answers |
| `docs/PITCH.md` | demo script, judge Q&A, money |
| `deck/build_deck.py` | builds the PPTX from screenshots and live test numbers |
| `research/` | market research; `SYNTHESIS.md` is the summary, `06-public-competitors.md` the code-checked competitor table |

## Commands

```bash
python -m http.server 8771 --bind 127.0.0.1 --directory app   # run the site (or: npx serve app)
node tests/engine.test.mjs                                     # engine tests
python tmp/test_ui_real.py && python tmp/test_review.py        # browser checks (Playwright, needs the server on 8771)
node tmp/judge1/run-notices.mjs                                # 20 outside messy notices, per-field score
python tmp/deck/capture.py && python deck/build_deck.py        # screenshots, then the deck (needs the server)
```
PDF of the deck: `powershell -File ~/.claude/skills/sih-deck/scripts/render.ps1 -Deck deck/NoticeDecoder_NovaNexus_PS02.pptx -Pdf <abs path>.pdf`

## Traps

- `app/engine/*.js` use CRLF line endings: a multi-line search-and-replace must match `\r\n` (normalise or use an editor tool).
- `app.js` `workingCopy()` copies engine fields one by one. A new engine field (e.g. `repeat`, `link`, `point`, `window`)
  must be added there too, or the UI silently drops it from the calendar export.
- Clash, timeline and .ics must agree on an event's length: no end = `durationMin` or 60 minutes; deadline or `point` = an instant.
- A plain date library is not enough: it attaches a lone "6:30 PM" to today and reads "60 min" as a clock time
  (`research/SYNTHESIS.md` 6b). The notice-context rules in `parse.js` are the product.
- Relative paths only in `app/` (no leading `/`): the site is served from a sub-path on GitHub Pages.

## Deploy

Repo `anki1kr/NoticeDecoder`. GitHub Pages deploys from the `master` branch root (Settings > Pages > Deploy from a branch),
so the README is the landing page and the app is **https://anki1kr.me/NoticeDecoder/app/** (the account's Pages use the custom
domain `anki1kr.me`; `anki1kr.github.io/NoticeDecoder/` redirects there). `.github/workflows/pages.yml` only runs the engine tests.
