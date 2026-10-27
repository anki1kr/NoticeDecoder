# Class feed + AI check (Cloudflare Worker)

A class representative publishes the reviewed events once; the class subscribes once to a calendar link that
updates itself. This is the hosted half of the department plan. The same Worker also runs the optional AI check
(Claude Haiku 5.5), so the API key never reaches a browser. Free tier is enough: Workers 100k requests/day, SQLite
Durable Objects, KV 1k writes/day.

## Storage: one Durable Object per class

Every request about a class (`/api/class/:id/...`, `/c/:id...`, and the create) goes to that class's own Durable
Object (`ClassRoom`, `idFromName(classId)`), which keeps the class record in its storage and runs requests one at a
time. Plain KV was measured on the live Worker (26 Oct 2026) serving the class as it was before a publish for a while
after it: the console showed 0 events, edits and cancels said "No such event", and a write in that window would have
saved the old copy back. `node tools/consistency-probe.mjs` checks this on the live feed. KV now holds only the AI day
counter; a class created before the move is copied from KV into its object the first time it is read (the 17 existing
ones were), and a deleted class leaves a tombstone so the old KV copy cannot come back.

## Deploy (once, 5 minutes)

```bash
cd worker
npm ci                                        # the Anthropic SDK (bundled by wrangler)
npx wrangler login
npx wrangler kv namespace create CLASSES      # paste the printed id into wrangler.toml
npx wrangler secret put ANTHROPIC_API_KEY     # optional: paste the key at the prompt; it never enters a file
npx wrangler deploy                           # prints https://notice-decoder-feed.<account>.workers.dev
```

Put that URL into `app/config.js` as `FEED_BASE` (and `companion/app.json` -> `extra.feedBase`). The web app then shows
section 6 "Class calendar" and the "Open class" box; with a key it also shows the "AI check" switch.
`GET /health` says `"ai": true` once the key is set. Without it, no AI control appears anywhere.

## Routes

| Route | Who | What |
|---|---|---|
| `POST /api/class` `{name}` | web app, first publish | creates the class; returns `{id, secret}` (secret shown once, kept in the CR's browser). 5 per minute per IP |
| `POST /api/class/:id/publish?dry=1` (Bearer) `{events, intents}` | web app preview | the PLAN, nothing written: per event `add`, `update`, `move`, `same` or `restore`, with the other reading in `alt` |
| `POST /api/class/:id/publish` (Bearer) `{events, intents}` | web app / CR's phone | applies the plan; returns counts and the clash report for everything still to come |
| `GET /api/class/:id/events` (Bearer) | CR console | every event, clashes, what changed (last 40), pilot numbers |
| `PATCH /api/class/:id/events/:uid` (Bearer) `{date,start,end,venue,...}` | CR console | edit one published event; the UID stays, so subscribers' copies move |
| `DELETE /api/class/:id/events/:uid` (Bearer) | CR console | cancel (`STATUS:CANCELLED` in the feed, subscribers drop it) |
| `POST /api/class/:id/events/:uid/restore` (Bearer) | CR console | undo a cancel |
| `PATCH /api/class/:id` (Bearer) `{name}` · `POST /api/class/:id/rotate` (Bearer) · `DELETE /api/class/:id` (Bearer) | CR console | rename · new key (old key links stop working) · delete the class |
| `GET /c/:id.ics` | calendars | the feed (`webcal://`), `Cache-Control: max-age=300`, ETag |
| `GET /c/:id.json` | Android app, web app | the events, what changed, upcoming clashes |
| `GET /c/:id` | students | subscribe page: Google / Apple / Outlook, QR code, what changed, upcoming by day, past events, dark mode |
| `POST /api/ai/refine` `{text, events}` | web app (Origin must be in `AI_ORIGINS`) | AI check, see below |

`intents[i]` lets the CR overrule the guess for event `i`: `"new"` (it is a different event) or `"replace:<uid>"` (it is
that published event, moved). The guess without intents: same title + same day = update; a specific title on another
date within 60 days, or an event the notice itself says was postponed (`moved: true`), = move; a generic title
("Quiz", "Extra class", "Meeting") on another date = a new event.

UIDs, times and reminders come from `app/engine/ics.js::calendarEntries`, the same code the .ics download and the
Google writer use, so every path agrees. A stored event keeps its UID forever (edits, moves, renames).

## Join with Google (server-side calendar writes)

`GET /oauth/start?class=:id[&back=app]` -> Google consent (offline access, `calendar.app.created openid email`, the class
id in an HMAC-signed `state`); `GET /oauth/callback` (routed to the class's Durable Object by `state`) exchanges the
code with `GOOGLE_CLIENT_SECRET`, seals the refresh token with `TOKEN_KEY` (AES-GCM), stores the member (`members[sub]
= {email, refresh, calendarId, map{uid: googleEventId}, synced}`), writes every current event at once, sets a
`nd_member_<id>` cookie and redirects back (`?joined=<email>&written=n`). After every change `queueAll` lists the
members and the alarm `drainQueue`s 8 per run, writing only events published since `member.synced` (PATCH by remembered
id, else `events/import`; cancelled -> `status: cancelled`). `POST /api/class/:id/leave` (cookie) removes the member
and revokes the token. A refresh that fails with `invalid_grant` marks the member `revoked` (the page says "join
again"). Setup: the OAuth client needs `<worker origin>/oauth/callback` as a redirect URI; secrets
`GOOGLE_CLIENT_SECRET` and `TOKEN_KEY` (`node -e "process.stdout.write(require('crypto').randomBytes(32).toString('base64url'))" | npx wrangler secret put TOKEN_KEY`).
Google shows the new calendar hidden by default on phones; the server marks it `selected` and the page says to tick it if not.

## Notifications (Web Push)

`POST /api/class/:id/push {subscription}` stores this phone's push endpoint on the class (no class key: students do it);
`DELETE` removes it. After every publish, edit, cancel or restore the Durable Object pushes every endpoint
(`pushAll`), drops the ones that answer 404/410, and arms its alarm for the next reminder (`nextReminder`: a test 1 day
before, a deadline 3 h before, a lecture 30 min before, an all-day item at 6 PM the day before, all IST). The alarm
pushes again with `Urgency: high` and re-arms. Pushes carry no payload: only a VAPID JWT (ES256, WebCrypto) for the
push service's origin. The app's service worker then fetches `/c/:id.json`, whose `changes` (timestamps) and `remind`
(UIDs whose reminder fell in the last 40 minutes) tell it what to say. Keys: `VAPID_PUBLIC` in wrangler.toml (also in
`/health` as `push`), the private half as the secret `VAPID_PRIVATE_JWK` (`node vapid-keygen.mjs | npx wrangler secret
put VAPID_PRIVATE_JWK`). Limits: 400 phones per class; a phone that fails 5 pushes in a row is dropped. iOS needs the
app installed to the home screen (Apple's rule for web push); Android Chrome works from the browser.

## AI check

One call to `claude-haiku-5-5` per notice that needs it (the app decides: weak names, nothing found, or text from a
photo). Sent: the notice (capped at 6,000 characters) and one line per event the rules found. Asked for: a title, a
type, "is it real", the exact quote that names it, and events the rules missed as quoted words. Thinking is off, the
answer follows a JSON schema (`output_config.format`; the Worker falls back to plain JSON if a model refuses it),
`max_tokens` 900. Measured on 26 Oct 2026 with the real model: 1,200 to 1,700 tokens in, 60 to 130 out, 1 to 4 seconds, about $0.0002 a call (three calls together: $0.0005). Guards: the key
is a Worker secret; only pages listed in `AI_ORIGINS` may call it; 8 calls per minute per IP (`AI_LIMIT`); a hard daily
ceiling (`AI_DAILY_CAP`, default 300, counted in KV per IST day; 0 switches the AI off); the same notice is answered
from the Cache API for 7 days. The app trusts nothing it gets back: names must be quoted from the notice, dates are
always read by the rules.

## Test

- `node worker/test/feed.test.mjs` runs the handler against a fake KV: plan and publish, moves vs new events, intents,
  dry runs that write nothing, edits, cancel and restore, rename, rotate, delete, Hindi UIDs, HTML injection, junk
  input, rate limits, v1 records.
- `node worker/test/room.test.mjs` drives the Durable Object routing with fakes: read-your-writes, 20 simultaneous
  publishes all kept (the plain KV path keeps 1), KV classes carried over, deleted classes stay deleted.
- `node worker/test/ai.test.mjs` hands the real Anthropic SDK a fake `fetch`: what is sent (model, thinking off,
  schema, no sampling params, the key only in a header), the cap and the limiter, the cache, every API error, refusals,
  cut-off answers, the structured-output fallback.
- `node tools/feed-dev.mjs --port 8787 [--fake-ai]` runs this Worker on plain Node (in-memory KV, a pretend Claude), which
  is what the browser checks (`tools/ui-check.mjs`, `tools/break-check.mjs`) talk to, and works for an offline demo.

## Honest notes

- Google Calendar refreshes subscribed feeds every 12 to 24 hours. Apple and Outlook let the user pick. For "at once"
  the Android app polls the JSON every 15 minutes and the web app opens `#c=<id>` live.
- The secret is hashed in KV; lose every copy and the class needs a new one. "Use on another phone" in the console makes
  a key link for a second phone or a co-CR; "New class key" kills old links.
- Two publishes at the very same moment run one after the other inside the class's Durable Object; neither is lost.
- Published events do leave the CR's device (that is the point of the feed), and the AI check sends the notice text to
  Anthropic. The rules-only paste/share flow stays on-device.
