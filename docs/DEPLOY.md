# Deploy: the four one-time steps that need the owner's accounts

Everything below is a one-time setup. After it, every push to `master` redeploys the web app (GitHub Pages) and
`node tools/smoke-live.mjs` tells you the live site and the class feed are healthy. Check what is set at any time:

```bash
node tools/configure.mjs --show
```

## 1. Google Calendar one tap (OAuth client id)   ~10 minutes

The "Add all to Google Calendar" button needs a public OAuth **Web** client id. Nothing secret: it ships in the page.

1. https://console.cloud.google.com → pick the project (`playzone-504313`, or **New project** "Notice Decoder").
2. **APIs & Services → Library** → search *Google Calendar API* → **Enable**.
3. **APIs & Services → OAuth consent screen** → External → App name "Notice Decoder", your email as support and
   developer contact → Save. Under **Audience / Test users** add the team's and the judges' Google accounts
   (Testing mode allows 100 users; no verification needed for the hackathon).
   Scopes: add `https://www.googleapis.com/auth/calendar.events` (non-sensitive list → "calendar.events").
4. **Credentials → Create credentials → OAuth client ID** → Application type **Web application** →
   Name "Notice Decoder web" → **Authorised JavaScript origins**: `https://anki1kr.me` and `http://127.0.0.1:8771`
   (no redirect URIs: the page uses the token flow) → Create → copy the **Client ID** (`…apps.googleusercontent.com`).
5. In the repo:
   ```bash
   node tools/configure.mjs --google-client-id 1234567890-abc.apps.googleusercontent.com
   git add -A && git commit -m "configure: Google client id" && git push
   ```
6. Verify: open the live app, decode the PDF sample, press **Add all to Google Calendar** → Google sign-in → the three
   events appear in your calendar. Press again → "updated 3", no duplicates. Undo removes them.

Pitfalls: "Access blocked: app not verified" = the account is not in Test users. "origin_mismatch" = the origin list
is missing the exact scheme + host you opened. Changes to origins take a minute to apply.

## 2. Class feed (Cloudflare Worker + KV)   ~5 minutes

```bash
cd worker
npx wrangler login                          # opens the browser once
npx wrangler kv namespace create CLASSES    # prints: id = "…"
cd ..
node tools/configure.mjs --kv-id <that id>
cd worker && npx wrangler deploy && cd ..   # prints https://notice-decoder-feed.<account>.workers.dev
node tools/configure.mjs --feed-base https://notice-decoder-feed.<account>.workers.dev
git add -A && git commit -m "configure: class feed" && git push
node tools/smoke-live.mjs                   # creates a throwaway class, publishes, reads the .ics back
```

The web app now shows section 6 "Class calendar" and the "Open class" box; the Android app shows the class id field.
Free plan limits: 100k requests/day, 1k KV writes/day; a class publishes a few times a week.

## 3. Gmail (each student, their own account)   ~5 minutes

Follow `integrations/gmail-apps-script/README.md` (paste `Code.gs`, `appsscript.json` and `dist/notice-engine.js`,
run `install`). Nothing to deploy on our side.

## 4. Android companion (APK)   ~20 minutes, when wanted

```bash
cd companion
npm install --legacy-peer-deps
npx expo install --fix
npx eas login                                # free Expo account
npm run build:apk                            # EAS cloud build, APK link in ~15 min
```
Or with a local Android SDK: `npm run android` with a phone on USB. Then the first-launch steps in `companion/README.md`.

## After any deploy

```bash
node tools/smoke-live.mjs          # app files, manifest (file share target), config values, feed end to end
```
GitHub Pages serves the new build within a minute; installed copies of the app pick it up on the next open (the
service worker version is bumped by `configure.mjs` and by hand in `app/sw.js` when files change).
