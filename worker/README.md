# Class feed (Cloudflare Worker)

A class representative publishes the reviewed events once; the class subscribes once to a calendar link that
updates itself. This is the hosted half of the department plan. Free tier is enough: Workers 100k requests/day,
KV 1k writes/day.

## Deploy (once, 5 minutes)

```bash
cd worker
npx wrangler login
npx wrangler kv namespace create CLASSES      # paste the printed id into wrangler.toml
npx wrangler deploy                           # prints https://notice-decoder-feed.<account>.workers.dev
```

Put that URL into `app/config.js` as `FEED_BASE` (and `companion/app.json` -> `extra.feedBase`). The web app then shows
section 6 "Class calendar" and the "Open class" box; the Android app shows its class id field.

## Routes

| Route | Who | What |
|---|---|---|
| `POST /api/class` `{name}` | web app, first publish | creates the class; returns `{id, secret}` (secret shown once, kept in the CR's browser) |
| `POST /api/class/:id/publish` (Bearer secret) `{events}` | web app / CR's phone | merge by UID (same title = same event, so a revised notice updates), returns the term-wide clash report |
| `DELETE /api/class/:id/events/:uid` (Bearer) | web app | marks the event cancelled (`STATUS:CANCELLED` in the feed, so subscribers drop it) |
| `GET /c/:id.ics` | calendars | the feed (`webcal://`), `Cache-Control: max-age=300` |
| `GET /c/:id.json` | Android app, web app | the same events as JSON |
| `GET /c/:id` | students | subscribe page: Google / Apple / Outlook buttons, event list, "Open in Notice Decoder" |

UIDs, times and reminders come from `app/engine/ics.js::calendarEntries`, the same code the .ics download and the
Google writer use, so every path agrees.

## Test

`node worker/test/feed.test.mjs` runs the handler against a fake KV: create, auth, publish + clash report, feed
validity, revision = update, cancel, subscribe page, junk input.

## Honest notes

- Google Calendar refreshes subscribed feeds every 12 to 24 hours. Apple and Outlook let the user pick. For "at once"
  the Android app polls the JSON every 15 minutes and the web app opens `#c=<id>` live.
- The secret is hashed in KV; losing it means creating a new class (there is no recovery by design, no accounts).
- Published events do leave the CR's device (that is the point of the feed). The free paste/share flow stays on-device.
